use quota_engine::provider_adapters::{from_provider, AdapterError, AdapterOptions};
use serde_json::{json, Value};
use usage_engine::js_json::stringify;

#[test]
fn all_seventeen_provider_routes_match_the_electron_wire_fixture() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/m1/fixtures/provider-adapter-parity.json"
    ))
    .expect("Electron parity fixture");
    assert_eq!(fixture["syntheticOnly"], true);
    let rows = fixture["rows"].as_array().expect("parity rows");
    assert_eq!(rows.len(), 17);
    for row in rows {
        let adapter = row["adapter"].as_str().expect("adapter id");
        let actual = from_provider(
            adapter,
            &row["raw"],
            &row["fetchedAt"],
            serde_json::from_value(row["options"].clone()).expect("adapter options"),
        )
        .unwrap_or_else(|error| panic!("{adapter}: {error}"));
        assert_eq!(stringify(&actual), stringify(&row["expected"]), "{adapter}");
    }
}

#[test]
fn empty_and_failed_observations_preserve_the_electron_error_contract() {
    let fetched_at = json!("2026-11-19T12:00:00Z");
    let parse = |adapter, raw| from_provider(adapter, &raw, &fetched_at, AdapterOptions::default());
    for (adapter, raw, expected) in [
        ("claude-web", json!({}), AdapterError::QuotaUnavailable),
        (
            "gemini-web",
            json!([{"data":{"viewer":null}}]),
            AdapterError::AuthRequired,
        ),
        (
            "zcode-device",
            json!({"code":403}),
            AdapterError::AccessDenied,
        ),
        (
            "workbuddy-desktop",
            json!({"code":401}),
            AdapterError::AuthRequired,
        ),
        (
            "deepseek-api",
            json!({"is_available":true,"balance_infos":[
            {"currency":"USD","total_balance":"0","granted_balance":null}]}),
            AdapterError::InvalidResponse,
        ),
        (
            "opencode-go",
            json!({"usage":{"weekly":{"status":"ok", "percent":"0"}}}),
            AdapterError::InvalidResponse,
        ),
        ("unknown-adapter", json!({}), AdapterError::InvalidResponse),
    ] {
        assert_eq!(parse(adapter, raw), Err(expected), "{adapter}");
    }
    let empty = parse("zcode-device", json!({"code":0.0,"data":{"balances":[]}}))
        .expect("empty observation is supported");
    assert_eq!(empty["pools"], json!([]));
    assert_eq!(empty["incomplete"], true);
    let packages = parse("workbuddy-desktop", json!({"code":0,"data":{"Response":{"Data":{"Accounts":[
        {"CapacityType":4,"CycleCapacitySize":"200","CycleCapacityRemain":"0","CycleEndTime":"2026-11-20 12:00:00"}
    ]}}}})).expect("partial WorkBuddy package response");
    assert_eq!(packages["incomplete"], true);
    assert_eq!(packages["pools"][0]["windows"][0]["remaining"], "0");
    assert_eq!(
        packages["pools"][0]["windows"][0]["resetsAt"],
        "2026-11-20T04:00:00.000Z"
    );
}
