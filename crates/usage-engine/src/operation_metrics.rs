// Fixed keys and scalar aggregates; no request arguments, identifiers, paths,
// exception text, credentials or unbounded sample arrays.
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Clone, Default)]
struct Stage {
    count: u64,
    failed: u64,
    total_ms: f64,
    last_ms: f64,
    max_ms: f64,
}

#[derive(Clone)]
pub struct OperationMetrics {
    stages: HashMap<String, Stage>,
    stage_order: Vec<String>,
    counters: HashMap<String, u64>,
    counter_order: Vec<String>,
}

impl OperationMetrics {
    pub fn new(stages: &[&str], counters: &[&str]) -> Self {
        OperationMetrics {
            stages: stages.iter().map(|name| (name.to_string(), Stage::default())).collect(),
            stage_order: stages.iter().map(|s| s.to_string()).collect(),
            counters: counters.iter().map(|name| (name.to_string(), 0)).collect(),
            counter_order: counters.iter().map(|s| s.to_string()).collect(),
        }
    }

    pub fn count(&mut self, name: &str) -> Result<(), String> {
        match self.counters.get_mut(name) {
            Some(value) => {
                *value += 1;
                Ok(())
            }
            None => Err("METRIC_KEY_REJECTED".to_string()),
        }
    }

    pub fn measure<T>(&mut self, name: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        if !self.stages.contains_key(name) {
            return Err("METRIC_KEY_REJECTED".to_string());
        }
        let start = Instant::now();
        let result = action();
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        let row = self.stages.get_mut(name).unwrap();
        row.count += 1;
        if result.is_err() {
            row.failed += 1;
        }
        row.last_ms = elapsed;
        row.total_ms += elapsed;
        row.max_ms = row.max_ms.max(elapsed);
        result
    }

    pub fn state(&self) -> Value {
        let mut stages = Map::new();
        for name in &self.stage_order {
            let row = &self.stages[name];
            stages.insert(name.clone(), json!({"count": row.count, "failed": row.failed, "totalMs": row.total_ms, "lastMs": row.last_ms, "maxMs": row.max_ms}));
        }
        let mut counters = Map::new();
        for name in &self.counter_order {
            counters.insert(name.clone(), json!(self.counters[name]));
        }
        json!({"stages": stages, "counters": counters})
    }
}