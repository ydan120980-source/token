use serde_json::{json, Value};
use std::{fs, process::Command};
use usage_engine::store::Store;

#[test]
fn codex_rebuild_matches_electron_preview_and_commits_backup_before_replacement() {
    let fixture = tempfile::tempdir().expect("fixture");
    let driver = r#"
      const path=require('node:path');
      const {fixtures}=require('../../tests/m1/fixtures');
      const {Service}=require('../../src/m1/service');
      (async () => {
        const root=process.argv[1];
        const {roots}=fixtures(path.join(root,'home'));
        const service=new Service(path.join(root,'electron'),roots);
        try {
          const summary=await service.refresh(true);
          console.log(JSON.stringify({roots,summary}));
        } finally { await service.close(); }
      })().catch(error=>{console.error(error);process.exitCode=1;});
    "#;
    let output = Command::new("node")
        .args(["-e", driver])
        .arg(fixture.path())
        .output()
        .expect("Electron oracle");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let golden: Value = serde_json::from_slice(&output.stdout).expect("golden preview");
    let path = fixture.path().join("tauri");
    let mut store =
        Store::new(path.to_str().expect("UTF-8 fixture"), &golden["roots"]).expect("store");
    let ledger = path.join("statistics.json");
    let before = fs::read(&ledger).expect("stored initial ledger");
    let preview = store.preview_codex_maintenance().expect("Rust preview");
    assert_eq!(fs::read(&ledger).expect("unchanged ledger"), before);
    for field in [
        "sequence",
        "previousTokens",
        "rebuiltTokens",
        "retainedTokens",
        "records",
        "files",
        "skipped",
    ] {
        assert_eq!(
            preview.summary()[field].as_f64(),
            golden["summary"][field].as_f64()
        );
    }
    let id = preview.summary()["id"].as_str().expect("preview identity");
    assert_eq!(
        store.apply_codex_maintenance("wrong-preview", &preview),
        Err("MAINTENANCE_STALE".to_owned())
    );
    store.apply_codex_maintenance(id, &preview).expect("apply");
    assert_eq!(store.state["sequence"], json!(1));
    let backup = fs::read_dir(path.join("backups"))
        .expect("backup directory")
        .next()
        .expect("backup")
        .expect("backup path");
    assert_eq!(fs::read(backup.path()).expect("backup bytes"), before);
    assert_eq!(
        store.apply_codex_maintenance(id, &preview),
        Err("MAINTENANCE_STALE".to_owned())
    );
}
