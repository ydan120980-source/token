#![cfg(windows)]

use quota_engine::agent_runtime::{discover, discover_antigravity, Environment};
use serde_json::{json, Value};
use std::{fs, process::Command};

#[test]
fn metadata_discovery_matches_electron_for_launchers_execs_and_invalid_path() {
    let fixture = tempfile::tempdir().expect("metadata fixture");
    let local = fixture.path().join("local");
    let home = fixture.path().join("home");
    let roam = fixture.path().join("roam");
    let path = fixture.path().join("path");
    for file in [
        home.join(".local/bin/claude.exe"),
        path.join("claude.cmd"),
        local.join("agy/bin/agy.exe"),
        path.join("agy.ps1"),
        local.join("Programs/Antigravity/Antigravity.exe"),
    ] {
        fs::create_dir_all(file.parent().expect("fixture parent")).expect("fixture directory");
        fs::write(file, b"demonstrably not an executable").expect("fixture file");
    }
    let environment = Environment {
        platform: "win32".to_owned(),
        home: home.to_string_lossy().into_owned(),
        app_data: roam.to_string_lossy().into_owned(),
        local_app_data: local.to_string_lossy().into_owned(),
        path: format!("relative;%NON_WHITELISTED%;{}", path.display()),
        ..Environment::default()
    };
    let script = r#"
      const {discoverAgentRuntime} = require('../../src/quota/agent-runtime-discovery');
      const {discoverAntigravity} = require('../../src/quota/antigravity-discovery');
      const environment = JSON.parse(process.argv[1]);
      Promise.all([discoverAgentRuntime('claude',environment),discoverAntigravity(environment)])
        .then(rows => console.log(JSON.stringify(rows)));
    "#;
    let result = Command::new("node")
        .args(["-e", script, &json!(&environment).to_string()])
        .output()
        .expect("Node oracle");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let oracle: Vec<Value> = serde_json::from_slice(&result.stdout).expect("oracle rows");
    let rust = [
        json!(discover("claude", &environment).expect("runtime")),
        discover_antigravity(&environment),
    ];
    for (mut outcome, mut expected) in rust.into_iter().zip(oracle) {
        outcome["checkedAt"] = Value::Null;
        expected["checkedAt"] = Value::Null;
        assert_eq!(outcome, expected);
    }
}
