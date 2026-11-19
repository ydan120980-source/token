// Inline tokscale-core parity against the pinned tokscale.exe 4.17.0 reference
// (tests/fixtures/native-expected.json, captured from the SHA-256-pinned binary
// on synthetic canonical transcripts). The wire bytes must match the JS
// canonical transcript exactly, and the inline engine must reach the same
// totals, including the duplicate-uuid dedup that fails the total check.
use serde_json::Value;
use sha2::{Digest, Sha256};
use usage_engine::js_json::stringify;
use usage_engine::native::{canonical_transcript, verify_projection, TOKSCALE_VERSION};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn workspace(tag: &str) -> String {
    let dir = std::env::temp_dir().join(format!("native-inline-{tag}-{}-{}", std::process::id(), usage_engine::time::now_ms()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.to_string_lossy().to_string()
}

#[test]
fn inline_core_matches_pinned_exe() {
    let expected: Value = serde_json::from_str(include_str!("fixtures/native-expected.json")).unwrap();
    assert_eq!(expected["engine"].as_str().unwrap(), format!("tokscale/{TOKSCALE_VERSION}"));
    assert_eq!(expected["sha256"].as_str().unwrap(), "bea88fa095e89aea988067729c4c05c8c72fa6760c975ad7a1dd4fbeac60d085");
    let dir = workspace("parity");
    let home_before = std::env::var_os("HOME");
    let config_before = std::env::var_os("TOKSCALE_CONFIG_DIR");
    let cache_only_before = std::env::var_os("TOKSCALE_PRICING_CACHE_ONLY");
    for (name, case) in expected["cases"].as_object().unwrap() {
        let rows: Vec<Value> = case["rows"].as_array().unwrap().clone();
        let (text, eligible, expected_tokens) = canonical_transcript(&rows);
        assert_eq!(text.len(), case["wireBytes"].as_u64().unwrap() as usize, "{name} wire length");
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        assert_eq!(hex(&hasher.finalize()), case["wireSha256"].as_str().unwrap(), "{name} wire hash");
        assert_eq!(eligible, case["eligible"].as_i64().unwrap(), "{name} eligible");
        assert_eq!(expected_tokens, case["expected"].as_f64().unwrap(), "{name} expected");
        if name == "js-test-401" {
            // The constants asserted by tests/m1/native-binary.test.js.
            assert_eq!(text.len(), 120754);
            assert_eq!(hex(&Sha256::digest(text.as_bytes())), "e3de138574e4aedadd782b859363fe70668546e86b0423dcddf547fd7a99545b");
            assert!(!text.contains("DO_NOT_TRANSPORT"));
        }
        let result = verify_projection(&rows, &dir);
        if name == "duplicate-uuid" {
            // The engine dedups by uuid (last wins); the projection check must
            // refuse the mismatch exactly like native.js.
            assert_eq!(result.unwrap_err(), "NATIVE_TOTAL_MISMATCH", "{name}");
            continue;
        }
        let view = result.unwrap_or_else(|error| panic!("{name} failed: {error}"));
        assert_eq!(view, serde_json::json!({"status": "passed", "records": eligible, "tokens": expected_tokens as i64, "engine": format!("tokscale/{TOKSCALE_VERSION}")}), "{name}");
        let totals = &case["totals"];
        assert_eq!(view["tokens"].as_i64().unwrap(), totals["totalInput"].as_i64().unwrap() + totals["totalOutput"].as_i64().unwrap() + totals["totalCacheRead"].as_i64().unwrap() + totals["totalCacheWrite"].as_i64().unwrap(), "{name} exe totals");
    }
    // A repeated check in the same parent directory gets a fresh cache root.
    let rows: Vec<Value> = expected["cases"]["basic"]["rows"].as_array().unwrap().clone();
    for _ in 0..2 {
        let view = verify_projection(&rows, &dir).unwrap();
        assert_eq!(view["tokens"], serde_json::json!(420));
    }
    assert_eq!(std::env::var_os("TOKSCALE_CONFIG_DIR"), config_before, "config override restored");
    assert_eq!(std::env::var_os("TOKSCALE_PRICING_CACHE_ONLY"), cache_only_before, "cache-only override restored");
    assert_eq!(std::env::var_os("HOME"), home_before, "home override restored");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn canonical_transcript_follows_js_eligibility() {
    let rows = vec![
        serde_json::json!({"id": "neg", "timestamp": "2026-11-10T00:00:00Z", "totalTokens": -1}),
        serde_json::json!({"id": "null", "timestamp": "2026-11-10T00:00:00Z", "totalTokens": null}),
        serde_json::json!({"id": "missing", "timestamp": "2026-11-10T00:00:00Z"}),
        serde_json::json!({"id": "nan", "timestamp": "2026-11-10T00:00:00Z", "totalTokens": "NaN"}),
        serde_json::json!({"id": "ok", "timestamp": "2026-11-10T00:00:00Z", "totalTokens": 50}),
    ];
    let (text, eligible, expected) = canonical_transcript(&rows);
    assert_eq!(eligible, 2);
    assert_eq!(expected, 50.0);
    assert!(text.contains("\"uuid\":\"null\""));
    assert!(text.contains("\"input_tokens\":null"));
    assert!(!text.contains("missing"));
    assert!(!text.contains("neg"));
    let (empty, eligible, expected) = canonical_transcript(&[]);
    assert_eq!(empty, "\n");
    assert_eq!(eligible, 0);
    assert_eq!(expected, 0.0);
    let mut missing_id = serde_json::json!({"timestamp": "2026-11-10T00:00:00Z", "totalTokens": 5});
    let (text, _, _) = canonical_transcript(&[missing_id.clone()]);
    assert!(!text.contains("uuid"));
    assert!(!text.contains("\"id\""));
    missing_id["id"] = serde_json::json!(42);
    let (text, _, _) = canonical_transcript(&[missing_id]);
    assert!(text.contains("\"uuid\":42"));
    assert_eq!(stringify(&serde_json::json!(1.5)), "1.5");
}