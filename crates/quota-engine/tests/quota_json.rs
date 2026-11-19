use quota_engine::{
    provider_adapters::{from_provider, AdapterOptions},
    quota_json::decode_body,
};
use serde_json::{json, Value};
use std::{path::Path, process::Command};
use usage_engine::js_json::stringify;

#[test]
fn provider_amount_lexemes_match_electron_and_remain_exact_through_projection(
) -> Result<(), Box<dyn std::error::Error>> {
    let bodies = [
        r#"{"used":9007199254740993.125,"limit":9007199254740994.125,"balance":0.29,"autoPercentUsed":0.36,"long":[{"balance":1e1},{"balance":-0.00},{"balance":"001.350"},{"balance":null},{"balance":{"used":0.17}}]}"#,
        r#"{"limit":"old","l\u0069mit":7.3000,"balance":1e9999,"code":-0,"bool":true,"empty":false}"#,
        r#"{"code":0,"data":{"Packages":[{"CapacityUnit":"credits","CycleTotalCapacity":9007199254740993.125,"CycleRemainCapacity":"20.125","CycleFrozenCapacity":"1.1"}]}}"#,
    ];
    let js = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", "const {quotaJSON}=require('./src/quota/quota-json');process.stdout.write(JSON.stringify(process.argv.slice(1).map(quotaJSON)));"])
        .args(bodies)
        .output()?;
    assert!(js.status.success());
    let expected: Vec<Value> = serde_json::from_slice(&js.stdout)?;
    for (index, (body, expected)) in bodies.iter().zip(expected).enumerate() {
        let actual = decode_body("workbuddy-web", body.as_bytes())?;
        assert_eq!(
            stringify(&actual),
            stringify(&expected),
            "provider JSON {index}"
        );
    }
    let raw = decode_body("workbuddy-web", bodies[2].as_bytes())?;
    let resources = from_provider(
        "workbuddy-web",
        &raw,
        &json!("2026-11-19T12:00:00Z"),
        AdapterOptions::default(),
    )?;
    assert_eq!(
        resources["pools"][0]["balances"][0]["total"],
        "9007199254740993.125"
    );
    assert_eq!(
        decode_body("gemini-web", b" \n)]}' \n [true,null] \n")?,
        json!([true, null])
    );
    assert!(decode_body("claude-web", b")]}' [true]").is_err());
    for malformed in [
        r#"{"balance":01}"#,
        r#"{"balance":123.}"#,
        r#"{"balance":1}null"#,
    ] {
        assert!(decode_body("workbuddy-web", malformed.as_bytes()).is_err());
    }
    Ok(())
}
