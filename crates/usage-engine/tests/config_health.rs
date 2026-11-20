#![cfg(windows)]

use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};
use usage_engine::{config_health, config_health_syntax as syntax, js_json::stringify};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn oracle(script: &str, request: &Value) -> Result<Value, Box<dyn std::error::Error>> {
    let result = Command::new("node")
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", script, &stringify(request)])
        .output()?;
    assert!(result.status.success(), "Electron fixture failed");
    Ok(serde_json::from_slice(&result.stdout)?)
}

#[test]
fn bounded_syntax_retains_electron_categories_and_values() -> Result<(), Box<dyn std::error::Error>>
{
    let cases = json!([
        ["json", r#"{"n": 10, "capture":[false,null,"quoted"], "key":"redacted"}"#],
        ["json", r#"{"dupe":1,"dupe":2}"#],
        ["json", "[1,]"],
        ["toml", "[features]\nhooks = true\n[[hooks.SessionStart]]\nhooks = [{ type = 'command', command = 'synthetic' }]"],
        ["toml", "mixed = [1, 'hello', true,]\nserver.cwd = 'synthetic'\n[server]\nother = 1"],
        ["toml", "[x]\n[x]"],
        ["toml", "when = 2000-01-01"],
        ["frontmatter", "---\nname: fake\nallowed-tools:\n  - tool\n  - 'others'\ndescription: >\n  Multi\n  line\n---"],
        ["frontmatter", "---\nallowed-tools: [\"read\", \"find\"]\nnumber: 1_000\n---"],
        ["frontmatter", "---\nname: &reference value\n---"],
        ["frontmatter", "---\nname: x\nname: y\n---"],
    ]);
    let expected = oracle(
        r#"
const syntax=require('./src/m1/config-health-syntax');
const result=JSON.parse(process.argv[1]).map(([kind,input])=>{
  try{return {value:syntax[kind](input)}}catch(error){return {error:error.message}}
});
process.stdout.write(JSON.stringify(result));
"#,
        &cases,
    )?;
    let rows = cases.as_array().ok_or("fixture shape")?;
    for (index, row) in rows.iter().enumerate() {
        let text = row[1].as_str().ok_or("fixture text")?;
        let parsed = match row[0].as_str() {
            Some("json") => syntax::json(text),
            Some("toml") => syntax::toml(text),
            _ => syntax::frontmatter(text),
        };
        let actual = match parsed {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":error}),
        };
        assert_eq!(
            stringify(&actual),
            stringify(&expected[index]),
            "fixture {index}"
        );
    }
    Ok(())
}

#[test]
fn static_health_matches_electron_without_opening_instructions_or_skill_bodies(
) -> Result<(), Box<dyn std::error::Error>> {
    let dir = Scratch(std::env::temp_dir().join(format!(
        "quota-config-health-{:016x}",
        rand::random::<u64>()
    )));
    let root = dir.0.join("selected");
    for folder in [
        ".codex",
        ".claude",
        ".agents/skills/one",
        ".agents/skills/two",
    ] {
        fs::create_dir_all(root.join(folder))?;
    }
    fs::write(
        root.join(".codex/config.toml"),
        "[features]\nhooks = false\n[mcp_servers.a]\nurl = 'https://example.invalid/synthetic'\n",
    )?;
    fs::write(
        root.join(".codex/hooks.json"),
        r#"{"hooks":{"SessionEnd":[{"hooks":[{"type":"mcp_tool","server":"private-server","tool":"private-tool"}]}]}}"#,
    )?;
    fs::write(
        root.join(".claude/settings.json"),
        r#"{"disableAllHooks":true,"hooks":{"PreToolUse":[{"matcher":"tool","hooks":[{"type":"command","command":"private-command"}]}]}}"#,
    )?;
    fs::write(
        root.join(".mcp.json"),
        r#"{"mcpServers":{"x":{"type":"stdio","command":"private-command","env":{"AUTH":"private-marker"}}}}"#,
    )?;
    fs::write(root.join("AGENTS.md"), b"private-instructions")?;
    fs::write(root.join(".claude.json"), b"NEVER_OPEN_ACCOUNT_FILE")?;
    for folder in ["one", "two"] {
        fs::write(
            root.join(format!(".agents/skills/{folder}/SKILL.md")),
            b"---\nname: private-name\ndescription: short\n---\nprivate-body",
        )?;
    }
    let request = json!({"project":root});
    let actual = config_health::scan(&request, &["codex", "claude"], || false)?;
    let expected = oracle(
        r#"
const {scanConfigHealth}=require('./src/m1/config-health');
process.stdout.write(JSON.stringify(scanConfigHealth(JSON.parse(process.argv[1]))));
"#,
        &request,
    )?;
    assert_eq!(actual, expected);
    let text = stringify(&actual);
    for marker in [
        "private-name",
        "private-command",
        "private-marker",
        "private-instructions",
        "private-body",
        "NEVER_OPEN_ACCOUNT_FILE",
    ] {
        assert!(!text.contains(marker));
    }
    assert_eq!(
        config_health::scan(&request, &["codex"], || true).unwrap_err(),
        "CONFIG_CHECK_CANCELLED"
    );
    Ok(())
}
