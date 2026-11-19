use quota_engine::codex_resources::{from_codex, project_quota, restore_quota, to_legacy};
use serde_json::Value;
use std::{path::Path, process::Command};
use usage_engine::js_json::stringify;

#[test]
fn codex_response_and_legacy_cache_match_the_electron_wire_contract(
) -> Result<(), Box<dyn std::error::Error>> {
    let node = r#"
      const {NOW,iso} = require('./tests/m1/fixtures/quota-resources');
      const {fromCodex,toLegacy,restoreQuota} = require('./src/quota/codex-resources');
      const {projectQuota} = require('./src/quota/contract');
      const at = iso(0), plan = 'synthetic';
      const rows = [
        {rateLimits:{primary:{usedPercent:0},credits:{unlimited:true},secondary:{usedPercent:100,windowDurationMins:0,resetsAt:0}}},
        {rateLimitsByLimitId:{z:{},10:{credits:{hasCredits:false}},2:{primary:{usedPercent:'0',resetsAt:'bad',windowDurationMins:-1}},codex:{limitName:'Plan',secondary:{usedPercent:108,windowDurationMins:10080,resetsAt:NOW/1000+0.5}}},rateLimitResetCredits:{availableCount:0}},
        {rateLimits:{credits:{hasCredits:true,balance:'9007199254740993.125'}}},
        {rateLimits:null}, {rateLimits:{}},
        {}, {rateLimits:[]}, {rateLimits:{credits:0}}, {rateLimitsByLimitId:{bad:null}},
        {rateLimitsByLimitId:{'invalid id':{}}},
        {rateLimitsByLimitId:Object.fromEntries(Array.from({length:101},(_,i)=>[i,{}]))},
      ].map(response => {
        try {
          const v2 = fromCodex(response,at,plan), v1 = projectQuota(response,at), legacy = toLegacy(v2);
          return {response,v2,v1,legacy,restored:restoreQuota(legacy,plan)};
        } catch (error) { return {response,error:error.message}; }
      });
      const historical = [
        {schemaVersion:'AccountQuotaV1',fetchedAt:at,windows:[{name:'Old label',bucket:'codex',kind:'secondary',usedPercent:0,remainingPercent:99,resetsAt:iso(168)}],resetCredits:2,secret:'discarded'},
        {schemaVersion:'AccountQuotaV1',fetchedAt:null,windows:[{}]},
        {schemaVersion:'AccountQuotaV1',windows:[null]},
        {schemaVersion:'AccountQuotaV1',windows:[{bucket:'bad value'}]},
        {schemaVersion:'AccountQuotaV2',provider:'workbuddy',pools:[]},
      ].map(raw => ({raw,expected:restoreQuota(raw,plan)}));
      process.stdout.write(JSON.stringify({at,plan,rows,historical}));
    "#;
    let js = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", node])
        .output()?;
    assert!(
        js.status.success(),
        "{}",
        String::from_utf8_lossy(&js.stderr)
    );
    let fixture: Value = serde_json::from_slice(&js.stdout)?;
    let (at, plan) = (&fixture["at"], &fixture["plan"]);
    for (index, row) in fixture["rows"]
        .as_array()
        .expect("Codex response rows")
        .iter()
        .enumerate()
    {
        let actual = from_codex(&row["response"], at, plan);
        if let Some(expected) = row["error"].as_str() {
            assert_eq!(
                actual.expect_err("Codex protocol error").to_string(),
                expected,
                "Codex error {index}"
            );
            continue;
        }
        let v2 = actual.expect("valid Codex response");
        assert_eq!(stringify(&v2), stringify(&row["v2"]), "Codex V2 {index}");
        let v1 = project_quota(&row["response"], at);
        assert_eq!(stringify(&v1), stringify(&row["v1"]), "Codex V1 {index}");
        let legacy = to_legacy(&v2).expect("Codex legacy quota");
        assert_eq!(
            stringify(&legacy),
            stringify(&row["legacy"]),
            "legacy projection {index}"
        );
        let restored = restore_quota(&legacy, plan).unwrap_or(Value::Null);
        assert_eq!(
            stringify(&restored),
            stringify(&row["restored"]),
            "restored live projection {index}"
        );
    }
    for (index, row) in fixture["historical"]
        .as_array()
        .expect("cache rows")
        .iter()
        .enumerate()
    {
        let restored = restore_quota(&row["raw"], plan).unwrap_or(Value::Null);
        assert_eq!(
            stringify(&restored),
            stringify(&row["expected"]),
            "restored cache {index}"
        );
    }
    Ok(())
}
