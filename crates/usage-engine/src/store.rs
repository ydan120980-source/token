// The ledger owner: startup recovery, collection transactions, snapshot
// projection, the pricing surface and the workbench views. Session-list and
// transcript reading land in M2.
use crate::batch1_sources::copilot_intervals;
use crate::extended_sources::csv_identity;
use crate::js_json::{stringify, write_statistics};
use crate::jsonl_adapter::valid_saved;
use crate::ledger_view::reconcile;
use crate::model_aliases;
use crate::normalize::digest;
use crate::operation_metrics::OperationMetrics;
use crate::pathx as path;
use crate::policy::{local_path, sources};
use crate::pricing::{self, evaluate, is_identifier, validate, Eval, FIELDS};
use crate::pricing_labels::FIXABLE;
use crate::runtime_catalog;
use crate::sessions::resume_command;
use crate::source_registry;
use crate::source_scope as scope;
use crate::sources::Scan;
use crate::store_io::{atomic, load, quarantine_file, Recovery};
use crate::time::{iso_from_ms, now_ms};
use crate::usage_math::local_day;
use crate::usage_projection::{project_usage_with_calendar, Calendar, FullEstimate, ProjectionOptions};
use crate::usage_projection_incremental::{project_incremental, Prior};
use crate::usage_snapshot::{keep_identity, select_usage_snapshot, CONFLICT};
use crate::valuation::{self, Pricing};
use crate::workbench;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::Path;

fn truthy(value: Option<&Value>) -> bool {
    value.map(crate::normalize::truthy).unwrap_or(false)
}

fn uuid_v4() -> String {
    let mut bytes: [u8; 16] = rand::random();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

fn fresh_state() -> Value {
    let salt: String = rand::random::<[u8; 32]>().iter().map(|b| format!("{b:02x}")).collect();
    json!({"version": 1, "deviceId": uuid_v4(), "salt": salt, "sequence": 0, "records": {}, "statuses": {}})
}

fn valid_state(state: &Value) -> bool {
    state.get("version").and_then(|v| v.as_i64()) == Some(1)
        && state.get("deviceId").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
        && state.get("salt").map(|v| v.is_string()).unwrap_or(false)
        && state.get("records").map(|v| v.is_object()).unwrap_or(false)
        && state.get("statuses").map(|v| v.is_object()).unwrap_or(false)
        && state.get("sequence").and_then(|v| v.as_i64()).map(|s| s.abs() <= 9_007_199_254_740_991).unwrap_or(false)
        && valid_saved(state.get("customSources"))
}

fn recovery_value(recovery: &Recovery) -> Value {
    json!({"file": recovery.file, "quarantined": recovery.quarantined, "code": recovery.code})
}

fn sha256_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Clone)]
pub struct Store {
    pub dir: String,
    pub recovered: Vec<Recovery>,
    pub state: Value,
    pub defaults: Value,
    pub settings: Value,
    pub validation: Value,
    pub overrides: Value,
    pub billing: Value,
    pub workbench_settings: Value,
    workbench_cache: Option<WorkbenchCache>,
    pub remote_catalog: Option<Value>,
    pub downloaded_catalog: bool,
    pub model_catalog: Value,
    pub model_catalog_hash: String,
    pub persisted_digest: Option<String>,
    metrics: OperationMetrics,
    snapshot_cache: Option<Value>,
    projection_basis: Option<(i64, String, String)>,
    projection_calendar: Option<Calendar>,
    collection_previous: Option<(Value, Value)>,
    pricing_core: Option<(String, Pricing)>,
    staging: bool,
    writes: Vec<(String, Option<Value>)>,
}

#[derive(Clone)]
pub struct WorkbenchCache {
    snapshot: String,
    settings: String,
    scope: String,
    views: Map<String, Value>,
}

pub struct Batch {
    draft: Store,
    writes: Vec<(String, Option<Value>)>,
    ledger: String,
    digest: String,
    changed: bool,
    scan: Option<Scan>,
    snapshot: Option<Value>,
}

impl Store {
    pub fn new(dir: &str, defaults: &Value) -> Result<Store, String> {
        let mut store = Store {
            dir: dir.to_string(),
            recovered: Vec::new(),
            state: Value::Null,
            defaults: defaults.clone(),
            settings: json!({}),
            validation: json!({}),
            overrides: json!({}),
            billing: json!({}),
            workbench_settings: workbench::empty_settings(),
            workbench_cache: None,
            remote_catalog: None,
            downloaded_catalog: false,
            model_catalog: json!({}),
            model_catalog_hash: String::new(),
            persisted_digest: None,
            metrics: OperationMetrics::new(&["clone", "digest", "persist", "projection"], &["snapshotHit", "initial", "ledger", "timezone", "day", "invalidated"]),
            snapshot_cache: None,
            projection_basis: None,
            projection_calendar: None,
            collection_previous: None,
            pricing_core: None,
            staging: false,
            writes: Vec::new(),
        };
        store.check_roots(defaults)?;
        let statistics = path::join(&[dir, "statistics.json"]);
        store.state = load(Path::new(&statistics), fresh_state(), Some(&mut store.recovered), true)?;
        let saved = load(Path::new(&path::join(&[dir, "preferences.json"])), json!({"enabled": true}), Some(&mut store.recovered), false)?;
        let saved = if saved.is_object() { saved } else { json!({"enabled": true}) };
        let saved_roots = saved.get("roots").cloned();
        let saved_scope = saved.get("sources").cloned();
        let mut settings = saved.as_object().cloned().unwrap_or_default();
        settings.remove("roots");
        settings.remove("sources");
        let sources_scope = scope::sanitize(saved_scope.as_ref()).or_else(|| scope::migrate(saved_roots.as_ref(), defaults)).unwrap_or_else(scope::empty);
        settings.insert("sources".into(), sources_scope);
        store.settings = Value::Object(settings);
        store.check_roots(&store.source_roots())?;
        store.validation = load(Path::new(&path::join(&[dir, "validation.json"])), json!({}), Some(&mut store.recovered), false)?;
        store.overrides = load(Path::new(&path::join(&[dir, "pricing.json"])), json!({}), Some(&mut store.recovered), false)?;
        store.billing = load(Path::new(&path::join(&[dir, "billing.json"])), json!({"autoSync": true, "defaults": {}, "mappings": {}}), Some(&mut store.recovered), false)?;
        let workbench_file = path::join(&[dir, "workbench.json"]);
        let loaded = load(Path::new(&workbench_file), workbench::empty_settings(), Some(&mut store.recovered), false)?;
        match workbench::settings(&loaded) {
            Ok(settings) => store.workbench_settings = settings,
            Err(_) => {
                store.recovered.push(quarantine_file(Path::new(&workbench_file), "LOCAL_STORAGE_INVALID"));
                store.workbench_settings = workbench::empty_settings();
            }
        }
        let saved_catalog = load(Path::new(&path::join(&[dir, "model-pricing.json"])), Value::Null, Some(&mut store.recovered), false)?;
        match runtime_catalog::verify(if truthy(Some(&saved_catalog)) { &saved_catalog } else { runtime_catalog::embedded() }) {
            Ok(remote) => {
                store.remote_catalog = Some(remote);
                store.downloaded_catalog = truthy(Some(&saved_catalog));
            }
            Err(_) => {
                store.remote_catalog = Some(runtime_catalog::verify(runtime_catalog::embedded()).expect("embedded catalog verifies"));
            }
        }
        store.model_catalog = runtime_catalog::merged(store.remote_catalog.as_ref());
        store.model_catalog_hash = runtime_catalog::hash(&store.model_catalog);
        if !valid_state(&store.state) {
            store.recovered.push(quarantine_file(Path::new(&statistics), "LOCAL_STORAGE_INVALID"));
            store.state = fresh_state();
        }
        let needs_save = !Path::new(&statistics).exists() || store.state.get("duplicateIds").map(|v| v.is_null()).unwrap_or(true) || store.state.get("sessions").map(|v| v.is_null()).unwrap_or(true);
        if store.state.get("duplicateIds").map(|v| v.is_null()).unwrap_or(true) {
            store.state["duplicateIds"] = json!({});
        }
        if store.state.get("sessions").map(|v| v.is_null()).unwrap_or(true) {
            store.state["sessions"] = json!({});
        }
        // shareSavedStrings is a V8 string-interning optimization with no
        // observable effect; Rust values are already immutable snapshots.
        let mut migrated = false;
        let backup_dir = dir.to_string();
        reconcile(
            &mut store.state,
            &mut |state: &Value| {
                if !migrated {
                    let file = path::join(&[&backup_dir, "backups", &format!("statistics-before-dedupe-{}.json", state["sequence"].as_i64().unwrap_or(0))]);
                    let _ = atomic(Path::new(&file), state, false);
                    migrated = true;
                }
            },
            &crate::policy::labels(),
        );
        let mut exports: HashMap<String, i64> = HashMap::new();
        let ids: Vec<String> = store.state["records"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
        for id in ids {
            let record = &store.state["records"][&id];
            if record.get("agent").and_then(|v| v.as_str()) == Some("cursor") && record.get("entry").and_then(|v| v.as_str()) == Some("export") && record.get("csvIdentity").is_none() {
                if !migrated {
                    let file = path::join(&[dir, "backups", &format!("statistics-before-dedupe-{}.json", store.state["sequence"].as_i64().unwrap_or(0))]);
                    let _ = atomic(Path::new(&file), &store.state, false);
                    migrated = true;
                }
                let signature = csv_identity(record);
                let occurrence = exports.get(&signature).copied().unwrap_or(0);
                exports.insert(signature.clone(), occurrence + 1);
                let salt = store.state["salt"].as_str().unwrap_or("").to_string();
                store.state["records"][&id]["csvIdentity"] = json!(digest(&salt, &format!("cursor-export/2:{signature}:{occurrence}")));
            }
        }
        if needs_save || migrated {
            atomic(Path::new(&statistics), &store.state, true).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        }
        Ok(store)
    }

    fn check_roots(&self, selected: &Value) -> Result<(), String> {
        let own = local_path(&self.dir)?.to_lowercase();
        if let Some(lists) = selected.as_object() {
            for list in lists.values() {
                if let Some(items) = list.as_array() {
                    for source in items.iter().filter_map(|v| v.as_str()) {
                        let normalized = local_path(source)?.to_lowercase();
                        if normalized == own || normalized.starts_with(&format!("{own}\\")) || own.starts_with(&format!("{normalized}\\")) {
                            return Err("SOURCE_PRODUCT_OVERLAP".to_string());
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn catalog(&self) -> Value {
        source_registry::catalog(&self.state)
    }

    pub fn workbench(&mut self, selection: &Value) -> Result<Value, String> {
        let value = workbench::request(selection)?;
        let snapshot = self.snapshot()?;
        let key = stringify(&value);
        let snapshot_key = stringify(&snapshot);
        let settings_key = stringify(&self.workbench_settings);
        let scope_key = stringify(&self.settings["sources"]);
        let stale = self.workbench_cache.as_ref().map(|c| c.snapshot != snapshot_key || c.settings != settings_key || c.scope != scope_key).unwrap_or(true);
        if stale {
            self.workbench_cache = Some(WorkbenchCache { snapshot: snapshot_key, settings: settings_key, scope: scope_key, views: Map::new() });
        }
        let mut cache = self.workbench_cache.take().unwrap();
        if !cache.views.contains_key(&key) {
            if cache.views.len() >= 8 {
                cache.views.clear();
            }
            let calendar = self.projection_calendar.clone().filter(|c| c.timezone() == snapshot["timezone"].as_str().unwrap_or(""));
            let view = match workbench::build(self, &value, &snapshot, calendar.as_ref()) {
                Ok(view) => view,
                Err(error) => {
                    self.workbench_cache = Some(cache);
                    return Err(error);
                }
            };
            cache.views.insert(key.clone(), view);
        }
        let view = cache.views[&key].clone();
        self.workbench_cache = Some(cache);
        Ok(view)
    }

    pub fn save_workbench(&mut self, value: &Value) -> Result<Value, String> {
        let next = workbench::change(self, value)?;
        let file = path::join(&[&self.dir, "workbench.json"]);
        atomic(Path::new(&file), &next, true).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        self.workbench_settings = next;
        let period = value.get("period").cloned().unwrap_or(Value::Null);
        let selection = json!({"project": value.get("project").cloned().unwrap_or(Value::Null), "period": period});
        match self.workbench(&selection) {
            Err(error) if error == "WORKBENCH_SCOPE_INVALID" => self.workbench(&json!({"project": "all", "period": period})),
            result => result,
        }
    }

    pub fn records(&self) -> Vec<Value> {
        self.record_refs().cloned().collect()
    }

    pub(crate) fn record_refs(&self) -> impl Iterator<Item = &Value> {
        self.state["records"].as_object().into_iter().flat_map(Map::values).filter(|record| {
            !truthy(self.state["duplicateIds"].get(record["id"].as_str().unwrap_or_default()))
        })
    }

    pub fn diagnostics(&self) -> Value {
        self.metrics.state()
    }

    pub fn reprice(&mut self) -> Result<Value, String> {
        self.snapshot_cache = None;
        self.workbench_cache = None;
        let snapshot = self.snapshot()?;
        Ok(json!({"recalculated": true, "records": self.records().len(), "sequence": self.state["sequence"], "priceBasis": snapshot["priceCatalog"]}))
    }

    fn collection_write(&mut self, file: &str, value: &Value) -> Result<(), String> {
        if self.staging {
            let ledger = path::join(&[&self.dir, "statistics.json"]);
            self.writes.push((file.to_string(), if file == ledger { None } else { Some(value.clone()) }));
            return Ok(());
        }
        self.metrics.measure("persist", || atomic(Path::new(file), value, true).map_err(|_| "LOCAL_STORAGE_INVALID".to_string()))
    }

    fn collection_state(&self) -> Value {
        let mut state = self.state.as_object().cloned().unwrap_or_default();
        for key in ["records", "duplicateIds", "sessions", "statuses"] {
            let clone = self.state.get(key).cloned().unwrap_or(json!({}));
            state.insert(key.into(), clone);
        }
        Value::Object(state)
    }

    pub fn source_roots(&self) -> Value {
        scope::effective(&self.settings["sources"], &self.defaults)
    }

    pub fn save_preferences(&mut self, next: &Value) -> Result<(), String> {
        let mut saved = next.as_object().cloned().unwrap_or_default();
        saved.insert("roots".into(), scope::effective(&next["sources"], &self.defaults));
        atomic(Path::new(&path::join(&[&self.dir, "preferences.json"])), &Value::Object(saved), false).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        self.settings = next.clone();
        Ok(())
    }

    pub fn set_enabled(&mut self, enabled: bool) -> Result<(), String> {
        let mut next = self.settings.clone();
        next["enabled"] = json!(enabled);
        self.save_preferences(&next)
    }

    pub fn change_sources(&mut self, name: &str, agent: &str, file: &str, enabled: bool) -> Result<(), String> {
        let current = &self.settings["sources"];
        let next = match name {
            "add" => scope::change_add(current, &self.defaults, agent, file),
            "remove" => scope::change_remove(current, &self.defaults, agent, file),
            "include" => scope::change_include(current, agent, file),
            "enable" => scope::change_enable(current, agent, enabled),
            "reset" => scope::change_reset(current, agent),
            "all" => scope::change_all(current, enabled),
            _ => return Err("INVALID_SETTING".to_string()),
        };
        self.check_roots(&scope::effective(&next, &self.defaults))?;
        let mut settings = self.settings.clone();
        settings["sources"] = next;
        self.save_preferences(&settings)
    }

    pub fn price_context(&self) -> (Value, Value, Value) {
        (self.overrides.clone(), self.model_catalog.clone(), self.billing.clone())
    }

    pub(crate) fn current_pricing(&mut self) -> Pricing {
        let key = format!("{}\0{}\0{}", stringify(&self.overrides), stringify(&self.model_catalog), stringify(&self.billing));
        if let Some((cached_key, pricing)) = &self.pricing_core {
            if cached_key == &key {
                return pricing.clone();
            }
        }
        let pricing = Pricing::new(self.overrides.clone(), self.model_catalog.clone(), self.billing.clone());
        self.pricing_core = Some((key, pricing.clone()));
        pricing
    }

    pub fn estimate(&mut self, record: &Value) -> Value {
        self.current_pricing().estimate(record)
    }

    pub fn resolve_price(&mut self, record: &Value) -> Value {
        self.current_pricing().resolve_price(record)
    }

    pub fn digest(&mut self) -> String {
        let mut statuses = Map::new();
        if let Some(entries) = self.state["statuses"].as_object() {
            for (agent, status) in entries {
                let mut durable = status.as_object().cloned().unwrap_or_default();
                durable.remove("lastAttempt");
                durable.remove("lastSuccess");
                durable.remove("durationMs");
                statuses.insert(agent.clone(), Value::Object(durable));
            }
        }
        let mut payload = self.state.as_object().cloned().unwrap_or_default();
        payload.insert("sequence".into(), json!(0));
        payload.insert("updatedAt".into(), Value::Null);
        payload.insert("statuses".into(), Value::Object(statuses));
        let payload = Value::Object(payload);
        self.metrics
            .measure("digest", || {
                let mut hasher = Sha256::new();
                write_statistics(&payload, &mut |text| hasher.update(text.as_bytes()));
                Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>())
            })
            .unwrap_or_default()
    }

    pub fn snapshot(&mut self) -> Result<Value, String> {
        let now = now_ms();
        let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_string());
        let today = local_day(&timezone, now);
        let sequence = self.state["sequence"].as_i64().unwrap_or(0);
        if let Some(cache) = &self.snapshot_cache {
            if cache.get("sequence").and_then(|v| v.as_i64()) == Some(sequence) && cache.get("timezone").and_then(|v| v.as_str()) == Some(timezone.as_str()) && cache.get("today").and_then(|v| v.as_str()) == Some(today.as_str()) {
                let _ = self.metrics.count("snapshotHit");
                return Ok(cache.clone());
            }
        }
        let reason = match &self.projection_basis {
            None => "initial",
            Some((seq, tz, day)) => {
                if *seq != sequence {
                    "ledger"
                } else if tz != &timezone {
                    "timezone"
                } else if day != &today {
                    "day"
                } else {
                    "invalidated"
                }
            }
        };
        let _ = self.metrics.count(reason);
        let records = self.records();
        let source_catalog = self.catalog();
        let price_catalog = valuation::price_basis(&self.model_catalog, &self.overrides, self.remote_catalog.as_ref(), &self.billing);
        let recovered: Vec<Value> = self.recovered.iter().map(recovery_value).collect();
        let pricing = RefCell::new(self.current_pricing());
        let estimate = |record: &Value| -> FullEstimate { valuation::to_full_estimate(&pricing.borrow_mut().estimate(record)) };
        let updated_at = self.state.get("updatedAt").and_then(|v| v.as_str()).map(|s| s.to_string());
        let device_id = self.state["deviceId"].as_str().unwrap_or("").to_string();
        let statuses = self.state["statuses"].clone();
        let current_records = self.state["records"].clone();
        let current_duplicates = self.state["duplicateIds"].clone();
        let options = ProjectionOptions {
            records: &records,
            estimate: &estimate,
            sequence,
            updated_at: updated_at.as_deref(),
            device_id: &device_id,
            source_catalog: &source_catalog,
            price_catalog: &price_catalog,
            statuses: &statuses,
            recovered: &recovered,
            timezone: &timezone,
            now_ms: now,
        };
        if self.projection_calendar.as_ref().map(|c| c.timezone() != timezone).unwrap_or(true) {
            self.projection_calendar = Some(Calendar::new(&timezone));
        }
        let mut calendar = self.projection_calendar.take().unwrap();
        let mut collection_previous = self.collection_previous.take();
        let snapshot = self.metrics.measure("projection", || {
            let incremental = collection_previous.as_ref().and_then(|(state, snapshot)| {
                let prior = Prior { state, snapshot, current_records: &current_records, current_duplicates: &current_duplicates };
                project_incremental(&options, Some(&prior))
            });
            collection_previous = None;
            Ok(incremental.unwrap_or_else(|| project_usage_with_calendar(&options, &mut calendar)))
        })?;
        self.projection_calendar = Some(calendar);
        self.projection_basis = Some((sequence, timezone, today));
        self.snapshot_cache = Some(snapshot.clone());
        self.workbench_cache = None;
        Ok(snapshot)
    }

    fn backup(&mut self, backed_up: &mut bool, prefix: &str) {
        if !*backed_up {
            let file = path::join(&[&self.dir, "backups", &format!("{prefix}{}.json", self.state["sequence"].as_i64().unwrap_or(0))]);
            let state = self.state.clone();
            let _ = self.collection_write(&file, &state);
            *backed_up = true;
        }
    }

    pub fn ingest(&mut self, scan: &Scan, native: &Value) -> Result<Value, String> {
        let previous_state = self.state.clone();
        let previous_snapshot = self.snapshot_cache.clone();
        let previous_digest = self.persisted_digest.clone();
        let cloned = self.collection_state();
        self.state = self.metrics.measure("clone", || Ok(cloned))?;
        match self.ingest_draft(scan, native) {
            Ok(snapshot) => Ok(snapshot.unwrap_or(Value::Null)),
            Err(error) => {
                self.state = previous_state;
                self.snapshot_cache = previous_snapshot;
                self.persisted_digest = previous_digest;
                Err(error)
            }
        }
    }

    pub fn ingest_draft(&mut self, scan: &Scan, native: &Value) -> Result<Option<Value>, String> {
        let at = iso_from_ms(now_ms());
        let initial_keys: Vec<String> = self.state["records"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
        let retained: Vec<Value> = initial_keys
            .iter()
            .map(|id| self.state["records"][id].clone())
            .filter(|record| !truthy(self.state["duplicateIds"].get(record.get("id").and_then(|v| v.as_str()).unwrap_or(""))))
            .collect();
        let mut shared: HashMap<String, String> = retained.iter().filter_map(|r| Some((r.get("sharedKey")?.as_str()?.to_string(), r.get("id")?.as_str()?.to_string()))).collect();
        let mut exports: HashMap<String, String> = retained.iter().filter_map(|r| Some((r.get("csvIdentity")?.as_str()?.to_string(), r.get("id")?.as_str()?.to_string()))).collect();
        let mut record_order: Option<HashMap<String, usize>> = None;
        let mut processed: Vec<String> = Vec::new();
        let position = |order: &mut Option<HashMap<String, usize>>, processed: &[String], id: &str| -> usize {
            let map = order.get_or_insert_with(|| {
                let mut map = HashMap::new();
                for (i, key) in initial_keys.iter().enumerate() {
                    map.insert(key.clone(), i);
                }
                for key in processed {
                    if !map.contains_key(key) {
                        map.insert(key.clone(), map.len());
                    }
                }
                map
            });
            map.get(id).copied().unwrap_or(usize::MAX)
        };
        let previous_success: HashMap<String, Value> = self.state["statuses"]
            .as_object()
            .map(|m| m.iter().map(|(agent, status)| (agent.clone(), status.get("lastSuccess").cloned().unwrap_or(Value::Null))).collect())
            .unwrap_or_default();
        let mut conflicts: Vec<String> = Vec::new();
        let mut backed_up = false;
        let codex_parser = self.state["statuses"].get("codex").and_then(|s| s.get("parserVersion")).and_then(|v| v.as_str()).unwrap_or("");
        if codex_parser != format!("m1-projection/2 + tokscale/{}", crate::native::TOKSCALE_VERSION) && self.state["records"].as_object().map(|m| m.values().any(|r| r.get("agent").and_then(|v| v.as_str()) == Some("codex"))).unwrap_or(false) {
            let file = path::join(&[&self.dir, "backups", &format!("statistics-before-parser2-{}.json", at.replace(':', "-"))]);
            let state = self.state.clone();
            self.collection_write(&file, &state)?;
        }
        let mut detailed: HashSet<String> = HashSet::new();
        let workbuddy_records: Vec<Value> = scan.get("workbuddy").map(|w| w.records.clone()).unwrap_or_default();
        for record in retained.iter().chain(workbuddy_records.iter()) {
            if record.get("agent").and_then(|v| v.as_str()) == Some("workbuddy") && record.get("accountingKind").and_then(|v| v.as_str()) != Some("session-aggregate") {
                if let Some(key) = record.get("sessionKey").and_then(|v| v.as_str()) {
                    detailed.insert(key.to_string());
                }
            }
        }
        if !detailed.is_empty() {
            for id in &initial_keys {
                let old = &self.state["records"][id];
                if old.get("agent").and_then(|v| v.as_str()) == Some("workbuddy")
                    && old.get("accountingKind").and_then(|v| v.as_str()) == Some("session-aggregate")
                    && old.get("sessionKey").and_then(|v| v.as_str()).map(|k| detailed.contains(k)).unwrap_or(false)
                {
                    self.state["records"].as_object_mut().unwrap().remove(id);
                }
            }
        }
        for agent in sources() {
            let mut result = scan.get(&agent).cloned().unwrap_or_default();
            if agent == "copilot" {
                let mut modes: HashSet<String> = self.state["records"]
                    .as_object()
                    .map(|m| m.values().filter(|r| r.get("agent").and_then(|v| v.as_str()) == Some("copilot")).filter_map(|r| r.get("entry").and_then(|v| v.as_str()).map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                for record in &result.records {
                    if let Some(entry) = record.get("entry").and_then(|v| v.as_str()) {
                        modes.insert(entry.to_string());
                    }
                }
                if modes.len() > 1 {
                    result.records.clear();
                    result.partial = true;
                    if !result.errors.iter().any(|e| e == "COPILOT_SOURCE_MODE_CONFLICT") {
                        result.errors.push("COPILOT_SOURCE_MODE_CONFLICT".to_string());
                    }
                } else if result.records.iter().any(|r| r.get("entry").and_then(|v| v.as_str()) == Some("cli")) {
                    let previous: Vec<Value> = retained.iter().filter(|r| r.get("agent").and_then(|v| v.as_str()) == Some("copilot") && r.get("entry").and_then(|v| v.as_str()) == Some("cli")).cloned().collect();
                    let mut combined = previous.clone();
                    combined.extend(result.records.iter().cloned());
                    let intervals = copilot_intervals(&combined);
                    result.partial = result.partial || !intervals.warnings.is_empty();
                    for warning in &intervals.warnings {
                        if !result.errors.contains(warning) {
                            result.errors.push(warning.clone());
                        }
                    }
                    let next: HashMap<String, Value> = intervals.records.iter().filter_map(|r| Some((r.get("id")?.as_str()?.to_string(), r.clone()))).collect();
                    let corrected: Vec<Value> = previous
                        .iter()
                        .filter(|record| {
                            let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            !next.contains_key(id) || stringify(record) != stringify(&next[id])
                        })
                        .cloned()
                        .collect();
                    if !corrected.is_empty() {
                        self.backup(&mut backed_up, "statistics-before-identity-");
                    }
                    for record in corrected {
                        let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        self.state["records"].as_object_mut().unwrap().remove(&id);
                    }
                    result.records = intervals.records;
                }
            }
            if agent == "cursor" {
                let mut modes: HashSet<String> = self.state["records"]
                    .as_object()
                    .map(|m| m.values().filter(|r| r.get("agent").and_then(|v| v.as_str()) == Some("cursor")).filter_map(|r| r.get("entry").and_then(|v| v.as_str()).map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                for record in &result.records {
                    if let Some(entry) = record.get("entry").and_then(|v| v.as_str()) {
                        modes.insert(entry.to_string());
                    }
                }
                if modes.len() > 1 {
                    result.records.clear();
                    result.partial = true;
                    if !result.errors.iter().any(|e| e == "CURSOR_SOURCE_MODE_CONFLICT") {
                        result.errors.push("CURSOR_SOURCE_MODE_CONFLICT".to_string());
                    }
                }
            }
            let mut errors: Vec<String> = result.errors.clone();
            let add_error = |errors: &mut Vec<String>, code: &str| {
                if !errors.iter().any(|e| e == code) {
                    errors.push(code.to_string());
                }
            };
            for record in &result.records {
                let record_id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if agent == "workbuddy" && record.get("accountingKind").and_then(|v| v.as_str()) == Some("session-aggregate") && record.get("sessionKey").and_then(|v| v.as_str()).map(|k| detailed.contains(k)).unwrap_or(false) {
                    continue;
                }
                let mut owner_id = self.state["duplicateIds"].get(&record_id).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string()).unwrap_or_else(|| record_id.clone());
                if let Some(csv_id) = record.get("csvIdentity").and_then(|v| v.as_str()) {
                    owner_id = exports.get(csv_id).cloned().unwrap_or(owner_id);
                    exports.insert(csv_id.to_string(), owner_id.clone());
                    if owner_id != record_id {
                        self.backup(&mut backed_up, "statistics-before-identity-");
                        self.state["duplicateIds"][&record_id] = json!(owner_id);
                        if self.state["records"].get(&record_id).map(|v| v.is_null()).unwrap_or(true) {
                            self.state["records"][&record_id] = record.clone();
                        }
                    }
                }
                if let Some(shared_key) = record.get("sharedKey").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    let mut identities: Vec<String> = record.get("sharedRecordIds").and_then(|v| v.as_array()).map(|l| l.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect()).unwrap_or_default();
                    if let Some(existing) = shared.get(&shared_key) {
                        identities.push(existing.clone());
                    }
                    if self.state["records"].get(&owner_id).map(|v| !v.is_null()).unwrap_or(false) {
                        identities.push(owner_id.clone());
                    }
                    let mut existing: Vec<String> = identities.into_iter().filter(|id| self.state["records"].get(id).map(|v| !v.is_null()).unwrap_or(false)).collect();
                    existing.sort_by_key(|id| position(&mut record_order, &processed, id));
                    existing.dedup();
                    owner_id = existing.first().cloned().unwrap_or(owner_id);
                    if truthy(self.state["duplicateIds"].get(&owner_id)) {
                        self.backup(&mut backed_up, "statistics-before-identity-");
                        self.state["duplicateIds"].as_object_mut().unwrap().remove(&owner_id);
                    }
                    for id in existing.iter().filter(|id| **id != owner_id) {
                        self.backup(&mut backed_up, "statistics-before-identity-");
                        let candidate = self.state["records"][id].clone();
                        let owner = self.state["records"][&owner_id].clone();
                        let choice = select_usage_snapshot(Some(&owner), &candidate);
                        self.state["records"][&owner_id] = keep_identity(&owner, &choice.record);
                        if choice.issue == Some(CONFLICT) {
                            add_error(&mut errors, CONFLICT);
                            let owner_agent = owner.get("agent").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            if !conflicts.contains(&owner_agent) {
                                conflicts.push(owner_agent);
                            }
                        }
                        self.state["duplicateIds"][id] = json!(owner_id);
                    }
                    if owner_id != record_id {
                        self.backup(&mut backed_up, "statistics-before-identity-");
                        self.state["duplicateIds"][&record_id] = json!(owner_id);
                        if self.state["records"].get(&record_id).map(|v| v.is_null()).unwrap_or(true) {
                            self.state["records"][&record_id] = record.clone();
                        }
                    }
                    shared.insert(shared_key, owner_id.clone());
                }
                let old = self.state["records"].get(&owner_id).filter(|v| !v.is_null()).cloned();
                let choice = select_usage_snapshot(old.as_ref(), record);
                if let Some(issue) = choice.issue {
                    add_error(&mut errors, issue);
                }
                if choice.issue == Some(CONFLICT) {
                    let conflict_agent = old.as_ref().and_then(|o| o.get("agent")).and_then(|v| v.as_str()).or_else(|| record.get("agent").and_then(|v| v.as_str())).unwrap_or("").to_string();
                    if !conflicts.contains(&conflict_agent) {
                        conflicts.push(conflict_agent);
                    }
                }
                if let Some(old) = &old {
                    if old.get("sharedKey").and_then(|v| v.as_str()).map(|k| Some(k) != record.get("sharedKey").and_then(|v| v.as_str())).unwrap_or(false) {
                        self.backup(&mut backed_up, "statistics-before-identity-");
                    }
                }
                let mut saved = match &old {
                    Some(old) => {
                        if stringify(&choice.record) == stringify(old) {
                            old.clone()
                        } else {
                            keep_identity(old, &choice.record)
                        }
                    }
                    None => choice.record,
                };
                if record.get("sharedKey").and_then(|v| v.as_str()).is_some()
                    && (saved.get("sharedKey") != record.get("sharedKey") || stringify(saved.get("sharedRecordIds").unwrap_or(&Value::Null)) != stringify(record.get("sharedRecordIds").unwrap_or(&Value::Null)))
                {
                    saved["sharedKey"] = record["sharedKey"].clone();
                    saved["sharedRecordIds"] = record.get("sharedRecordIds").cloned().unwrap_or(Value::Null);
                }
                if record.get("csvIdentity").and_then(|v| v.as_str()).is_some() && saved.get("csvIdentity") != record.get("csvIdentity") {
                    saved["csvIdentity"] = record["csvIdentity"].clone();
                }
                self.state["records"][&owner_id] = saved;
                if let Some(order) = record_order.as_mut() {
                    if !order.contains_key(&owner_id) {
                        order.insert(owner_id.clone(), order.len());
                    }
                } else {
                    processed.push(owner_id);
                }
            }
            result.errors = errors.clone();
            result.partial = result.partial || !errors.is_empty();
            for entry in &result.sessions {
                let key = entry.get("key").and_then(|v| v.as_str()).unwrap_or("");
                let mut meta = json!({"agent": agent, "id": entry.get("id"), "cwd": entry.get("cwd").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null)});
                if truthy(entry.get("title")) {
                    meta["title"] = entry["title"].clone();
                }
                if truthy(entry.get("at")) {
                    meta["at"] = entry["at"].clone();
                }
                self.state["sessions"][key] = meta;
            }
            let previous = self.state["statuses"].get(&agent).cloned();
            let mut times: Vec<String> = result.records.iter().filter_map(|r| r.get("timestamp").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
            times.sort();
            let mut field_support = Map::new();
            for field in ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"] {
                let known = result.records.iter().filter(|r| !truthy(r.get("usageConflict")) && r.get(field).map(|v| !v.is_null()).unwrap_or(false)).count();
                field_support.insert(field.into(), json!(if known == 0 { "unobserved" } else if known == result.records.len() { "observed-all-records" } else { "observed-some-records" }));
            }
            let validation_verified = self.validation.get(&agent).and_then(|v| v.get("verified")).and_then(|v| v.as_bool()).unwrap_or(false);
            let parser_ok = agent != "codex" || self.validation.get(&agent).and_then(|v| v.get("parserVersion")).and_then(|v| v.as_str()) == Some("m1-projection/2");
            let real_sample_verified = validation_verified && parser_ok;
            let status = if !result.detected {
                "not-detected"
            } else if !result.errors.is_empty() && result.records.is_empty() {
                "error"
            } else if result.partial || result.records.iter().any(|r| r.get("quality").and_then(|v| v.as_str()) != Some("measured")) {
                "partial"
            } else if real_sample_verified {
                "verified"
            } else {
                "unverified"
            };
            let mut quality_issues = Map::new();
            for record in &result.records {
                let quality = record.get("quality").and_then(|v| v.as_str()).unwrap_or("");
                if quality != "measured" {
                    let count = quality_issues.get(quality).and_then(|v| v.as_u64()).unwrap_or(0);
                    quality_issues.insert(quality.to_string(), json!(count + 1));
                }
            }
            let mut fields = Map::new();
            fields.insert("totalTokens".into(), json!(if result.records.is_empty() { "unobserved" } else { "observed" }));
            for (field, value) in field_support {
                fields.insert(field, value);
            }
            fields.insert("accountQuota".into(), json!(false));
            fields.insert("actualBill".into(), json!(false));
            let last_success = if !result.errors.is_empty() || result.partial {
                previous.as_ref().and_then(|p| p.get("lastSuccess")).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null)
            } else {
                json!(at)
            };
            self.state["statuses"][&agent] = json!({
                "schemaVersion": "SourceCapability",
                "agent": agent, "label": crate::policy::labels().get(&agent).cloned().unwrap_or(Value::Null),
                "detected": result.detected, "observedRecords": result.records.len(), "fileCount": result.file_count,
                "status": status,
                "lastAttempt": at, "lastSuccess": last_success,
                "errors": result.errors, "malformedLines": result.skipped, "durationMs": result.duration_ms,
                "qualityIssues": quality_issues,
                "parserVersion": format!("{} + tokscale/{}", if agent == "codex" { "m1-projection/2" } else { "m1-projection/1" }, crate::native::TOKSCALE_VERSION),
                "realSampleVerified": real_sample_verified,
                "coverageStart": times.first().cloned().map(|t| json!(t)).unwrap_or_else(|| previous.as_ref().and_then(|p| p.get("coverageStart")).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null)),
                "coverageEnd": times.last().cloned().map(|t| json!(t)).unwrap_or_else(|| previous.as_ref().and_then(|p| p.get("coverageEnd")).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null)),
                "fields": fields,
                "nativeVerification": native.get("status").cloned().unwrap_or(Value::Null)
            });
        }
        for agent in &conflicts {
            let status = self.state["statuses"].get_mut(agent);
            if let Some(status) = status {
                let mut errors: Vec<Value> = status.get("errors").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                if !errors.iter().any(|e| e.as_str() == Some(CONFLICT)) {
                    errors.push(json!(CONFLICT));
                }
                status["errors"] = Value::Array(errors);
                status["status"] = json!(if truthy(status.get("detected")) { "partial" } else { "not-detected" });
                status["lastSuccess"] = previous_success.get(agent).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null);
            }
        }
        let digest = self.digest();
        if Some(digest.clone()) != self.persisted_digest {
            self.state["sequence"] = json!(self.state["sequence"].as_i64().unwrap_or(0) + 1);
            self.state["updatedAt"] = json!(at);
            let ledger = path::join(&[&self.dir, "statistics.json"]);
            let state = self.state.clone();
            self.collection_write(&ledger, &state)?;
            self.persisted_digest = Some(digest);
        }
        if self.staging {
            Ok(None)
        } else {
            Ok(Some(self.snapshot()?))
        }
    }

    pub fn prepare_collection(&mut self, scan: Option<&Scan>, native: &Value, custom: Option<&Value>) -> Result<Option<Batch>, String> {
        let custom_changed = custom
            .and_then(|c| c.as_object())
            .map(|entries| {
                entries.iter().any(|(id, result)| {
                    let source = self.state.get("customSources").and_then(|s| s.get(id));
                    match source {
                        Some(source) if truthy(source.get("enabled")) && !truthy(source.get("archived")) => {
                            let mut next = source.as_object().cloned().unwrap_or_default();
                            for key in ["files", "diagnostics", "fileCount"] {
                                if let Some(value) = result.get(key) {
                                    next.insert(key.into(), value.clone());
                                }
                            }
                            stringify(source) != stringify(&Value::Object(next))
                        }
                        _ => false,
                    }
                })
            })
            .unwrap_or(false);
        if scan.is_none() && !custom_changed {
            return Ok(None);
        }
        let mut draft = self.clone();
        draft.writes = Vec::new();
        let cloned = self.collection_state();
        draft.state = self.metrics.measure("clone", || Ok(cloned))?;
        draft.snapshot_cache = None;
        draft.staging = true;
        draft.collection_previous = Some((self.state.clone(), self.snapshot_cache.clone().unwrap_or(Value::Null)));
        if let Some(scan) = scan {
            draft.ingest_draft(scan, native)?;
        }
        if let Some(custom) = custom {
            draft.ingest_custom(custom)?;
        }
        let digest = draft.persisted_digest.clone().unwrap_or_else(|| draft.digest());
        let ledger = path::join(&[&self.dir, "statistics.json"]);
        let changed = draft.writes.iter().any(|(file, _)| file == &ledger) && Some(digest.clone()) != self.persisted_digest;
        draft.state["sequence"] = json!(self.state["sequence"].as_i64().unwrap_or(0) + if changed { 1 } else { 0 });
        let mut snapshot = None;
        if changed {
            draft.state["updatedAt"] = json!(iso_from_ms(now_ms()));
            draft.snapshot_cache = None;
            snapshot = Some(draft.snapshot()?);
        }
        Ok(Some(Batch { writes: std::mem::take(&mut draft.writes), draft, ledger, digest, changed, scan: scan.cloned(), snapshot }))
    }

    pub fn commit_collection(&mut self, batch: Batch, verified_at: Option<&str>) -> Result<Value, String> {
        let Batch { mut draft, writes, ledger, digest, changed, scan, mut snapshot } = batch;
        if let Some(verified_at) = verified_at {
            if let Some(scan) = &scan {
                for agent in sources() {
                    if let Some(status) = draft.state["statuses"].get_mut(&agent) {
                        status["lastAttempt"] = json!(verified_at);
                        let errors_empty = status.get("errors").and_then(|v| v.as_array()).map(|e| e.is_empty()).unwrap_or(true);
                        let partial = scan.get(&agent).map(|r| r.partial).unwrap_or(false);
                        if errors_empty && !partial {
                            status["lastSuccess"] = json!(verified_at);
                        }
                    }
                }
            }
            if changed {
                draft.state["updatedAt"] = json!(verified_at);
                if let Some(snapshot) = snapshot.as_mut() {
                    snapshot["collectedAt"] = json!(verified_at);
                    snapshot["generatedAt"] = json!(verified_at);
                }
            }
        }
        if changed {
            for (file, value) in &writes {
                if file != &ledger {
                    if let Some(value) = value {
                        atomic(Path::new(file), value, true).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
                    }
                }
            }
            let state = draft.state.clone();
            self.collection_write(&ledger, &state)?;
            self.state = draft.state;
            self.snapshot_cache = snapshot;
            self.projection_basis = draft.projection_basis;
            self.projection_calendar = draft.projection_calendar;
            self.workbench_cache = None;
            self.persisted_digest = Some(digest);
        } else if scan.is_some() {
            self.state = draft.state;
        }
        self.snapshot()
    }

    pub fn ingest_collection(&mut self, scan: Option<&Scan>, native: &Value, custom: Option<&Value>) -> Result<Value, String> {
        match self.prepare_collection(scan, native, custom)? {
            Some(batch) => self.commit_collection(batch, None),
            None => self.snapshot(),
        }
    }

    pub fn commit_custom(&mut self, source: &Value, records: &[Value]) -> Result<bool, String> {
        let source_id = source.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let old = self.state.get("customSources").and_then(|s| s.get(source_id)).cloned();
        if stringify(old.as_ref().unwrap_or(&Value::Null)) == stringify(source) {
            return Ok(false);
        }
        let mut state = self.state.as_object().cloned().unwrap_or_default();
        let mut custom_sources = self.state.get("customSources").and_then(|v| v.as_object()).cloned().unwrap_or_default();
        custom_sources.insert(source_id.to_string(), source.clone());
        state.insert("customSources".into(), Value::Object(custom_sources));
        let mut records_map = self.state["records"].as_object().cloned().unwrap_or_default();
        records_map.retain(|_, record| record.get("agent").and_then(|v| v.as_str()) != Some(source_id));
        for record in records {
            records_map.insert(record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), record.clone());
        }
        state.insert("records".into(), Value::Object(records_map));
        state.insert("statuses".into(), self.state["statuses"].clone());
        let updated_at = iso_from_ms(now_ms());
        state.insert("sequence".into(), json!(self.state["sequence"].as_i64().unwrap_or(0) + 1));
        state.insert("updatedAt".into(), json!(updated_at));
        let mut state = Value::Object(state);
        let d = source.get("diagnostics").cloned().unwrap_or(json!({}));
        let mut errors: Vec<Value> = d.get("errors").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if truthy(d.get("invalid")) {
            errors.push(json!("SOURCE_ROW_INVALID"));
        }
        if truthy(d.get("unsupported")) {
            errors.push(json!("CUSTOM_COUNTER_UNSUPPORTED"));
        }
        if truthy(d.get("conflicts")) {
            errors.push(json!(CONFLICT));
        }
        if truthy(d.get("retained")) {
            errors.push(json!("CUSTOM_HISTORY_RETAINED"));
        }
        let status = if !errors.is_empty() || records.iter().any(|r| r.get("quality").and_then(|v| v.as_str()) != Some("measured")) { "partial" } else { "unverified" };
        let last_success = if errors.is_empty() {
            json!(updated_at)
        } else {
            self.state["statuses"].get(source_id).and_then(|s| s.get("lastSuccess")).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null)
        };
        state["statuses"][source_id] = json!({
            "agent": source_id, "status": status, "lastSuccess": last_success,
            "observedRecords": records.len(), "realSampleVerified": false, "errors": errors,
            "parserVersion": format!("custom-jsonl/1:{}", source.get("version").and_then(|v| v.as_i64()).unwrap_or(1))
        });
        if truthy(source.get("previous")) && old.as_ref().and_then(|o| o.get("version")) != source.get("version") {
            if let Some(old) = &old {
                let file = path::join(&[&self.dir, "backups", &format!("custom-{source_id}-{}.json", state["sequence"].as_i64().unwrap_or(0))]);
                self.collection_write(&file, old)?;
            }
        }
        if self.state.get("customSources").and_then(|v| v.as_object()).map(|m| m.is_empty()).unwrap_or(true) {
            let suffix: String = rand::random::<[u8; 4]>().iter().map(|b| format!("{b:02x}")).collect();
            let file = path::join(&[&self.dir, "backups", &format!("statistics-before-custom-v1-{}-{suffix}.json", now_ms())]);
            let current = self.state.clone();
            self.collection_write(&file, &current)?;
        }
        let ledger = path::join(&[&self.dir, "statistics.json"]);
        self.collection_write(&ledger, &state)?;
        self.state = state;
        self.snapshot_cache = None;
        self.workbench_cache = None;
        self.persisted_digest = None;
        Ok(true)
    }

    pub fn ingest_custom(&mut self, results: &Value) -> Result<(), String> {
        if let Some(entries) = results.as_object() {
            for (id, result) in entries {
                let source = self.state.get("customSources").and_then(|s| s.get(id)).cloned();
                if let Some(source) = source {
                    if truthy(source.get("enabled")) && !truthy(source.get("archived")) {
                        let mut next = source.as_object().cloned().unwrap_or_default();
                        for key in ["files", "diagnostics", "fileCount"] {
                            if let Some(value) = result.get(key) {
                                next.insert(key.into(), value.clone());
                            }
                        }
                        let records: Vec<Value> = result.get("records").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                        self.commit_custom(&Value::Object(next), &records)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn catalog_hash(&self) -> String {
        self.model_catalog_hash.clone()
    }

    pub fn override_hash(&self) -> String {
        sha256_text(&stringify(&self.overrides))
    }

    pub fn pricing(&mut self, view: Option<&str>) -> Result<Value, String> {
        if view == Some("coverage") {
            let fallback = truthy(self.billing.get("fallback"));
            let floor = truthy(self.billing.get("partialLowerBound"));
            return Ok(if fallback || floor {
                let mut pricing = self.current_pricing();
                valuation::coverage_of(&mut pricing, &self.records())
            } else {
                Value::Null
            });
        }
        if view.is_some() {
            return Err("PRICE_SETTING_INVALID".to_string());
        }
        let base = pricing::catalog();
        let mut models: Map<String, Value> = Map::new();
        if let Some(entries) = self.model_catalog.as_object() {
            for (key, rates) in entries {
                let cut = key.find('/').unwrap_or(0);
                models.insert(
                    key.clone(),
                    json!({"provider": &key[..cut], "model": &key[cut + 1..], "rates": rates,
                        "origin": rates.get("provenance").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or(json!("reference-unverified")),
                        "source": rates.get("source").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or_else(|| base["source"].clone())}),
                );
            }
        }
        let records = self.records();
        for record in &records {
            let key = format!("{}/{}", record.get("provider").and_then(|v| v.as_str()).unwrap_or(""), record.get("model").and_then(|v| v.as_str()).unwrap_or(""));
            if !models.contains_key(&key) {
                models.insert(
                    key.clone(),
                    json!({"provider": record.get("provider"), "model": record.get("model"), "rates": {}, "origin": "unpriced", "source": null,
                        "numbered": is_identifier(record.get("model").unwrap_or(&Value::Null)) && is_identifier(record.get("provider").unwrap_or(&Value::Null))}),
                );
            }
            let resolved = self.resolve_price(record);
            let row = models.get_mut(&key).unwrap();
            row["observed"] = json!(true);
            let rates = resolved.get("rates").filter(|v| !v.is_null());
            if rates.map(|r| r.get("provenance").and_then(|v| v.as_str()) != Some("reference-unverified")).unwrap_or(false) {
                row["rates"] = rates.cloned().unwrap_or(Value::Null);
                row["origin"] = resolved.get("origin").cloned().unwrap_or(Value::Null);
                row["target"] = resolved.get("target").cloned().unwrap_or(Value::Null);
            }
        }
        if let Some(entries) = self.overrides.as_object() {
            for (key, rates) in entries {
                let cut = key.find('/').unwrap_or(0);
                let mut row = models.get(key).and_then(|v| v.as_object()).cloned().unwrap_or_default();
                row.insert("provider".into(), json!(&key[..cut]));
                row.insert("model".into(), json!(&key[cut + 1..]));
                row.insert("rates".into(), rates.clone());
                row.insert("origin".into(), json!("manual"));
                row.insert("source".into(), Value::Null);
                row.insert("numbered".into(), json!(true));
                models.insert(key.clone(), Value::Object(row));
            }
        }
        let observed_rows: Vec<Value> = models.values().filter(|row| truthy(row.get("observed"))).cloned().collect();
        let suggestions = model_aliases::suggest(&observed_rows, &self.model_catalog, &self.overrides);
        let observed: Vec<Value> = observed_rows
            .iter()
            .map(|row| {
                json!({"provider": row.get("provider"), "model": row.get("model"), "target": row.get("target").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
                    "priced": !["unpriced", "reference-unverified"].contains(&row.get("origin").and_then(|v| v.as_str()).unwrap_or(""))})
            })
            .collect();
        let priced = models
            .values()
            .filter(|row| {
                !["unpriced", "reference-unverified", "official-thirdparty-unverified"].contains(&row.get("origin").and_then(|v| v.as_str()).unwrap_or(""))
                    && row.get("rates").and_then(|r| r.get("inputUncached")).and_then(|v| v.as_f64()).map(|v| v.is_finite()).unwrap_or(false)
                    && row.get("rates").and_then(|r| r.get("output")).and_then(|v| v.as_f64()).map(|v| v.is_finite()).unwrap_or(false)
            })
            .count();
        let unpriced = models.values().filter(|row| row.get("origin").and_then(|v| v.as_str()) == Some("unpriced")).count();
        let manual = models.values().filter(|row| row.get("origin").and_then(|v| v.as_str()) == Some("manual")).count();
        let model_rows: Vec<Value> = models
            .values()
            .map(|row| {
                let mut next = row.as_object().cloned().unwrap_or_default();
                let rates = row.get("rates").cloned().unwrap_or(json!({}));
                let scaled: Map<String, Value> = FIELDS
                    .iter()
                    .map(|field| {
                        let value = rates.get(*field).and_then(|v| v.as_f64()).filter(|v| v.is_finite());
                        (field.to_string(), value.map(|v| json!(v * 1e6)).unwrap_or(Value::Null))
                    })
                    .collect();
                next.insert("rates".into(), Value::Object(scaled));
                Value::Object(next)
            })
            .collect();
        let version = if self.remote_catalog.is_some() { json!(format!("{}+models-dev/1", base["version"].as_str().unwrap_or(""))) } else { base["version"].clone() };
        Ok(json!({
            "version": version,
            "obtainedAt": self.remote_catalog.as_ref().and_then(|r| r.get("obtainedAt")).filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or_else(|| base["obtainedAt"].clone()),
            "sha256": self.catalog_hash(), "overrideSha256": self.override_hash(),
            "basis": base["basis"], "source": base["source"], "currencies": ["USD"],
            "tiers": base.get("tiers").cloned().unwrap_or(json!({})),
            "billing": self.billing,
            "suggestions": suggestions,
            "observed": observed,
            "counts": {"models": models.len(), "priced": priced, "unpriced": unpriced, "manual": manual},
            "models": model_rows
        }))
    }

    pub fn probe(&mut self, entry: &Value) -> Result<Value, String> {
        let value = validate(entry)?;
        let key = format!("{}/{}", value["provider"].as_str().unwrap(), value["model"].as_str().unwrap());
        let previous = self.overrides.get(&key).filter(|v| !v.is_null()).cloned().or_else(|| self.model_catalog.get(&key).filter(|v| !v.is_null()).cloned());
        let records = self.records();
        let mut affected_records = 0u64;
        let mut affected_tokens = 0i64;
        let mut matching: Vec<Value> = Vec::new();
        for record in &records {
            if format!("{}/{}", record.get("provider").and_then(|v| v.as_str()).unwrap_or(""), record.get("model").and_then(|v| v.as_str()).unwrap_or("")) != key {
                continue;
            }
            affected_records += 1;
            affected_tokens += record.get("totalTokens").and_then(|v| v.as_i64()).unwrap_or(0);
            matching.push(record.clone());
        }
        let mut overrides = self.overrides.as_object().cloned().unwrap_or_default();
        overrides.insert(key.clone(), value["rates"].clone());
        let mut pricing = Pricing::new(Value::Object(overrides), self.model_catalog.clone(), self.billing.clone());
        let coverage = valuation::coverage_of(&mut pricing, &matching);
        let sample = matching.first();
        let mut sample_eval: Option<Eval> = None;
        if let Some(sample) = sample {
            let mut rates = value["rates"].as_object().cloned().unwrap_or_default();
            rates.insert("provenance".into(), json!("manual"));
            rates.insert("billingProvider".into(), value["provider"].clone());
            let mut eval = evaluate(sample, &json!({}), Some(&Value::Object(rates)));
            if eval.lower.is_some() {
                let multiplier = self.billing.get("defaults").and_then(|d| d.get(sample.get("agent").and_then(|v| v.as_str()).unwrap_or(""))).and_then(|d| d.get("multiplier")).and_then(|v| v.as_f64()).unwrap_or(1.0);
                eval.lower = eval.lower.map(|l| l * multiplier);
                eval.upper = eval.upper.map(|u| u * multiplier);
            }
            sample_eval = Some(eval);
        }
        let previous_rates = previous.as_ref().map(|previous| {
            Value::Object(
                FIELDS
                    .iter()
                    .map(|field| {
                        let value = previous.get(*field).and_then(|v| v.as_f64()).filter(|v| v.is_finite());
                        (field.to_string(), value.map(|v| json!(v * 1e6)).unwrap_or(Value::Null))
                    })
                    .collect::<Map<String, Value>>(),
            )
        });
        Ok(json!({
            "key": key, "provider": value["provider"], "model": value["model"], "rates": value["rates"],
            "origin": if self.overrides.get(&key).map(|v| !v.is_null()).unwrap_or(false) { json!("manual") }
                else { previous.as_ref().map(|p| p.get("provenance").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or(json!("reference-unverified"))).unwrap_or(json!("unpriced")) },
            "previous": previous_rates.unwrap_or(Value::Null),
            "affectedRecords": affected_records, "affectedTokens": affected_tokens, "coverage": coverage,
            "sample": sample_eval.map(|eval| json!({"reason": eval.reason, "lower": eval.lower, "upper": eval.upper})).unwrap_or(Value::Null)
        }))
    }

    pub fn price_try(&mut self, request: &Value) -> Result<Value, String> {
        let key = request.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let targets = request.get("targets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if request.get("key").map(|v| !v.is_string()).unwrap_or(true) || targets.len() > 16 || targets.iter().any(|target| !valuation::valid_price_target(target, &self.overrides, &self.model_catalog)) {
            return Err("PRICE_SETTING_INVALID".to_string());
        }
        let records: Vec<Value> = self.records().into_iter().filter(|r| format!("{}/{}", r.get("provider").and_then(|v| v.as_str()).unwrap_or(""), r.get("model").and_then(|v| v.as_str()).unwrap_or("")) == key).collect();
        let base_pricing = self.current_pricing();
        let current = {
            let mut pricing = base_pricing.clone();
            valuation::coverage_of(&mut pricing, &records)
        };
        let mut results = Vec::new();
        for target in &targets {
            let mut billing = self.billing.as_object().cloned().unwrap_or_default();
            let mut mappings = billing.get("mappings").and_then(|v| v.as_object()).cloned().unwrap_or_default();
            mappings.insert(key.to_string(), target.clone());
            billing.insert("mappings".into(), Value::Object(mappings));
            let mut pricing = Pricing::new(self.overrides.clone(), self.model_catalog.clone(), Value::Object(billing));
            results.push(json!({"target": target, "coverage": valuation::coverage_of(&mut pricing, &records)}));
        }
        Ok(json!({"key": key, "manual": self.overrides.get(key).map(|v| !v.is_null()).unwrap_or(false), "current": current, "results": results}))
    }

    pub fn price_plan(&mut self, request: &Value) -> Result<Value, String> {
        let auto = request.get("auto").and_then(|v| v.as_bool()).unwrap_or(true);
        let partial = request.get("partial").and_then(|v| v.as_bool()).unwrap_or(false);
        let fallback = request.get("fallback").filter(|v| !v.is_null()).cloned();
        if let Some(fallback) = &fallback {
            if !valuation::valid_price_target(fallback, &self.overrides, &self.model_catalog) {
                return Err("PRICE_SETTING_INVALID".to_string());
            }
        }
        let records = self.records();
        let mut groups: indexmap::IndexMap<String, Vec<Value>> = indexmap::IndexMap::new();
        for record in &records {
            let key = format!("{}/{}", record.get("provider").and_then(|v| v.as_str()).unwrap_or(""), record.get("model").and_then(|v| v.as_str()).unwrap_or(""));
            groups.entry(key).or_default().push(record.clone());
        }
        let observed: Vec<Value> = groups.values().map(|list| json!({"provider": list[0].get("provider"), "model": list[0].get("model")})).collect();
        let suggestions = model_aliases::suggest(&observed, &self.model_catalog, &self.overrides);
        let plan_overrides = self.overrides.clone();
        let plan_models = self.model_catalog.clone();
        let rules = |billing: &Value| Pricing::new(plan_overrides.clone(), plan_models.clone(), billing.clone());
        let closable = |coverage: &Value| -> i64 {
            coverage.get("left").and_then(|v| v.as_array()).map(|rows| {
                rows.iter()
                    .filter(|row| FIXABLE.contains(&row.get("reason").and_then(|v| v.as_str()).unwrap_or("")))
                    .map(|row| row.get("tokens").and_then(|v| v.as_i64()).unwrap_or(0))
                    .sum()
            }).unwrap_or(0)
        };
        let mut base = self.billing.as_object().cloned().unwrap_or_default();
        base.remove("fallback");
        base.remove("partialLowerBound");
        let base = Value::Object(base);
        let start = rules(&base);
        let agents_of = |list: &[Value]| -> Vec<Value> {
            let mut agents: Vec<Value> = Vec::new();
            for record in list {
                let agent = record.get("agent").cloned().unwrap_or(Value::Null);
                if !agents.contains(&agent) {
                    agents.push(agent);
                }
            }
            agents
        };
        let mut matched: Vec<Value> = Vec::new();
        let mut undecided: Vec<Value> = Vec::new();
        for (key, list) in &groups {
            let current = {
                let mut pricing = start.clone();
                valuation::coverage_of(&mut pricing, list)
            };
            let open = closable(&current);
            if open == 0 {
                continue;
            }
            let candidates: Vec<Value> = if self.overrides.get(key).map(|v| !v.is_null()).unwrap_or(false) {
                Vec::new()
            } else {
                suggestions.get(key).and_then(|s| s.get("candidates")).and_then(|v| v.as_array()).cloned().unwrap_or_default()
            };
            let mut whole: Vec<(Value, Value)> = Vec::new();
            for candidate in &candidates {
                let mut billing = base.as_object().cloned().unwrap_or_default();
                let mut mappings = billing.get("mappings").and_then(|v| v.as_object()).cloned().unwrap_or_default();
                mappings.insert(key.clone(), candidate["target"].clone());
                billing.insert("mappings".into(), Value::Object(mappings));
                let coverage = {
                    let mut pricing = rules(&Value::Object(billing));
                    valuation::coverage_of(&mut pricing, list)
                };
                if closable(&coverage) == 0 && coverage.get("counted").and_then(|v| v.as_i64()).unwrap_or(0) > current.get("counted").and_then(|v| v.as_i64()).unwrap_or(0) {
                    whole.push((candidate.clone(), coverage));
                }
            }
            let mut prices: Vec<String> = Vec::new();
            for (candidate, _) in &whole {
                let text = stringify(&candidate["rates"]);
                if !prices.contains(&text) {
                    prices.push(text);
                }
            }
            if prices.len() == 1 {
                let (candidate, coverage) = &whole[0];
                matched.push(json!({"key": key, "target": candidate["target"],
                    "tokens": coverage["counted"].as_i64().unwrap_or(0) - current["counted"].as_i64().unwrap_or(0),
                    "lower": coverage["lower"], "agents": agents_of(list)}));
            } else {
                let why = if self.overrides.get(key).map(|v| !v.is_null()).unwrap_or(false) {
                    "manual-incomplete"
                } else if prices.len() > 1 {
                    "several-prices"
                } else if !candidates.is_empty() {
                    "no-whole-candidate"
                } else {
                    "no-candidate"
                };
                undecided.push(json!({"key": key, "tokens": open, "agents": agents_of(list), "candidates": candidates.len(), "why": why}));
            }
        }
        let mut mappings = Map::new();
        if auto {
            for item in &matched {
                mappings.insert(item["key"].as_str().unwrap_or("").to_string(), item["target"].clone());
            }
        }
        let mut step_a = base.as_object().cloned().unwrap_or_default();
        let mut base_mappings = step_a.get("mappings").and_then(|v| v.as_object()).cloned().unwrap_or_default();
        for (key, value) in &mappings {
            base_mappings.insert(key.clone(), value.clone());
        }
        step_a.insert("mappings".into(), Value::Object(base_mappings));
        let step_a = Value::Object(step_a);
        let mut step_b = step_a.clone();
        if let Some(fallback) = &fallback {
            step_b["fallback"] = fallback.clone();
        }
        let mut step_c = step_b.clone();
        step_c["partialLowerBound"] = json!(true);
        let lefts: Vec<Value> = if auto {
            undecided.clone()
        } else {
            let mut rows: Vec<Value> = matched.iter().map(|item| json!({"key": item["key"], "tokens": item["tokens"], "agents": item["agents"], "candidates": 1, "why": "auto-off"})).collect();
            rows.extend(undecided.iter().cloned());
            rows
        };
        let gain = |from: &Pricing, to: &Pricing| -> Value {
            let mut models: Vec<Value> = Vec::new();
            let mut tokens = 0i64;
            let mut usd = 0f64;
            for (key, list) in &groups {
                let a = {
                    let mut pricing = from.clone();
                    valuation::coverage_of(&mut pricing, list)
                };
                let b = {
                    let mut pricing = to.clone();
                    valuation::coverage_of(&mut pricing, list)
                };
                let more = b.get("counted").and_then(|v| v.as_i64()).unwrap_or(0) - a.get("counted").and_then(|v| v.as_i64()).unwrap_or(0);
                if more > 0 {
                    let added = b.get("lower").and_then(|v| v.as_f64()).unwrap_or(0.0) - a.get("lower").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    models.push(json!({"key": key, "tokens": more, "lower": added, "agents": agents_of(list)}));
                    tokens += more;
                    usd += added;
                }
            }
            models.sort_by(|a, b| b["tokens"].as_i64().unwrap_or(0).cmp(&a["tokens"].as_i64().unwrap_or(0)));
            json!({"models": models, "tokens": tokens, "lower": usd})
        };
        let final_rules = rules(if partial { &step_c } else { &step_b });
        let before = {
            let mut pricing = self.current_pricing();
            valuation::coverage_of(&mut pricing, &records)
        };
        let after = {
            let mut pricing = final_rules.clone();
            valuation::coverage_of(&mut pricing, &records)
        };
        let fallback_view = match &fallback {
            Some(fallback) => {
                let mut view = json!({"target": fallback});
                let gained = gain(&rules(&step_a), &rules(&step_b));
                for (key, value) in gained.as_object().unwrap() {
                    view[key] = value.clone();
                }
                view
            }
            None => Value::Null,
        };
        Ok(json!({
            "before": before, "matched": matched, "undecided": lefts,
            "fallback": fallback_view, "floor": gain(&rules(&step_b), &rules(&step_c)),
            "after": after, "mappings": mappings
        }))
    }

    pub fn set_price(&mut self, entry: &Value, remove: bool) -> Result<Value, String> {
        let mut checked = entry.clone();
        if remove {
            checked["inputUncached"] = json!(0);
            checked["output"] = json!(0);
            checked["cacheRead"] = Value::Null;
            checked["cacheWrite"] = Value::Null;
        }
        let value = validate(&checked)?;
        let key = format!("{}/{}", value["provider"].as_str().unwrap(), value["model"].as_str().unwrap());
        let mut next = self.overrides.as_object().cloned().unwrap_or_default();
        if remove {
            next.remove(&key);
        } else {
            next.insert(key, value["rates"].clone());
        }
        let next = Value::Object(next);
        valuation::check_price_references(&self.billing, (&self.overrides, &self.model_catalog), (&next, &self.model_catalog))?;
        atomic(Path::new(&path::join(&[&self.dir, "pricing.json"])), &next, false).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        self.overrides = next;
        self.snapshot_cache = None;
        self.workbench_cache = None;
        self.pricing(None)
    }

    pub fn install_catalog(&mut self, value: &Value) -> Result<(), String> {
        let verified = runtime_catalog::verify(value)?;
        let models = runtime_catalog::merged(Some(&verified));
        let hash = runtime_catalog::hash(&models);
        valuation::check_price_references(&self.billing, (&self.overrides, &self.model_catalog), (&self.overrides, &models))?;
        atomic(Path::new(&path::join(&[&self.dir, "model-pricing.json"])), &verified, false).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        self.remote_catalog = Some(verified);
        self.downloaded_catalog = true;
        self.model_catalog = models;
        self.model_catalog_hash = hash;
        self.snapshot_cache = None;
        self.workbench_cache = None;
        Ok(())
    }

    pub fn validate_billing(&self, value: &Value, allow_missing: bool) -> Result<Value, String> {
        valuation::validate_billing(value, &self.overrides, &self.model_catalog, &self.catalog(), allow_missing)
    }

    pub fn set_billing(&mut self, value: &Value) -> Result<Value, String> {
        let next = self.validate_billing(value, false)?;
        atomic(Path::new(&path::join(&[&self.dir, "billing.json"])), &next, false).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        self.billing = next;
        self.snapshot_cache = None;
        self.workbench_cache = None;
        self.pricing(None)
    }

    pub fn resume(&self, key: &str) -> Option<String> {
        let meta = self.state["sessions"].get(key)?;
        resume_command(meta.get("agent").and_then(|v| v.as_str()).unwrap_or(""), Some(meta))
    }

    pub fn directory(&self, key: &str) -> Option<String> {
        self.state["sessions"].get(key).and_then(|meta| meta.get("cwd")).and_then(|v| v.as_str()).filter(|c| !c.is_empty()).map(|s| s.to_string())
    }

    pub fn clear(&mut self) -> Result<(), String> {
        let mut next = self.state.as_object().cloned().unwrap_or_default();
        next.insert("records".into(), json!({}));
        next.insert("duplicateIds".into(), json!({}));
        next.insert("sessions".into(), json!({}));
        next.insert("statuses".into(), json!({}));
        next.insert("sequence".into(), json!(self.state["sequence"].as_i64().unwrap_or(0) + 1));
        next.insert("updatedAt".into(), Value::Null);
        if let Some(Value::Object(custom)) = self.state.get("customSources") {
            let cleared: Map<String, Value> = custom
                .iter()
                .map(|(id, source)| {
                    let mut next = source.as_object().cloned().unwrap_or_default();
                    next.insert("files".into(), json!({}));
                    next.insert("previous".into(), Value::Null);
                    (id.clone(), Value::Object(next))
                })
                .collect();
            next.insert("customSources".into(), Value::Object(cleared));
        }
        let next = Value::Object(next);
        atomic(Path::new(&path::join(&[&self.dir, "statistics.json"])), &next, true).map_err(|_| "LOCAL_STORAGE_INVALID".to_string())?;
        self.state = next;
        self.snapshot_cache = None;
        self.workbench_cache = None;
        self.persisted_digest = None;
        Ok(())
    }
}

pub fn empty_scan() -> Scan {
    sources().into_iter().map(|agent| (agent, Default::default())).collect()
}
