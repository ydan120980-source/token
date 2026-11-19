use quota_engine::{resource_contract::project_resources, resource_state::resource_view};
use serde_json::Value;
use std::{path::Path, process::Command};
use usage_engine::js_json::stringify;

#[test]
fn resource_normalization_and_freshness_match_electron() -> Result<(), Box<dyn std::error::Error>> {
    let node = r#"
      const {NOW,iso,raw,cases} = require('./tests/m1/fixtures/quota-resources');
      const {projectResources} = require('./src/quota/resource-contract');
      const {resourceView} = require('./src/quota/resource-state');
      const boundary = raw('deepseek');
      boundary.entitlement.validUntil = '2026-02-30T03:00:00Z';
      boundary.pools[0].modelIds = ['z','a','z'];
      boundary.pools[0].windows = [
        {id:'past',unit:'percent',usedPercent:100,observedAt:iso(0),resetsAt:iso(-1)},
        {id:'future',unit:'percent',usedPercent:0,observedAt:iso(60001)},
        {id:'age',unit:'percent',usedPercent:15,observedAt:iso(-600001)},
        {id:'invalid-duration',unit:'percent',usedPercent:50,durationMins:0},
      ];
      boundary.pools[0].balances = [
        {id:'derived',unit:'credits',total:'10000000000000000.125',used:'1.001',remainingMode:'total-minus-used'},
        {id:'explicit-null',unit:'credits',total:10,used:3,remaining:null,remainingMode:'total-minus-used'},
        {id:'conflict',unit:'credits',total:10,used:'11',remainingMode:'total-minus-used'},
        {id:'invalid-interval',unit:'credits',validFrom:iso(300),expiresAt:iso(20)},
        {id:'not-yet-valid',unit:'credits',validFrom:iso(300),availability:'available'},
        {id:'entitlement',unit:'credits',requiresEntitlement:true,availability:'available'},
        {id:'date-boundary',unit:'credits',observedAt:'0000-01-01T00:00:00+00:01'},
      ];
      const duplicate = raw('codex'); duplicate.pools.push(duplicate.pools[0]);
      const rows = [boundary,duplicate,raw(),null];
      const checkProjection = rows.map(raw => ({raw,expected:projectResources(raw)}));
      const resources = [projectResources(boundary), ...Object.values(cases).map(make => make()),projectResources(raw()),null];
      const accounts = [{status:'ready'},{status:'ready',busy:true},{status:'cached',errorCode:'READ_FAILED'}];
      const checkFreshness = resources.flatMap(resources => accounts.map(account => ({
        resources,account,expected:resourceView(resources,account,NOW),
      })));
      process.stdout.write(JSON.stringify({now:NOW,checkProjection,checkFreshness}));
    "#;
    let reference = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", node])
        .output()?;
    assert!(
        reference.status.success(),
        "{}",
        String::from_utf8_lossy(&reference.stderr)
    );
    let fixture: Value = serde_json::from_slice(&reference.stdout)?;
    let projections = fixture["checkProjection"]
        .as_array()
        .expect("projection rows");
    for (index, row) in projections.iter().enumerate() {
        let actual = project_resources(&row["raw"]).unwrap_or(Value::Null);
        assert_eq!(
            stringify(&actual),
            stringify(&row["expected"]),
            "resource projection {index}"
        );
    }
    let now = fixture["now"].as_i64().expect("fixed Electron clock");
    let freshness = fixture["checkFreshness"]
        .as_array()
        .expect("freshness rows");
    for (index, row) in freshness.iter().enumerate() {
        let actual = resource_view(row["resources"].clone(), &row["account"], now);
        assert_eq!(
            stringify(&actual),
            stringify(&row["expected"]),
            "resource freshness {index}"
        );
    }
    Ok(())
}
