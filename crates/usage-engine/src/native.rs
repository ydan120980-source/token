// Inline native verification. The pinned tokscale-core (vendor/tokscale-core,
// upstream junhoyeo/tokscale tag v4.17.0, MIT) replaces the SHA-256-pinned
// tokscale.exe subprocess: the source pin travels with the ledger instead of a
// binary asset. The canonical statistics-only transcript, the eligibility rule
// and the total/schema checks are byte-identical to src/m1/native.js; the
// engine call is get_model_report, the same path the pinned CLI serves for
// `--json --client claude --home <home> --no-spinner`.
//
// Retired with the subprocess: NATIVE_BINARY_MISMATCH / NATIVE_UNAVAILABLE for
// binary bytes (no executable remains; the pin is the vendored source) and
// NATIVE_OUTPUT_LIMIT (no stdout channel). The 60s deadline covers the async
// pricing load; the synchronous parse itself is not preemptible in-process and
// runs under the host's collection watchdog (M3).
use crate::js_json::stringify;
use crate::pathx as path;
use serde_json::{json, Map, Value};
use std::fs;
use std::time::Duration;
use tokscale_core::{get_model_report, ReportOptions};

pub const TOKSCALE_VERSION: &str = "4.17.0";
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn verify_projection(records: &[Value], directory: &str) -> Result<Value, String> {
    fs::create_dir_all(directory).map_err(|_| "NATIVE_UNAVAILABLE".to_string())?;
    // tokscale keeps a per-path source-message cache that assumes append-only
    // transcripts; each check runs in its own fresh directory, as in native.js.
    let run = loop {
        let suffix: String = rand::random::<[u8; 6]>().iter().map(|b| format!("{b:02x}")).collect();
        let candidate = path::join(&[directory, &format!("native-{suffix}")]);
        match fs::create_dir(&candidate) {
            Ok(()) => break candidate,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("NATIVE_UNAVAILABLE".to_string()),
        }
    };
    let result = verify_in(records, &run);
    let _ = fs::remove_dir_all(&run);
    result
}

// Canonical statistics-only transcript: no original paths, titles, bodies,
// accounts or tokens beyond the counted total. Returns the exact file bytes,
// the eligible record count and the expected token sum (JS float addition).
pub fn canonical_transcript(records: &[Value]) -> (String, i64, f64) {
    let mut text = String::new();
    let mut eligible: i64 = 0;
    let mut expected: f64 = 0.0;
    for record in records {
        // JS `r.totalTokens >= 0`: null coerces to 0 and stays eligible;
        // missing, non-numeric and negative values are excluded.
        let tokens = match record.get("totalTokens") {
            Some(Value::Null) => 0.0,
            Some(Value::Number(number)) => match number.as_f64() {
                Some(value) if value >= 0.0 => value,
                _ => continue,
            },
            _ => continue,
        };
        eligible += 1;
        expected += tokens;
        let mut line = Map::new();
        line.insert("type".into(), json!("assistant"));
        if let Some(id) = record.get("id") {
            line.insert("uuid".into(), id.clone());
        }
        line.insert("sessionId".into(), json!("m1-projection"));
        if let Some(timestamp) = record.get("timestamp") {
            line.insert("timestamp".into(), timestamp.clone());
        }
        let mut message = Map::new();
        if let Some(id) = record.get("id") {
            message.insert("id".into(), id.clone());
        }
        message.insert("role".into(), json!("assistant"));
        message.insert("model".into(), json!("m1-statistical-projection"));
        message.insert("usage".into(), json!({"input_tokens": record.get("totalTokens").cloned().unwrap_or(Value::Null), "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}));
        line.insert("message".into(), Value::Object(message));
        text.push_str(&stringify(&Value::Object(line)));
        text.push('\n');
    }
    if eligible == 0 {
        text.push('\n');
    }
    (text, eligible, expected)
}

fn verify_in(records: &[Value], directory: &str) -> Result<Value, String> {
    let home = path::join(&[directory, "projection"]);
    let project = path::join(&[&home, ".claude", "projects", "statistics-only"]);
    fs::create_dir_all(&project).map_err(|_| "NATIVE_UNAVAILABLE".to_string())?;
    let file = path::join(&[&project, "usage.jsonl"]);
    let (text, eligible, expected) = canonical_transcript(records);
    fs::write(&file, text).map_err(|_| "NATIVE_UNAVAILABLE".to_string())?;

    // The pinned CLI child ran with a hermetic environment (no USERPROFILE/HOME,
    // so the engine's real-home lookups resolved to nothing). In-process the
    // engine reads the same switches from the process environment: the
    // config/cache root moves into this run directory, pricing stays cache-only
    // (the product owns its pricing catalog; tokscale never fetches), and HOME
    // points at the synthetic home because paths::home_dir() prefers it — the
    // claude parser's cc-mirror metadata lookup then stays inside the fixture
    // instead of reading the machine profile. Verification is serialized by the
    // collection queue, so the temporary overrides are saved and restored.
    let config = path::join(&[directory, "tokscale"]);
    fs::create_dir_all(&config).map_err(|_| "NATIVE_UNAVAILABLE".to_string())?;
    let previous_config = std::env::var_os("TOKSCALE_CONFIG_DIR");
    let previous_cache_only = std::env::var_os("TOKSCALE_PRICING_CACHE_ONLY");
    let previous_home = std::env::var_os("HOME");
    std::env::set_var("TOKSCALE_CONFIG_DIR", &config);
    std::env::set_var("TOKSCALE_PRICING_CACHE_ONLY", "1");
    std::env::set_var("HOME", &home);
    let options = ReportOptions { home_dir: Some(home.clone()), clients: Some(vec!["claude".to_string()]), ..Default::default() };
    let outcome = tokio::runtime::Builder::new_current_thread().enable_time().build().map_err(|_| "NATIVE_FAILED".to_string()).and_then(|runtime| {
        runtime.block_on(async { tokio::time::timeout(Duration::from_secs(60), get_model_report(options)).await })
            .map_err(|_| "NATIVE_TIMEOUT".to_string())
            .and_then(|result| result.map_err(|_| "NATIVE_FAILED".to_string()))
    });
    match previous_config {
        Some(value) => std::env::set_var("TOKSCALE_CONFIG_DIR", value),
        None => std::env::remove_var("TOKSCALE_CONFIG_DIR"),
    }
    match previous_cache_only {
        Some(value) => std::env::set_var("TOKSCALE_PRICING_CACHE_ONLY", value),
        None => std::env::remove_var("TOKSCALE_PRICING_CACHE_ONLY"),
    }
    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    let report = outcome?;

    let totals = [report.total_input, report.total_output, report.total_cache_read, report.total_cache_write];
    if totals.iter().any(|total| *total < 0 || *total > MAX_SAFE_INTEGER) {
        return Err("NATIVE_SCHEMA_MISMATCH".to_string());
    }
    let actual: i64 = totals.iter().sum();
    if actual as f64 != expected {
        return Err("NATIVE_TOTAL_MISMATCH".to_string());
    }
    Ok(json!({"status": "passed", "records": eligible, "tokens": actual, "engine": format!("tokscale/{TOKSCALE_VERSION}")}))
}