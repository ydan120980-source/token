use serde_json::json;
use std::{fs, path::PathBuf};
use usage_engine::store::Store;

struct Temp(PathBuf);

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn explicitly_supplied_trace_places_match_electron_discovery(
) -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;
    use usage_engine::agent_traces::Places;
    let dir =
        Temp(std::env::temp_dir().join(format!("quotadock-traces-{:016x}", rand::random::<u64>())));
    let home = dir.0.join("home");
    let roaming = dir.0.join("roaming");
    for mode in [
        home.join(".claude"),
        home.join(".augment"),
        roaming.join("Kiro"),
        roaming.join("Trae"),
    ] {
        fs::create_dir_all(mode)?;
    }
    let raw_home = home.to_str().ok_or("fixture home")?;
    let roaming = roaming.to_str().ok_or("fixture app data")?;
    let directory = dir.0.join("usage");
    let store = Store::new(directory.to_str().ok_or("fixture directory")?, &json!({}))?;
    let baseline = Command::new("node").current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", "const p=require('./src/m1/discovery').discover({}, {disabled:[],added:{},excluded:{}}, {home:process.argv[1],appData:process.argv[2]});delete p.checkedAt;console.log(JSON.stringify(p));", raw_home, roaming]).output()?;
    assert!(baseline.status.success());
    let expected: serde_json::Value = serde_json::from_slice(&baseline.stdout)?;
    let mut actual = store.discover_with_places(Places {
        home: Some(raw_home),
        app_data: Some(roaming),
        local_app_data: None,
    });
    actual
        .as_object_mut()
        .ok_or("source discovery")?
        .shift_remove("checkedAt");
    assert_eq!(actual, expected);
    assert_eq!(
        store.discover_selected_sources(Some(raw_home))["unsupported"],
        json!([])
    );
    Ok(())
}

#[test]
fn discovery_counts_only_admitted_records_and_keeps_stopped_roots(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir =
        Temp(std::env::temp_dir().join(format!("quoted-discovery-{:016x}", rand::random::<u64>())));
    let sessions = dir.0.join("sessions");
    fs::create_dir_all(&sessions)?;
    fs::write(sessions.join("recognized.jsonl"), b"not read by discovery")?;
    fs::write(sessions.join("auth.json"), b"not a source")?;
    let store_dir = dir.0.join("app");
    let home = dir.0.to_str().ok_or("fixture home")?;
    let mut store = Store::new(
        store_dir.to_str().ok_or("fixture store")?,
        &json!({"codex":[sessions]}),
    )?;
    let result = store.discover_selected_sources(Some(home));
    assert_eq!(result["schemaVersion"], "SourceDiscoveryV1");
    let codex = &result["sources"][0];
    assert_eq!(codex["agent"], "codex");
    assert_eq!(codex["files"], 1);
    assert_eq!(codex["paths"][0]["state"], "included");
    assert_eq!(codex["paths"][0]["files"], 1);
    assert!(codex["paths"][0]["latest"].is_string());
    store.settings["sources"]["disabled"] = json!(["codex"]);
    let result = store.discover_selected_sources(Some(home));
    let codex = &result["sources"][0];
    assert_eq!(codex["enabled"], false);
    assert_eq!(codex["files"], 0);
    assert_eq!(codex["paths"][0]["state"], "stopped");
    assert_eq!(codex["paths"][0]["exists"], true);
    assert!(codex["paths"][0]["files"].is_null());
    Ok(())
}

#[test]
fn chooser_persists_pause_and_path_together_and_rejects_renderer_paths(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir =
        Temp(std::env::temp_dir().join(format!("quotadock-choice-{:016x}", rand::random::<u64>())));
    let selected = dir.0.join("sessions");
    fs::create_dir_all(&selected)?;
    let own = dir.0.join("app");
    let own = own.to_str().ok_or("scratch")?;
    let selected = selected.to_str().ok_or("fixture root")?;
    let mut store = Store::new(own, &json!({}))?;
    assert_eq!(
        store
            .apply_source_selection("include", Some("codex"), &json!(selected))
            .err()
            .as_deref(),
        Some("SOURCE_REJECTED")
    );
    assert_eq!(
        store.choose_source("codex", own).err().as_deref(),
        Some("SOURCE_PRODUCT_OVERLAP")
    );
    store.choose_source("codex", selected)?;
    let mut reopened = Store::new(own, &json!({}))?;
    assert_eq!(reopened.settings["enabled"], false);
    assert_eq!(reopened.source_roots()["codex"], json!([selected]));
    reopened.apply_source_selection("remove", Some("codex"), &json!(selected))?;
    assert_eq!(reopened.source_roots()["codex"], json!([]));
    Ok(())
}
