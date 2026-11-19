use quota_engine::connection_state::{
    project_connections, quota_description, quota_freshness, quota_label, Inputs,
};
use serde_json::{json, Value};
use std::process::Command;
use usage_engine::time::{iso_from_ms, parse_iso};

#[test]
fn account_readiness_and_application_summary_match_the_electron_projection(
) -> Result<(), Box<dyn std::error::Error>> {
    let now = parse_iso("2026-10-19T02:00:00.000Z").ok_or("fixture time")?;
    let window = |at, resets| json!({"fetchedAt":iso_from_ms(at),"windows":[{"resetsAt":resets}]});
    let accounts = json!([
        {"provider":"codex","status":"ready","quota":window(now-60000,Value::Null),"token":"PRIVATE_TOKEN"},
        {"provider":"codex","status":"ready","quota":window(now, json!(iso_from_ms(now-1)))},
        {"provider":"codex","status":"error","errorCode":"RATE_LIMITED","quota":window(now,Value::Null)},
        {"provider":"codex","status":"login-required","errorCode":"LOGIN_REQUIRED","quota":null,"duplicateKnown":true},
        {"provider":"codex","status":"ready","quota":window(now+60001,Value::Null)},
        {"provider":"claude","status":"ready","quota":{"fetchedAt":iso_from_ms(now),
            "pools":[{"balances":[{"remaining":"4.5"}],"windows":[]}]}},
    ]);
    let catalog = json!({"codex":{"name":"Codex"},"claude":{"name":"Claude"},"cursor":{"name":"Cursor"},
        "custom-test":{"name":"Synthetic Source","custom":true,"archived":true}});
    let quota = json!({"accounts":accounts,"providerCapabilities":[{"provider":"claude","adapters":[{}]}],"executableAvailable":false});
    let input = json!({"catalog":catalog,"quota":quota,"now":now,"collection":{"enabled":true},
        "statuses":{"claude":{"status":"partial","observedRecords":10}},"disabled":["codex"],
        "custom":{},"discovered":[{"agent":"cursor","installed":false}]});
    let script = r#"const p=require('./src/quota/connection-state'), i=JSON.parse(process.argv[1]);
      const projection=p.projectConnections(i);
      process.stdout.write(JSON.stringify([projection,projection.rows.map(row=>p.quotaDescription(row.quota)),
        i.quota.accounts.map(account=>{const health=p.quotaFreshness(account,i.now);return [health,p.quotaLabel(health)]})]));"#;
    let js = Command::new("node")
        .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", script, &input.to_string()])
        .output()?;
    assert!(js.status.success());
    let projection = project_connections(Inputs {
        catalog: &input["catalog"],
        collection: &input["collection"],
        statuses: &input["statuses"],
        disabled: &input["disabled"],
        custom: &input["custom"],
        discovered: &input["discovered"],
        quota: &input["quota"],
        now,
    });
    let labels = projection["rows"]
        .as_array()
        .ok_or("projection rows")?
        .iter()
        .map(|row| quota_description(&row["quota"]))
        .collect::<Vec<_>>();
    let health = accounts
        .as_array()
        .ok_or("fixture accounts")?
        .iter()
        .map(|account| {
            let health = quota_freshness(account, now);
            json!([health, quota_label(&health)])
        })
        .collect::<Vec<_>>();
    assert_eq!(
        json!([projection, labels, health]),
        serde_json::from_slice::<Value>(&js.stdout)?
    );
    assert!(!projection.to_string().contains("PRIVATE_TOKEN"));
    Ok(())
}
