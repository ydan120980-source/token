use quota_engine::{connection_state::Inputs, resource_connections::project_resource_connections};
use serde_json::{json, Value};
use std::process::Command;

#[test]
fn balances_and_windows_report_coverage_without_summing_provider_values(
) -> Result<(), Box<dyn std::error::Error>> {
    let now = 1_792_380_000_000;
    let catalog = json!({"codex":{"name":"Codex"},"claude":{"name":"Claude Code"}});
    let quota = json!({"accounts":[
        {"provider":"codex","status":"ready","quota":{"hasMeasurements":true,"coverage":{"fresh":1,"stale":0,"cached":0,"missing":0}}},
        {"provider":"codex","status":"cached","quota":{"hasMeasurements":true,"partial":true,"coverage":{"fresh":2,"stale":0,"cached":1,"missing":1}}},
        {"provider":"codex","status":"pending","quota":{"hasMeasurements":false,"coverage":{"fresh":0,"stale":0,"cached":0,"missing":2}}},
        {"provider":"codex","status":"error","quota":null},
    ]});
    let input = json!({"catalog":catalog,"quota":quota,"now":now});
    let js = Command::new("node").current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", "const p=require('./src/quota/resource-connections');process.stdout.write(JSON.stringify(p.projectResourceConnections(JSON.parse(process.argv[1]))));", &input.to_string()]).output()?;
    assert!(js.status.success());
    let actual = project_resource_connections(Inputs {
        catalog: &input["catalog"],
        quota: &input["quota"],
        collection: &Value::Null,
        statuses: &Value::Null,
        disabled: &Value::Null,
        custom: &Value::Null,
        discovered: &Value::Null,
        now,
    });
    let expected: Value = serde_json::from_slice(&js.stdout)?;
    // JSON numbers compare by value here, including the projected resource totals.
    assert_eq!(
        usage_engine::js_json::stringify(&actual),
        usage_engine::js_json::stringify(&expected)
    );
    Ok(())
}
