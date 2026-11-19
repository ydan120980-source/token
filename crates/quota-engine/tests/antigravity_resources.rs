use quota_engine::antigravity_resources::{from_antigravity, from_statusline};
use serde_json::Value;
use std::{path::Path, process::Command};
use usage_engine::js_json::stringify;

#[test]
fn antigravity_cli_and_passive_contracts_match_electron() -> Result<(), Box<dyn std::error::Error>>
{
    let reference = r#"
      const {fromAntigravity} = require('./src/quota/antigravity-resources');
      const {projectAntigravity} = require('./src/quota/antigravity-passive');
      const {response,NOW} = require('./tests/m1/fixtures/antigravity-quota');
      const at = new Date(NOW).toISOString();
      const capture = run => {try {return {expected:run()};} catch(error) {return {error:error.message};}};
      const sample = response(), valid = JSON.stringify(sample);
      const malformed = response(); malformed.command.data.groups[0].buckets[0].remaining_fraction = 4; malformed.command.data.groups[0].buckets[0].reset_time = '2026-02-30T00:00:00Z';
      const unsafe = response(); delete unsafe.usage.total_tokens;
      const cli = [
        {stdout:valid,version:'Antigravity CLI v1.2.11\n'},
        {stdout:'startup noise\n'+valid+'\nend',version:'agy version 1.4.2'},
        {stdout:JSON.stringify(malformed),version:'1.2.11'},
        {stdout:JSON.stringify(unsafe),version:'1.2.11'},
        {stdout:valid+'\n{"usage":{"output_tokens":1}}',version:'1.2.11'},
        {stdout:valid+'\n{"status":"ERROR"}',version:'1.2.11'},
        {stdout:valid+'\n{broken}',version:'1.2.11'},
        {stdout:valid+'\n'+valid,version:'1.2.11'},
        ...['1.4.3','1.02.11','1.2.11-beta','1.2.11 1.2.11'].map(version=>({stdout:valid,version})),
      ].map(row=>({...row,...capture(()=>fromAntigravity(row.stdout,at,row.version))}));
      const passive = [
        {product:'antigravity',version:'Antigravity CLI v1.4.2',quota:{'synthetic-model-z':{remaining_fraction:.75},'synthetic-model-A':{remaining_fraction:0},'synthetic-model-a':{remaining_fraction:'0.5'},'synthetic-model-emoji🟢':{reset_time:at}}},
        {product:'antigravity',quota:{}}, {product:'antigravity',quota:[]}, {product:'other'},
      ].map(raw=>({raw,...capture(()=>projectAntigravity(raw,at))}));
      process.stdout.write(JSON.stringify({at,cli,passive}));
    "#;
    let js = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", reference])
        .output()?;
    assert!(
        js.status.success(),
        "{}",
        String::from_utf8_lossy(&js.stderr)
    );
    let fixture: Value = serde_json::from_slice(&js.stdout)?;
    let at = &fixture["at"];
    for (index, row) in fixture["cli"]
        .as_array()
        .expect("CLI rows")
        .iter()
        .enumerate()
    {
        let actual = from_antigravity(
            row["stdout"].as_str().expect("sample bytes"),
            at,
            row["version"].as_str().expect("CLI version"),
        );
        if let Some(error) = row["error"].as_str() {
            assert_eq!(
                actual
                    .expect_err("invalid or unsafe CLI result")
                    .to_string(),
                error,
                "CLI row {index}"
            );
        } else {
            assert_eq!(
                stringify(&actual?),
                stringify(&row["expected"]),
                "CLI row {index}"
            );
        }
    }
    for (index, row) in fixture["passive"]
        .as_array()
        .expect("passive rows")
        .iter()
        .enumerate()
    {
        let actual = from_statusline(&row["raw"], at);
        if let Some(error) = row["error"].as_str() {
            assert_eq!(
                actual.expect_err("invalid statusline result").to_string(),
                error,
                "passive row {index}"
            );
        } else {
            let wire = stringify(&actual?);
            assert_eq!(wire, stringify(&row["expected"]), "passive row {index}");
            assert!(!wire.contains("synthetic-model"));
        }
    }
    Ok(())
}
