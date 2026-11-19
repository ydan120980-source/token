#![cfg(windows)]

use quota_engine::{account_service::AccountService, provider_vault};
use std::{fs, path::Path, process::Command};
use usage_engine::time::now_ms;

#[test]
#[ignore = "requires the project's installed Electron test runtime"]
fn pinned_electron_vault_opens_with_current_user_dpapi() -> Result<(), Box<dyn std::error::Error>> {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let electron = crate_dir.join("../../node_modules/electron/dist/electron.exe");
    let root = tempfile::tempdir()?;
    let status = Command::new(electron)
        .arg(crate_dir.join("tests/fixtures/legacy-safe-storage.cjs"))
        .arg(root.path())
        .env_remove("ELECTRON_RUN_AS_NODE")
        .status()?;
    assert!(status.success());
    let id = "11111111-2222-4333-8444-555555555555";
    let adapter = "deepseek-api";
    let secret =
        provider_vault::import_legacy(root.path(), id, adapter)?.expect("synthetic record");
    assert!(secret.credential.as_str() == "synthetic-fixture-key");
    let sealed = provider_vault::seal(id, adapter, &secret)?;
    let restored = provider_vault::open(id, adapter, &sealed)?;
    assert!(restored.credential.as_str() == "synthetic-fixture-key");
    assert!(provider_vault::open(id, "zai-cn", &sealed).is_err());
    let old_settings = root.path().join("provider-quotas/connections.json");
    let before = fs::read(&old_settings)?;
    let destination = tempfile::tempdir()?;
    let service = AccountService::open(destination.path())?;
    let report = service.import(root.path(), now_ms())?;
    assert_eq!((report.imported, report.credentials_restored), (2, 2));
    let restarted = AccountService::open(destination.path())?;
    assert_eq!(restarted.refreshable()?.len(), 2);
    assert_eq!(fs::read(old_settings)?, before);
    Ok(())
}
