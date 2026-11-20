use super::*;
use crate::time::{iso_from_ms, now_ms};

pub struct CodexMaintenance {
    summary: Value,
    roots: Value,
    rebuilt: Vec<Value>,
    retained: Vec<Value>,
}

impl CodexMaintenance {
    pub fn summary(&self) -> &Value {
        &self.summary
    }

    pub fn matches(&self, store: &Store, id: &str) -> bool {
        self.summary["id"] == id
            && self.summary["sequence"] == store.state["sequence"]
            && self.roots == store.source_roots()["codex"]
    }
}

impl Store {
    pub fn preview_codex_maintenance(&self) -> Result<CodexMaintenance, String> {
        let roots = self.source_roots()["codex"].clone();
        let salt = self.state["salt"]
            .as_str()
            .ok_or("MAINTENANCE_INCOMPLETE")?;
        let mut scan = crate::sources::scan_sources(
            &json!({"codex":roots}),
            salt,
            &mut crate::policy::Audit::new(),
            crate::sources::ScanOptions {
                cache: None,
                prepared: None,
            },
        );
        let result = scan
            .shift_remove("codex")
            .filter(|result| {
                !result.partial && result.errors.is_empty() && !result.records.is_empty()
            })
            .ok_or("MAINTENANCE_INCOMPLETE")?;
        let rebuilt: Vec<_> = result
            .records
            .into_iter()
            .map(|record| {
                let old = record["id"]
                    .as_str()
                    .and_then(|id| self.state["records"].get(id));
                old.filter(|old| old["quality"] == "measured" && record["quality"] != "measured")
                    .cloned()
                    .unwrap_or(record)
            })
            .collect();
        let sessions: HashSet<_> = rebuilt
            .iter()
            .filter_map(|record| record["sessionKey"].as_str())
            .collect();
        let previous: Vec<_> = self.state["records"]
            .as_object()
            .into_iter()
            .flat_map(Map::values)
            .filter(|record| record["agent"] == "codex")
            .collect();
        let retained: Vec<_> = previous
            .iter()
            .copied()
            .filter(|record| {
                !record["sessionKey"]
                    .as_str()
                    .is_some_and(|key| sessions.contains(key))
            })
            .cloned()
            .collect();
        let sum = |records: &[Value]| {
            records
                .iter()
                .map(|record| record["totalTokens"].as_f64().unwrap_or_default())
                .sum::<f64>()
        };
        let previous_tokens = previous
            .iter()
            .map(|record| record["totalTokens"].as_f64().unwrap_or_default())
            .sum::<f64>();
        let summary = json!({"id":uuid_v4(),"sequence":self.state["sequence"],"previousTokens":previous_tokens,
            "rebuiltTokens":sum(&rebuilt),"retainedTokens":sum(&retained),"records":rebuilt.len(),"files":result.file_count,"skipped":result.skipped});
        Ok(CodexMaintenance {
            summary,
            roots,
            rebuilt,
            retained,
        })
    }

    pub fn apply_codex_maintenance(
        &mut self,
        id: &str,
        candidate: &CodexMaintenance,
    ) -> Result<(), String> {
        if !candidate.matches(self, id) {
            return Err("MAINTENANCE_STALE".to_owned());
        }
        let mut next = self.state.clone();
        let mut records = Map::new();
        let previous = self.state["records"]
            .as_object()
            .into_iter()
            .flat_map(Map::values)
            .filter(|record| record["agent"] != "codex");
        for record in previous
            .chain(&candidate.retained)
            .chain(&candidate.rebuilt)
        {
            let id = record["id"].as_str().ok_or("MAINTENANCE_INCOMPLETE")?;
            records.insert(id.to_owned(), record.clone());
        }
        let status = &mut next["statuses"]["codex"];
        status["observedRecords"] = json!(candidate.rebuilt.len());
        status["parserVersion"] = json!("m1-projection/2 + tokscale/4.17.0");
        status["nativeVerification"] = json!("not-run-maintenance-preview");
        status["realSampleVerified"] = Value::Bool(false);
        status["status"] = json!("unverified");
        let now = iso_from_ms(now_ms());
        let sequence = next["sequence"]
            .as_u64()
            .and_then(|number| number.checked_add(1))
            .ok_or("MAINTENANCE_INCOMPLETE")?;
        next["records"] = Value::Object(records);
        next["sequence"] = json!(sequence);
        next["updatedAt"] = json!(now);
        let directory = Path::new(&self.dir);
        let backup = directory.join("backups").join(format!(
            "statistics-before-codex-{}.json",
            now.replace(':', "-")
        ));
        atomic(&backup, &self.state, true).map_err(|_| "LOCAL_STORAGE_INVALID")?;
        atomic(&directory.join("statistics.json"), &next, true)
            .map_err(|_| "LOCAL_STORAGE_INVALID")?;
        self.state = next;
        self.snapshot_cache = None;
        self.workbench_cache = None;
        self.persisted_digest = None;
        Ok(())
    }
}
