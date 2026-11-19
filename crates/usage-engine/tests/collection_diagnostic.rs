use serde_json::{json, Value};
use std::process::Command;
use usage_engine::collection_diagnostic::{classify, failure, from_message, sanitize};

#[test]
fn projection_matches_js_and_cannot_marshal_raw_error_fields(
) -> Result<(), Box<dyn std::error::Error>> {
    let raw = "C:/sensitive/auth.json SECRET_TOKEN https://synthetic.invalid";
    let tests = json!([
        {"message":raw,"code":"EACCES","stack":raw},
        {"message":"NATIVE_TOTAL_MISMATCH","path":raw},
        {"message":"SOURCE_LIMIT"},
        {"message":"COLLECTION_WORKER_FAILED"},
        {"message":"SECRET_TOKEN"},
        {"message":"SOURCE_UNREADABLE","cause":{"code":"ENOSPC","token":raw}}
    ]);
    let code = r#"const p=require('./src/m1/collection-diagnostic');
        const errors=JSON.parse(process.argv[1]);
        console.log(JSON.stringify(errors.map(error=>[
          p.classify(error,'source-scan'),p.failure(error,'source-scan'),
          p.sanitize({...p.classify(error,'source-scan'),extra:'SECRET_TOKEN'}),
          (()=>{const e=p.fromMessage({error:error.message,diagnostic:{stage:'ingest',category:'os',reason:'EACCES',evil:error.stack}});return {error:e.message,diagnostic:e.diagnostic}})()
        ])))"#;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let result = Command::new("node")
        .current_dir(root)
        .args(["-e", code, &tests.to_string()])
        .output()?;
    assert!(result.status.success());
    let expected: Value = serde_json::from_slice(&result.stdout)?;
    let actual = tests.as_array().ok_or("fixture list")?.iter().map(|error| {
        let diagnosis = classify(error, "source-scan");
        let mut candidate = json!(diagnosis);
        candidate["extra"] = json!("SECRET_TOKEN");
        json!([diagnosis, failure(error, "source-scan", "COLLECTION_FAILED"), sanitize(&candidate),
            from_message(&json!({"error":error["message"],"diagnostic":{"stage":"ingest","category":"os","reason":"EACCES","evil":raw}}),
                "collection", "COLLECTION_FAILED")])
    }).collect::<Vec<_>>();
    assert_eq!(json!(actual), expected);
    assert!(!expected.to_string().contains("SECRET_TOKEN"));
    assert!(sanitize(&json!({"stage":"ingest","category":"native","reason":"EPERM"})).is_none());
    Ok(())
}
