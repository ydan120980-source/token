use crate::{
    js_json::stringify,
    jsonl_adapter as adapter, pathx, policy,
    store::{uuid_v4, Store},
    time::{iso_from_ms, now_ms},
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    time::{Duration, Instant},
};

const DRAFT_TTL: Duration = Duration::from_secs(30 * 60);
const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);
const USAGE_FIELDS: [&str; 5] = [
    "inputUncached",
    "output",
    "cacheRead",
    "cacheWrite",
    "reasoning",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomDraft {
    pub token: String,
    pub id: String,
    pub definition: Value,
    pub selected: bool,
    pub locations: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPreview {
    pub id: String,
    pub summary: Value,
    pub config_hash: String,
    pub source_stamp: String,
    pub sequence: i64,
    pub expires_at: String,
}

struct Draft {
    wire: CustomDraft,
    created: Instant,
}

struct Preview {
    id: String,
    source: Value,
    result: Value,
    fingerprint: String,
    sequence: i64,
    created: Instant,
}

#[derive(Default)]
pub struct CustomSources {
    draft: Option<Draft>,
    preview: Option<Preview>,
}

fn entry<'a>(values: &'a Value, key: &str) -> Result<&'a Value, String> {
    values.get(key).ok_or_else(|| "CUSTOM_NOT_FOUND".to_owned())
}

fn paths(value: &Value) -> impl Iterator<Item = &str> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

fn all_sources(store: &Store) -> impl Iterator<Item = &Value> {
    store.state["customSources"]
        .as_object()
        .into_iter()
        .flat_map(|sources| sources.values())
}

fn check(store: &Store, source: &Value, protected: &[String]) -> Result<(), String> {
    let added = &store.settings["sources"]["added"];
    let reserved = [&store.defaults, added]
        .into_iter()
        .filter_map(Value::as_object)
        .flat_map(|values| values.values())
        .flat_map(paths)
        .chain(
            all_sources(store)
                .filter(|other| other["id"] != source["id"])
                .flat_map(|other| paths(other.get("reservedRoots").unwrap_or(&other["roots"]))),
        )
        .map(str::to_owned)
        .collect::<Vec<_>>();
    adapter::check_roots(source, &reserved, protected)
}

fn records(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}

fn count_unknown(records: &[Value]) -> Value {
    USAGE_FIELDS
        .into_iter()
        .map(|field| {
            let count = records
                .iter()
                .filter(|row| row.get(field) == Some(&Value::Null))
                .count();
            (field.to_owned(), json!(count))
        })
        .collect::<Map<String, Value>>()
        .into()
}

fn prior(source: &Value) -> Value {
    let mut previous = source.clone();
    if let Some(map) = previous.as_object_mut() {
        map.shift_remove("previous");
    }
    previous
}

fn sequence(store: &Store) -> i64 {
    store.state["sequence"].as_i64().unwrap_or_default()
}

impl CustomSources {
    fn expire(&mut self) {
        if self
            .draft
            .as_ref()
            .is_some_and(|item| item.created.elapsed() >= DRAFT_TTL)
        {
            self.draft = None;
            self.preview = None;
        } else if self
            .preview
            .as_ref()
            .is_some_and(|item| item.created.elapsed() >= PREVIEW_TTL)
        {
            self.preview = None;
        }
    }

    pub fn draft(
        &mut self,
        store: &Store,
        id: Option<&str>,
        definition: Option<&Value>,
    ) -> Result<Value, String> {
        let saved = id
            .map(|id| entry(&store.state["customSources"], id))
            .transpose()?;
        if saved.is_some_and(|value| value["archived"] == true) {
            return Err("CUSTOM_NOT_FOUND".to_owned());
        }
        let locations: Vec<String> = saved
            .into_iter()
            .flat_map(|source| paths(&source["roots"]))
            .map(str::to_owned)
            .collect();
        let definition = match definition {
            Some(value) => adapter::definition(value)?,
            None => saved.map(|source| source["definition"].clone()).unwrap_or_else(|| {
                json!({"schemaVersion":"CustomSourceV1","name":"我的 Agent","template":"standard","mode":"per-request"})
            }),
        };
        let wire = CustomDraft {
            token: uuid_v4(),
            id: id
                .map(str::to_owned)
                .unwrap_or_else(|| format!("custom-{}", uuid_v4())),
            definition,
            selected: !locations.is_empty(),
            locations,
        };
        let response = json!(wire);
        self.preview = None;
        self.draft = Some(Draft {
            wire,
            created: Instant::now(),
        });
        Ok(response)
    }

    fn current(&mut self, token: &str) -> Result<&mut CustomDraft, String> {
        self.expire();
        self.draft
            .as_mut()
            .filter(|item| item.wire.token == token)
            .map(|item| &mut item.wire)
            .ok_or_else(|| "CUSTOM_DRAFT_STALE".to_owned())
    }

    pub fn validate_token(&mut self, token: &str) -> Result<(), String> {
        self.current(token).map(|_| ())
    }

    pub fn choose(
        &mut self,
        store: &Store,
        token: &str,
        roots: Vec<String>,
        protected: &[String],
    ) -> Result<Value, String> {
        let draft = self.current(token)?;
        check(store, &json!({"id":draft.id,"roots":roots}), protected)?;
        for root in &roots {
            let metadata = fs::symlink_metadata(pathx::std_path(root))
                .map_err(|_| "SOURCE_UNREADABLE".to_owned())?;
            if !metadata.file_type().is_dir() {
                return Err("SOURCE_SYMLINK_REJECTED".to_owned());
            }
        }
        draft.selected = true;
        draft.locations = roots;
        let reply =
            json!({"selected":true,"count":draft.locations.len(),"locations":draft.locations});
        self.preview = None;
        Ok(reply)
    }

    pub fn sample(
        &mut self,
        store: &Store,
        token: &str,
        protected: &[String],
    ) -> Result<Value, String> {
        let draft = self.current(token)?;
        let source = json!({"id":draft.id,"roots":draft.locations,"definition":draft.definition});
        check(store, &source, protected)?;
        Ok(adapter::sample(&source, &mut policy::Audit::new()))
    }

    pub fn preview(
        &mut self,
        store: &mut Store,
        token: &str,
        value: &Value,
        protected: &[String],
    ) -> Result<CustomPreview, String> {
        let value = adapter::definition(value)?;
        let (id, locations, changed) = {
            let draft = self.current(token)?;
            let changed = stringify(&draft.definition) != stringify(&value);
            if changed {
                draft.definition = value.clone();
            }
            (draft.id.clone(), draft.locations.clone(), changed)
        };
        if changed {
            self.preview = None;
        }
        let config_hash = adapter::hash(&value);
        let old = &store.state["customSources"][&id];
        let version = old["version"].as_i64().unwrap_or(0);
        let version = if old.is_null()
            || adapter::parser_hash(&old["definition"]) != adapter::parser_hash(&value)
        {
            version + 1
        } else {
            version
        };
        let source = json!({"id":id,"roots":locations,"definition":value,"version":version});
        check(store, &source, protected)?;
        let before = adapter::fingerprint(&source)?;
        let salt = store.state["salt"]
            .as_str()
            .ok_or("LOCAL_STORAGE_INVALID")?;
        let result = adapter::scan(&source, salt, &old["files"], &mut policy::Audit::new());
        let fingerprint = adapter::fingerprint(&source)?;
        if before != fingerprint {
            return Err("CUSTOM_PREVIEW_STALE".to_owned());
        }
        let next = records(&result["records"]);
        let (added, removed, replaced, old_count) = {
            let old: HashMap<_, _> = store
                .record_refs()
                .filter(|row| row["agent"] == id)
                .filter_map(|row| row["id"].as_str().map(|key| (key, row)))
                .collect();
            let next_ids: HashMap<_, _> = next
                .iter()
                .filter_map(|row| row["id"].as_str().map(|key| (key, row)))
                .collect();
            let added = next_ids
                .keys()
                .filter(|key| !old.contains_key(**key))
                .count();
            let removed = old
                .keys()
                .filter(|key| !next_ids.contains_key(**key))
                .count();
            let replaced = next_ids
                .iter()
                .filter(|(key, row)| {
                    old.get(**key)
                        .is_some_and(|old| stringify(old) != stringify(row))
                })
                .count();
            (added, removed, replaced, old.len())
        };
        let diagnostics = &result["diagnostics"];
        if old_count == 0 {
            if let Some(error) = records(&diagnostics["errors"])
                .first()
                .and_then(Value::as_str)
            {
                return Err(error.to_owned());
            }
        }
        if next.is_empty() {
            if diagnostics["unsupported"].as_u64().unwrap_or(0) > 0 {
                return Err("CUSTOM_COUNTER_UNSUPPORTED".to_owned());
            }
            if old_count == 0 {
                return Err("CUSTOM_NO_RECORDS".to_owned());
            }
        }
        let priced = next
            .iter()
            .filter(|record| !store.estimate(record)["lower"].is_null())
            .count();
        let mut summary = json!({
            "files":result["fileCount"],"records":next.len(),
            "totalTokens":next.iter().filter_map(|row| row["totalTokens"].as_f64()).sum::<f64>(),
            "unknown":count_unknown(next),"added":added,"removed":removed,"replaced":replaced,
        });
        if let (Some(output), Some(values)) = (summary.as_object_mut(), diagnostics.as_object()) {
            output.extend(values.clone());
            output.insert("pricedRecords".into(), json!(priced));
        }
        let id = uuid_v4();
        let sequence = sequence(store);
        let expires_at = iso_from_ms(now_ms() + PREVIEW_TTL.as_millis() as i64);
        let reply = CustomPreview {
            id: id.clone(),
            summary,
            config_hash,
            source_stamp: fingerprint.clone(),
            sequence,
            expires_at,
        };
        self.preview = Some(Preview {
            id,
            source,
            result,
            fingerprint,
            sequence,
            created: Instant::now(),
        });
        Ok(reply)
    }

    pub fn apply(
        &mut self,
        store: &mut Store,
        id: &str,
        protected: &[String],
    ) -> Result<Value, String> {
        self.expire();
        let pending = self
            .preview
            .as_ref()
            .filter(|item| item.id == id && item.sequence == sequence(store))
            .ok_or_else(|| "CUSTOM_PREVIEW_STALE".to_owned())?;
        let source = &pending.source;
        check(store, source, protected)?;
        if adapter::fingerprint(source)? != pending.fingerprint {
            return Err("CUSTOM_PREVIEW_STALE".to_owned());
        }
        let source_id = source["id"].as_str().ok_or("CUSTOM_PREVIEW_STALE")?;
        let old = store.state["customSources"].get(source_id);
        let reserved = old
            .into_iter()
            .flat_map(|old| paths(old.get("reservedRoots").unwrap_or(&old["roots"])))
            .chain(paths(&source["roots"]))
            .fold(Vec::new(), |mut seen, root| {
                if !seen.contains(&root) {
                    seen.push(root);
                }
                seen
            });
        let next = json!({
            "id":source_id,"name":source["definition"]["name"],"definition":source["definition"],
            "roots":source["roots"],"reservedRoots":reserved,"version":source["version"],
            "enabled":true,"archived":false,"files":pending.result["files"],"diagnostics":pending.result["diagnostics"],
            "fileCount":pending.result["fileCount"],"previous":old.map(prior)
        });
        store.commit_custom(&next, records(&pending.result["records"]))?;
        let response = json!({"saved":true,"id":source_id});
        self.draft = None;
        self.preview = None;
        Ok(response)
    }

    pub fn change(
        &mut self,
        store: &mut Store,
        id: &str,
        action: &str,
        value: Option<bool>,
        protected: &[String],
    ) -> Result<Value, String> {
        self.expire();
        let source = entry(&store.state["customSources"], id)?;
        let mut next = source.clone();
        match action {
            "enable" if source["archived"] != true && value.is_some() => {
                next["enabled"] = json!(value)
            }
            "remove" => {
                next["enabled"] = json!(false);
                next["archived"] = json!(true);
                next["previous"] = prior(source);
            }
            "rollback" if source["previous"].is_object() => {
                next = source["previous"].clone();
                next["reservedRoots"] = source
                    .get("reservedRoots")
                    .unwrap_or(&source["roots"])
                    .clone();
                next["previous"] = prior(source);
                check(store, &next, protected)?;
            }
            _ => return Err("CUSTOM_CHANGE_INVALID".to_owned()),
        }
        let (records, _, _) = adapter::merge(&next["files"]);
        store.commit_custom(&next, &records)?;
        self.preview = None;
        Ok(json!({"saved":true}))
    }
}

pub fn export(store: &Store, id: &str) -> Result<Value, String> {
    adapter::definition(&entry(&store.state["customSources"], id)?["definition"])
}

pub fn collect(store: &Store, protected: &[String]) -> Result<Value, String> {
    let mut output = Map::new();
    let salt = store.state["salt"]
        .as_str()
        .ok_or("LOCAL_STORAGE_INVALID")?;
    let mut audit = policy::Audit::new();
    for source in
        all_sources(store).filter(|value| value["enabled"] == true && value["archived"] != true)
    {
        let id = source["id"].as_str().ok_or("CUSTOM_CONFIG_INVALID")?;
        adapter::definition(&source["definition"])?;
        check(store, source, protected)?;
        output.insert(
            id.to_owned(),
            adapter::scan(source, salt, &source["files"], &mut audit),
        );
    }
    Ok(Value::Object(output))
}

pub fn is_granted_root(store: &Store, path: &str, protected: &[String]) -> bool {
    all_sources(store).any(|source| {
        paths(&source["roots"]).any(|root| root == path) && check(store, source, protected).is_ok()
    })
}

pub fn describe(store: &Store, protected: &[String]) -> Vec<Value> {
    all_sources(store).map(|source| {
        let id = source["id"].as_str().unwrap_or_default();
        let enabled = source["enabled"] == true && source["archived"] != true;
        let allowed = check(store, source, protected);
        let list: Vec<_> = paths(&source["roots"]).map(|path| {
            let exists = pathx::std_path(path).exists();
            let (files, issues) = match (enabled, &allowed) {
                (true, Ok(())) => match policy::files_under(id, path, &mut policy::Audit::new(), None) {
                    Ok(files) => (Some(files.files.len()), if files.limited { vec!["SOURCE_LIMIT"] } else { vec![] }),
                    Err(_) => (None, vec!["SOURCE_UNREADABLE"]),
                },
                (true, Err(error)) => (None, vec![error.as_str()]),
                _ => (None, vec![]),
            };
            json!({"path":path,"display":path,"origin":"custom","state":if enabled {"included"} else {"stopped"},
                "exists":exists,"kind":"directory","files":files,"latest":null,"issues":issues})
        }).collect();
        let count: u64 = list.iter().filter_map(|path| path["files"].as_u64()).sum();
        json!({"agent":id,"enabled":enabled,"installed":list.iter().any(|path| path["exists"]==true),
            "files":count,"latest":null,"paths":list,"custom":true,"archived":source["archived"],
            "mixedRules":source["diagnostics"]["mixedRules"].as_i64().unwrap_or(0)>0,
            "canRollback": source["previous"].is_object()})
    }).collect()
}
