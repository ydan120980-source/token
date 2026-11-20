use serde_json::json;
use std::process::Command;
use usage_engine::{github_sync_payload::payload, js_json::stringify};

#[test]
fn strips_private_fields_and_matches_the_electron_payload() -> Result<(), Box<dyn std::error::Error>>
{
    let device = "11111111-1111-4111-8111-111111111111";
    let synced_at = "2026-11-20T00:00:00.000Z";
    let fixture = json!({
        "timezone": "Asia/Shanghai",
        "sourceCatalog": { "custom-abc": { "custom": true } },
        "daily": [
            { "agent": "codex", "date": "2026-11-19", "model": "example",
              "totalTokens": 17, "output": 0, "reasoning": -1, "records": 2,
              "estimatedCostUsd": 0.00015, "estimatedCostUpperUsd": null, "cwd": "PRIVATE_PATH",
              "message": "PRIVATE_MESSAGE", "sessionKey": "PRIVATE_KEY" },
            { "agent": "claude", "date": "2026-11-20", "model": null, "cacheRead": 0 },
            { "agent": "custom-abc", "date": "2026-11-19", "model": "PRIVATE_SOURCE" },
            { "agent": "codex", "date": "invalid" }
        ]
    });
    let native = serde_json::to_value(payload(&fixture, device, synced_at)?)?;
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let electron = Command::new("node")
        .current_dir(repo)
        .args([
            "-e",
            "const {payload}=require('./src/m1/github-sync-payload'); const [snapshot,device,at]=process.argv.slice(1); process.stdout.write(JSON.stringify(payload(JSON.parse(snapshot),device,at)));",
            &stringify(&fixture),
            device,
            synced_at,
        ])
        .output()?;
    assert!(electron.status.success(), "Electron fixture could not run");
    assert_eq!(stringify(&native).as_bytes(), electron.stdout);
    assert!(!stringify(&native).contains("PRIVATE_"));
    assert_eq!(
        payload(&json!({}), device, synced_at).err(),
        Some("GITHUB_SYNC_SNAPSHOT_INVALID")
    );
    Ok(())
}
