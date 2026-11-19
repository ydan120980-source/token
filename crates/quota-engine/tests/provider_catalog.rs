use quota_engine::provider_catalog::{capabilities, routes};
use std::process::Command;

#[test]
fn routes_and_capabilities_match_the_electron_catalog() -> Result<(), Box<dyn std::error::Error>> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let js = Command::new("node").current_dir(dir).args(["-e",
        "const p=require('./src/quota/provider-catalog');process.stdout.write(JSON.stringify([p.routes,p.capabilities()]));",
    ]).output()?;
    assert!(js.status.success());
    assert_eq!(
        serde_json::to_vec(&(routes()?, capabilities()?))?,
        js.stdout
    );
    Ok(())
}
