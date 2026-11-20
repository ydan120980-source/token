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

#[cfg(windows)]
#[tokio::test]
async fn native_cli_login_and_refresh_run_in_separate_owned_profiles(
) -> Result<(), Box<dyn std::error::Error>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use quota_engine::{
        account_service::{AccountService, RefreshOutcome},
        provider_antigravity_cli,
        windows_job::ExecutablePin,
    };
    use serde_json::json;
    use std::{fs, io, os::windows::process::CommandExt, path::PathBuf};
    use usage_engine::time::now_ms;
    use windows::Win32::System::Threading::CREATE_NO_WINDOW;

    let root = tempfile::tempdir()?;
    let tools = root.path().join("tools");
    let manifest = tools.join("antigravity");
    fs::create_dir_all(&manifest)?;
    let executable = manifest.join("agy.exe");
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let sample = Command::new("node").current_dir(&project)
        .args(["-e", "process.stdout.write(JSON.stringify(require('./tests/m1/fixtures/antigravity-quota').response()))"])
        .creation_flags(CREATE_NO_WINDOW.0)
        .output()?;
    assert!(sample.status.success());
    let system = PathBuf::from(
        std::env::var_os("SystemRoot").ok_or(io::Error::other("Windows fixture root"))?,
    );
    let builder = Command::new(system.join("System32/WindowsPowerShell/v1.0/powershell.exe"))
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-File"])
        .arg(project.join("tests/m1/fixtures/build-quota-cli.ps1"))
        .arg("-OutputPath")
        .arg(&executable)
        .arg("-Payload")
        .arg(STANDARD.encode(sample.stdout))
        .arg("-SyntheticLogin")
        .creation_flags(CREATE_NO_WINDOW.0)
        .output()?;
    assert!(
        builder.status.success(),
        "synthetic console fixture failed to compile"
    );

    let pin = ExecutablePin::new(&executable)?;
    usage_engine::store_io::atomic(
        &manifest.join("active.json"),
        &json!({
            "agent":"antigravity","version":"1.2.11","executable":executable,"executableHash":pin.sha256(),
            "js":false,"entry":null,"entryHash":null,"binDirectory":null
        }),
        false,
    )?;
    let profiles = root.path().join("profiles");
    let (secret, first) = provider_antigravity_cli::login(&profiles, &tools, || false)?;
    assert_eq!(secret.credential.as_str(), "synthetic-agy-login-2");
    assert_eq!(
        first.observation.resources["pools"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );
    assert!(fs::read_dir(&profiles)?.next().is_none());

    let cache = root.path().join("quota");
    let service = AccountService::open(&cache)?;
    service.set_experimental(true)?;
    service
        .verified_login(
            "antigravity-cli",
            "Synthetic",
            None,
            true,
            secret,
            |_| async move { Ok(first) },
        )
        .await?;
    let state = service.provider_state(now_ms())?;
    let account = &state["accounts"][0];
    let id = account["id"]
        .as_str()
        .ok_or(io::Error::other("fixture id"))?;
    let last = chrono::DateTime::parse_from_rfc3339(
        account["lastAttempt"]
            .as_str()
            .ok_or(io::Error::other("fixture attempt time"))?,
    )?
    .timestamp_millis();
    assert!(service.refreshable_automatic(last + 299_999)?.is_empty());
    assert_eq!(service.refreshable_automatic(last + 300_000)?, [id]);
    service.close().await?;
    let disk = fs::read(cache.join("quota-accounts.json"))?;
    assert!(!disk
        .windows(b"synthetic-agy-login".len())
        .any(|data| data == b"synthetic-agy-login"));

    let service = AccountService::open(&cache)?;
    let result = service
        .refresh(id, |request| {
            let profiles = &profiles;
            let tools = &tools;
            async move {
                provider_antigravity_cli::observe(profiles, tools, &request.secret, || {
                    *request.cancellation.borrow()
                })
            }
        })
        .await?;
    assert_eq!(result, RefreshOutcome::Published);
    assert!(fs::read_dir(&profiles)?.next().is_none());
    service.close().await?;
    Ok(())
}
