#![cfg(windows)]

use quota_engine::config_manager::{ConfigManager, Kind, Selection};
use serde_json::{json, Value};
use std::{fs, path::Path, process::Command};

fn selection(root: &Path, kind: Kind) -> Selection<'_> {
    Selection {
        root,
        agent: "codex",
        scope: "project",
        kind,
    }
}

fn id(value: &Value) -> &str {
    value["id"].as_str().expect("opaque id")
}

#[test]
fn preview_apply_and_restore_match_electron_with_revision_check_and_encrypted_backup() {
    let scratch = tempfile::tempdir().expect("scratch");
    let root = scratch.path().join("project");
    let target = root.join(".codex/config.toml");
    fs::create_dir_all(target.parent().expect("parent")).expect("config dir");
    let original = "[mcp_servers.demo]\ncommand = \"fixture-cmd\"\n[mcp_servers.demo.env]\nPRIVATE = \"synthetic-private-restore-sentinel\"\n";
    fs::write(&target, original).expect("fixture");
    let backups = scratch.path().join("backup");
    let mut manager = ConfigManager::default();
    let view = manager.list(selection(&root, Kind::Mcp)).expect("list");
    let request = json!({"id":id(&view),"action":"toggle","row":0,"enabled":false});
    let draft = manager
        .prepare(selection(&root, Kind::Mcp), &request, None)
        .expect("preview");
    assert_eq!(fs::read_to_string(&target).expect("original"), original);
    assert!(!view
        .to_string()
        .contains("synthetic-private-restore-sentinel"));

    let js = r#"
      const path = require('node:path');
      const fs = require('node:fs');
      const { ConfigManager } = require(path.join(process.cwd(),'../../src/quota/config-manager.js'));
      const root = process.argv[1];
      const config = new ConfigManager(process.argv[2],{isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from('unused-test-backup')});
      const view = config.list(root,'codex','project','mcp');
      const preview = config.prepare(view.id,{action:'toggle',row:0,enabled:false});
      config.apply(preview.id);
      console.log(JSON.stringify({view,preview,text:fs.readFileSync(path.join(root,'.codex/config.toml'),'utf8')}));
    "#;
    let mirror = scratch.path().join("electron");
    fs::create_dir_all(mirror.join(".codex")).expect("electron dir");
    fs::write(mirror.join(".codex/config.toml"), original).expect("electron fixture");
    let output = Command::new("node")
        .args(["-e", js])
        .arg(&mirror)
        .arg(scratch.path().join("electron-backup"))
        .output()
        .expect("execute oracle");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let oracle: Value = serde_json::from_slice(&output.stdout).expect("oracle JSON");
    for key in ["kind", "target", "enabled", "rows", "undo", "normalization"] {
        assert_eq!(view[key], oracle["view"][key]);
    }
    for key in ["summary", "backupRequired", "normalization"] {
        assert_eq!(draft[key], oracle["preview"][key]);
    }

    let modified = format!("{original}\n# change during preview\n");
    fs::write(&target, &modified).expect("concurrent edit");
    assert_eq!(
        manager.apply(selection(&root, Kind::Mcp), Some(id(&draft)), &backups),
        Err("CONFIG_CHANGED")
    );
    assert_eq!(fs::read_to_string(&target).expect("concurrent"), modified);
    assert!(!backups.exists());
    fs::write(&target, original).expect("reset fixture");

    let reply = manager
        .apply(selection(&root, Kind::Mcp), Some(id(&draft)), &backups)
        .expect("apply");
    assert_eq!(
        fs::read_to_string(&target).expect("updated"),
        oracle["text"].as_str().expect("text")
    );
    let id = reply["record"].as_str().expect("backup record");
    let backup = fs::read(backups.join(format!("{id}.bin"))).expect("backup bytes");
    let sentinel = b"synthetic-private-restore-sentinel";
    assert!(!backup
        .windows(sentinel.len())
        .any(|window| window == sentinel));
    let mut restarted = ConfigManager::default();
    assert_eq!(
        restarted
            .restore(&root, &backups, id.to_owned())
            .expect("recover"),
        json!({"restored":true})
    );
    assert_eq!(fs::read_to_string(&target).expect("restored"), original);
}

#[test]
fn skill_import_never_publishes_stale_or_sensitive_trees_and_undo_moves_it_out() {
    let scratch = tempfile::tempdir().expect("scratch");
    let root = scratch.path().join("target");
    let imported = scratch.path().join("my-skill");
    let backups = scratch.path().join("backup");
    fs::create_dir(&root).expect("root");
    fs::create_dir(&imported).expect("skill directory");
    let source = imported.join("SKILL.md");
    let original = "---\nname: my-skill\ndescription: A test skill\n---\nunchanged body\n";
    fs::write(&source, original).expect("skill");
    let mut manager = ConfigManager::default();
    let view = manager.list(selection(&root, Kind::Skills)).expect("list");
    let request = json!({"id":id(&view),"action":"import"});
    let auth = imported.join("auth.json");
    fs::write(&auth, "synthetic secret").expect("boundary fixture");
    assert_eq!(
        manager.prepare(selection(&root, Kind::Skills), &request, Some(&imported)),
        Err("CONFIG_IMPORT_REJECTED")
    );
    fs::remove_file(auth).expect("remove boundary fixture");
    let draft = manager
        .prepare(selection(&root, Kind::Skills), &request, Some(&imported))
        .expect("preview");
    let installed = root.join(".agents/skills/my-skill/SKILL.md");
    fs::write(&source, format!("{original}modified\n")).expect("changed source");
    assert_eq!(
        manager.apply(selection(&root, Kind::Skills), Some(id(&draft)), &backups),
        Err("CONFIG_CHANGED")
    );
    assert!(!installed.exists());
    fs::write(&source, original).expect("source restored");
    manager
        .apply(selection(&root, Kind::Skills), Some(id(&draft)), &backups)
        .expect("install");
    assert_eq!(fs::read_to_string(&installed).expect("installed"), original);
    manager.undo(&root, &backups).expect("undo");
    assert!(!installed.exists());
    assert_eq!(fs::read_to_string(&source).expect("source"), original);
    assert_eq!(
        fs::read_dir(root.join(".agent-usage/undone-imports"))
            .expect("held imports")
            .count(),
        1
    );
}

#[test]
fn inventory_actions_use_only_inventory_identity_and_can_restore_after_restart() {
    let scratch = tempfile::tempdir().expect("fixture");
    let root = scratch.path().join("home");
    let project = scratch.path().join("project");
    let backups = scratch.path().join("backups");
    fs::create_dir_all(root.join(".codex")).expect("codex home");
    fs::create_dir(&project).expect("project");
    let instruction = root.join(".codex/AGENTS.md");
    let manifest = project.join(".mcp.json");
    fs::write(&instruction, "# old instruction").expect("instruction");
    fs::write(
        &manifest,
        r#"{"mcpServers":{"fixture":{"command":"node"}}}"#,
    )
    .expect("manifest");
    let inventory =
        usage_engine::agent_inventory::scan(&root, &[project.clone()], &Default::default(), || {
            false
        })
        .expect("inventory");
    let instruction_item = inventory
        .items
        .iter()
        .find(|row| row.agent == "codex" && row.kind == "instruction")
        .expect("instruction item");
    let copy_item = inventory
        .items
        .iter()
        .find(|row| row.agent == "claude" && row.kind == "mcp")
        .expect("MCP item");
    let read = ConfigManager::read_instruction(instruction_item).expect("read");
    assert_eq!(read["text"], "# old instruction");
    let mut manager = ConfigManager::default();
    let draft=manager.preview_item(instruction_item,&json!({"action":"text","text":"# edited instruction","revision":read["revision"],"file":manifest})).expect("preview");
    assert_eq!(
        fs::read_to_string(&instruction).expect("not written yet"),
        "# old instruction"
    );
    let (_, reply) = manager.apply_item(id(&draft), &backups).expect("apply");
    assert_eq!(
        fs::read_to_string(&instruction).expect("written"),
        "# edited instruction"
    );
    let record = reply["record"].as_str().expect("record");
    assert_eq!(ConfigManager::history(&backups)[0]["restorable"], true);
    let mut restarted = ConfigManager::default();
    restarted.restore_record(&backups, record).expect("restore");
    assert_eq!(
        fs::read_to_string(&instruction).expect("restored"),
        "# old instruction"
    );

    let preview = restarted
        .preview_item(copy_item, &json!({"action":"copy","to":"codex"}))
        .expect("copy preview");
    restarted.apply_item(id(&preview), &backups).expect("copy");
    assert!(fs::read_to_string(project.join(".codex/config.toml"))
        .expect("copied file")
        .contains("fixture"));
    assert_eq!(
        restarted.preview_item(copy_item, &json!({"action":"copy","to":"codex"})),
        Err("CONFIG_IMPORT_COLLISION")
    );
}
