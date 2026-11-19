use crate::{
    agent_traces::{self, Places},
    pathx, policy,
    source_scope::{contains, same},
    sources::canonical,
    store::Store,
    time::{iso_from_ms, now_ms},
};
use serde_json::{json, Value};
use std::fs;

fn paths(value: &Value) -> impl Iterator<Item = &str> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

fn describe(agent: &str, root: &str, origin: &str, state: &str, home: Option<&str>) -> Value {
    let display = home
        .map(|home| pathx::relative(home, root))
        .filter(|relative| {
            !relative.is_empty() && !relative.starts_with("..") && !pathx::is_absolute(relative)
        })
        .map(|relative| format!("~{}{relative}", std::path::MAIN_SEPARATOR))
        .unwrap_or_else(|| root.to_owned());
    let mut entry = json!({"path":root,"display":display,"origin":origin,"state":state,
        "exists":false,"kind":null,"files":null,"latest":null,"issues":[]});
    let Ok(metadata) = fs::metadata(pathx::std_path(root)) else {
        return entry;
    };
    entry["exists"] = json!(true);
    if state != "included" {
        return entry;
    }
    entry["kind"] = json!(if metadata.is_dir() {
        "directory"
    } else {
        "file"
    });
    match policy::files_under(agent, root, &mut policy::Audit::new(), None) {
        Ok(listed) => {
            let latest = listed
                .files
                .iter()
                .filter_map(|file| fs::metadata(pathx::std_path(file)).ok())
                .map(|meta| policy::mtime_ms(&meta))
                .fold(0.0, f64::max);
            entry["files"] = json!(canonical(agent, &listed.files).len());
            if latest > 0.0 {
                entry["latest"] = json!(iso_from_ms(latest as i64));
            }
            let issues = [
                (listed.limited, "SOURCE_LIMIT"),
                (listed.aliased, "SOURCE_ALIAS_REJECTED"),
                (listed.unreadable, "SOURCE_UNREADABLE"),
            ];
            entry["issues"] = json!(issues
                .into_iter()
                .filter_map(|(active, code)| active.then_some(code))
                .collect::<Vec<_>>());
        }
        Err(error) => entry["issues"] = json!([error]),
    }
    entry
}

impl Store {
    pub fn source_selection(&self) -> Vec<Value> {
        let scope = &self.settings["sources"];
        let mut selections = Vec::new();
        for agent in policy::sources() {
            let enabled = !paths(&scope["disabled"]).any(|value| value == agent);
            let added = &scope["added"][&agent];
            let excluded = scope["excluded"].get(&agent);
            let mut seen: Vec<&str> = Vec::new();
            let mut entries = Vec::new();
            for root in paths(&self.defaults[&agent]).chain(paths(added)) {
                if seen.iter().any(|other| same(root, other)) {
                    continue;
                }
                seen.push(root);
                let origin = if contains(Some(added), root) {
                    "added"
                } else {
                    "auto"
                };
                let state = if contains(excluded, root) {
                    "excluded"
                } else if enabled {
                    "included"
                } else {
                    "stopped"
                };
                entries.push(json!({"path":root,"origin":origin,"state":state}));
            }
            selections.push(json!({"agent":agent,"enabled":enabled,"paths":entries}));
        }
        if let Some(custom) = self.state["customSources"].as_object() {
            selections.extend(custom.iter().map(|(id, source)| {
                let enabled = source["enabled"] == true && source["archived"] != true;
                let state = if enabled { "included" } else { "stopped" };
                let entries = paths(&source["roots"])
                    .map(|root| json!({"path":root,"origin":"custom","state":state}))
                    .collect::<Vec<_>>();
                json!({"agent":id,"enabled":enabled,"paths":entries})
            }));
        }
        selections
    }

    pub fn apply_source_selection(
        &mut self,
        action: &str,
        agent: Option<&str>,
        value: &Value,
    ) -> Result<(), String> {
        match action {
            "all" => {
                let enabled = value.as_bool().ok_or("INVALID_SETTING")?;
                // Custom controls are handled by their transactional service.
                // Apply this combined action only while both halves can be committed.
                if self.state["customSources"]
                    .as_object()
                    .is_some_and(|sources| {
                        sources.values().any(|source| source["archived"] != true)
                    })
                {
                    return Err("CUSTOM_UNAVAILABLE".to_owned());
                }
                self.change_sources("all", "", "", enabled)
            }
            "enable" | "reset" | "remove" | "include" => {
                let agent = agent
                    .filter(|id| crate::agent_catalog::is_builtin(id))
                    .ok_or("SOURCE_REJECTED")?;
                match action {
                    "enable" => self.change_sources(
                        action,
                        agent,
                        "",
                        value.as_bool().ok_or("INVALID_SETTING")?,
                    ),
                    "reset" => self.change_sources(action, agent, "", false),
                    _ => {
                        let known = value
                            .as_str()
                            .filter(|file| {
                                [
                                    self.defaults.get(agent),
                                    self.settings["sources"]["added"].get(agent),
                                    self.settings["sources"]["excluded"].get(agent),
                                ]
                                .into_iter()
                                .any(|list| contains(list, file))
                            })
                            .ok_or("SOURCE_REJECTED")?;
                        self.change_sources(action, agent, known, false)
                    }
                }
            }
            _ => Err("INVALID_SETTING".to_owned()),
        }
    }

    /// Persist the native dialog's selection and pause scanning in the same write.
    pub fn choose_source(&mut self, agent: &str, value: &str) -> Result<(), String> {
        if !crate::agent_catalog::is_builtin(agent) {
            return Err("SOURCE_REJECTED".to_owned());
        }
        let path = policy::local_path(value)?;
        let metadata =
            fs::symlink_metadata(pathx::std_path(&path)).map_err(|_| "SOURCE_UNREADABLE")?;
        if metadata.file_type().is_symlink() {
            return Err("SOURCE_SYMLINK_REJECTED".to_owned());
        }
        if agent == "cursor" {
            if !metadata.is_file() || !policy::allowed_file(agent, &path) {
                return Err("SOURCE_FILE_REJECTED".to_owned());
            }
        } else if !metadata.is_dir() {
            return Err("SOURCE_PATH_REJECTED".to_owned());
        }
        if crate::jsonl_adapter::overlaps(&path, &self.dir) {
            return Err("SOURCE_PRODUCT_OVERLAP".to_owned());
        }
        let custom_overlap = self.state["customSources"]
            .as_object()
            .is_some_and(|sources| {
                sources.values().any(|source| {
                    let reserved = if source["reservedRoots"].is_array() {
                        &source["reservedRoots"]
                    } else {
                        &source["roots"]
                    };
                    paths(reserved).any(|root| crate::jsonl_adapter::overlaps(root, &path))
                })
            });
        if custom_overlap {
            return Err("CUSTOM_SOURCE_OVERLAP".to_owned());
        }
        let mut next = self.settings.clone();
        next["sources"] =
            crate::source_scope::change_add(&next["sources"], &self.defaults, agent, &path);
        next["enabled"] = json!(false);
        self.save_preferences(&next)
    }

    /// Inspect only currently configured usage roots. File bodies and independent Agent homes
    /// are outside this operation.
    pub fn discover_selected_sources(&self, home: Option<&str>) -> Value {
        self.discover_sources(home, None)
    }

    /// Check additional Agent markers only in the explicitly supplied places.
    pub fn discover_with_places(&self, places: Places<'_>) -> Value {
        self.discover_sources(places.home, Some(places))
    }

    fn discover_sources(&self, home: Option<&str>, places: Option<Places<'_>>) -> Value {
        let scope = &self.settings["sources"];
        let sources: Vec<Value> = policy::sources().into_iter().map(|agent| {
            let defaults = &self.defaults[&agent];
            let stopped = paths(&scope["disabled"]).any(|name| name == agent);
            let candidates = paths(defaults).map(|root| (root, "auto")).chain(
                paths(&scope["added"][&agent]).filter(|root| !paths(defaults).any(|original| same(original, root)))
                    .map(|root| (root, "added")));
            let entries: Vec<Value> = candidates.map(|(root, origin)| {
                let state = if stopped { "stopped" } else if contains(scope["excluded"].get(&agent), root) {
                    "excluded"
                } else { "included" };
                describe(&agent, root, origin, state, home)
            }).collect();
            let latest = entries.iter().filter_map(|entry| entry["latest"].as_str()).max();
            let files: u64 = entries.iter().filter_map(|entry| entry["files"].as_u64()).sum();
            let installed = entries.iter().any(|entry| entry["exists"] == true)
                || places.is_some_and(|places| agent_traces::installed(&agent, places));
            json!({"agent":agent,"enabled":!stopped,"installed":installed,"files":files,"latest":latest,"paths":entries})
        }).collect();
        let unsupported = places.map(agent_traces::detect).unwrap_or_default();
        json!({"schemaVersion":"SourceDiscoveryV1","checkedAt":iso_from_ms(now_ms()),"sources":sources,"unsupported":unsupported})
    }
}
