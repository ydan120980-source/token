use quota_engine::provider_credentials::normalize_credential;
use serde_json::{json, Value};
use std::process::Command;

#[test]
fn normalization_matches_electron_for_tokens_and_route_specific_cookie_selection(
) -> Result<(), Box<dyn std::error::Error>> {
    let fixtures = json!([
        [
            "claude-web",
            "COOKIE: extra=drop; sessionKey=synthetic-value"
        ],
        ["claude-web", "sessionKey=one; sessionKey=two"],
        [
            "mimo-web",
            "userId=123; api-platform_serviceToken=synthetic-value; tracking=drop"
        ],
        ["mimo-web", "api-platform_serviceToken=synthetic-value"],
        [
            "cursor-web",
            "WorkosCursorSessionToken=sample; next-auth.session-token=sample"
        ],
        [
            "cursor-web",
            "tracking=drop; next-auth.session-token=synthetic-token"
        ],
        ["opencode-web", "bad=drop; __Host-auth=value=with=padding"],
        ["workbuddy-web", "only-valid=token; invalid/name=value"],
        ["gemini-web", "a=contains white space; b=valid"],
        ["deepseek-api", "synthetic-key"],
        ["deepseek-api", "synthetic key"],
        ["deepseek-api", "页-synthetic"],
        ["not-a-route", "synthetic-key"]
    ]);
    let js = Command::new("node").current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", "const n=require('./src/quota/provider-credentials').normalizeCredential;process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(([a,v])=>n(a,v))));", &fixtures.to_string()]).output()?;
    assert!(js.status.success());
    let output = fixtures
        .as_array()
        .ok_or("fixture rows")?
        .iter()
        .map(|pair| {
            normalize_credential(
                pair[0].as_str().unwrap_or_default(),
                pair[1].as_str().unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(json!(output), serde_json::from_slice::<Value>(&js.stdout)?);
    Ok(())
}
