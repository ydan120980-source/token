#![cfg(windows)]

use serde_json::{json, Value};
use std::{fs, path::Path, process::Command};
use usage_engine::agent_inventory::{scan, Environment};

fn put(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
    fs::write(path, text).expect("fixture file");
}

#[test]
fn inventory_projection_matches_the_electron_oracle_across_four_agents() {
    let fixture = tempfile::tempdir().expect("inventory fixture");
    let home = fixture.path().join("home");
    let project = fixture.path().join("work");
    let bin = home.join("bin");
    let secret = "inventory-synthetic-private-value";
    put(&home, "bin/node.exe", "");
    put(&home,".codex/config.toml",&format!("[mcp_servers.js]\ncommand = \"node\"\nargs = [\"file.js\",\"--token={secret}\"]\n[mcp_servers.local]\ncommand = \"not-installed-tool\"\n[plugins.\"plug@market\"]\nenabled = false\n"));
    put(&home, ".codex/auth.json", secret);
    put(&home, ".codex/AGENTS.md", &"x".repeat(40000));
    put(
        &home,
        ".codex/plugins/cache/market/plug/1.0/plugin.json",
        r#"{"description":"fixture plugin","version":"1.0"}"#,
    );
    put(
        &home,
        ".agents/skills/first/SKILL.md",
        "---\nname: first\ndescription: >-\n  first skill\nallowed-tools: [Read, Grep]\n---\n",
    );
    put(
        &home,
        ".agents/skills/second/SKILL.md",
        "not valid for Codex",
    );
    put(
        &home,
        ".claude/settings.json",
        r#"{"disableAllHooks":false,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node x"}]}]}}"#,
    );
    put(
        &home,
        ".claude.json",
        &format!(r#"{{"oauthAccount":"{secret}"}}"#),
    );
    put(
        &project,
        ".mcp.json",
        r#"{"mcpServers":{"web":{"url":"http://example.com/api?api_key=secret"}}}"#,
    );
    put(
        &project,
        ".claude/settings.local.json",
        r#"{"disabledMcpjsonServers":["web"]}"#,
    );
    put(
        &home,
        ".gemini/settings.json",
        "// comment\n{\"mcpServers\":{\"local\":{\"command\":\"node\"}}}",
    );
    put(
        &home,
        ".gemini/extensions/addon/gemini-extension.json",
        r#"{"name":"addon","mcpServers":{"sub":{}}}"#,
    );
    put(
        &home,
        ".config/opencode/opencode.json",
        r#"{"mcp":{"oc":{"type":"local","command":["node","test.js"]}},"plugin":["addon"]}"#,
    );
    put(&project, "AGENTS.md", "# selected project");
    let driver = r#"
      const {scanInventory}=require('../../src/m1/agent-inventory');
      const request=JSON.parse(process.argv[1]);
      const result=scanInventory(request);
      result.items=result.items.map(({locator,...item})=>item);
      console.log(JSON.stringify(result));
    "#;
    let arguments=json!({"home":home,"projects":[project],"env":{"path":bin,"pathExt":".EXE","names":["PATH"]}}).to_string();
    let run = Command::new("node")
        .args(["-e", driver, &arguments])
        .output()
        .expect("golden oracle");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let expected: Value = serde_json::from_slice(&run.stdout).expect("oracle JSON");
    let env = Environment {
        path: bin.to_string_lossy().into_owned(),
        path_ext: ".EXE".to_owned(),
        names: Some(["PATH".to_owned()].into_iter().collect()),
    };
    let actual = json!(scan(&home, &[project], &env, || false).expect("inventory"));
    assert!(!actual.to_string().contains(secret));
    assert_eq!(actual["agents"], expected["agents"]);
    let rows = actual["items"].as_array().expect("Rust rows");
    let golden = expected["items"].as_array().expect("Electron rows");
    assert_eq!(rows.len(), golden.len());
    for (actual, expected) in rows.iter().zip(golden) {
        assert_eq!(actual, expected, "{}", expected["name"]);
    }
    assert_eq!(actual["bytesRead"], expected["bytesRead"]);
    assert_eq!(actual["notes"], expected["notes"]);
}
