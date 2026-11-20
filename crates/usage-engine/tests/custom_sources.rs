#![cfg(windows)]

use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};
use usage_engine::{custom_sources::CustomSources, js_json::stringify, store::Store};

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn staged_custom_source_and_reopen_match_electron() -> Result<(), Box<dyn std::error::Error>> {
    let root = Scratch(std::env::temp_dir().join(format!(
        "quota-custom-golden-{:016x}",
        rand::random::<u64>()
    )));
    let source = root.0.join("input");
    let ledger = root.0.join("rust-ledger");
    fs::create_dir_all(&source)?;
    let input = source.join("calls.jsonl");
    let row = json!({
        "schemaVersion":"AgentUsageEventV1","mode":"per-request",
        "id":"private-call-marker","timestamp":"2026-10-17T00:00:00Z","inputTokens":100,"outputTokens":20,
        "content":"private-content-marker"
    });
    fs::write(&input, format!("{}\n", stringify(&row)))?;
    let config = json!({"schemaVersion":"CustomSourceV1","name":"合成来源","template":"standard","mode":"per-request"});
    let ledger_name = ledger.to_str().ok_or("invalid fixture path")?;
    let source_name = source.to_str().ok_or("invalid fixture path")?;
    let protected = vec![ledger_name.to_owned()];
    let mut store = Store::new(ledger_name, &json!({}))?;
    let mut service = CustomSources::default();
    let draft = service.draft(&store, None, None)?;
    let token = draft["token"].as_str().ok_or("missing token")?;
    let id = draft["id"].as_str().ok_or("missing source id")?;
    assert_eq!(
        service
            .choose(&store, token, vec![ledger_name.to_owned()], &protected)
            .unwrap_err(),
        "SOURCE_PRODUCT_OVERLAP"
    );
    service.choose(&store, token, vec![source_name.to_owned()], &protected)?;
    let sample = service.sample(&store, token, &protected)?;
    assert!(!stringify(&sample).contains("private-content-marker"));
    let first = service.preview(&mut store, token, &config, &protected)?;
    fs::write(&input, format!("{}\n\n", stringify(&row)))?;
    assert_eq!(
        service
            .apply(&mut store, &first.id, &protected)
            .unwrap_err(),
        "CUSTOM_PREVIEW_STALE"
    );
    let preview = service.preview(&mut store, token, &config, &protected)?;
    let output = Command::new("node")
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", r#"
const { CustomSources } = require('./src/m1/custom-sources');
const { Store } = require('./src/m1/store');
const adapter = require('./src/m1/jsonl-adapter');
const [dir, root, raw] = process.argv.slice(1);
const store = new Store(dir, {});
const owner = {store, schedule(){}, customTask: (action, source, previous) =>
  action === 'fingerprint' ? adapter.fingerprint(source) : adapter.scan(source, store.state.salt, previous)};
const custom = new CustomSources(owner);
(async () => {
  try {
    const draft = custom.draft();
    custom.choose(draft.token, [root]);
    const result = await custom.preview(draft.token, JSON.parse(raw));
    process.stdout.write(JSON.stringify(result.summary));
  } finally { custom.close(); }
})().catch(() => { process.exitCode = 1; });
"#])
        .arg(root.0.join("electron-ledger"))
        .arg(source_name)
        .arg(stringify(&config))
        .output()?;
    assert!(output.status.success());
    let expected: Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(stringify(&preview.summary), stringify(&expected));
    service.apply(&mut store, &preview.id, &protected)?;
    assert!(usage_engine::custom_sources::is_granted_root(
        &store,
        source_name,
        &protected
    ));
    assert!(!usage_engine::custom_sources::is_granted_root(
        &store,
        ledger_name,
        &protected
    ));

    service.change(&mut store, id, "remove", None, &protected)?;
    assert_eq!(store.state["customSources"][id]["archived"], true);
    service.change(&mut store, id, "rollback", None, &protected)?;
    assert_eq!(store.state["customSources"][id]["archived"], false);
    assert_eq!(store.records().len(), 1);
    let snapshot = stringify(&store.state);
    assert!(
        !snapshot.contains("private-call-marker") && !snapshot.contains("private-content-marker")
    );
    drop(store);
    let reopened = Store::new(ledger_name, &json!({}))?;
    assert_eq!(reopened.records()[0]["cacheRead"], Value::Null);
    assert_eq!(reopened.records()[0]["totalTokens"], 120);
    assert_eq!(reopened.state["customSources"][id]["enabled"], true);
    Ok(())
}
