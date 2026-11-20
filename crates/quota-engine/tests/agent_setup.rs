use quota_engine::agent_setup::{agent_view, antigravity_view, usage_recovery};
use serde_json::{json, Value};
use std::process::Command;

#[test]
fn generic_and_antigravity_setup_match_original_views() {
    let js = r#"
      const {createAgentSetup}=require('../../src/quota/agent-setup');
      const {projectSetup}=require('../../src/quota/antigravity-setup');
      const {agents}=require('../../src/m1/agent-catalog');
      const setup=createAgentSetup({
        catalog:()=>agents, facts:()=>({enabled:true,status:{status:'partial',errors:['SOURCE_BUSY','REDACTED_SECRET']}}),
        environment:()=>({}),antigravity:{state:()=>projectSetup()}
      });
      console.log(JSON.stringify([setup.state('claude'),setup.state('antigravity'),projectSetup()]));
    "#;
    let node = Command::new("node")
        .args(["-e", js])
        .output()
        .expect("Electron setup oracle");
    assert!(
        node.status.success(),
        "{}",
        String::from_utf8_lossy(&node.stderr)
    );
    let golden: Vec<Value> = serde_json::from_slice(&node.stdout).expect("oracle views");
    let usage = usage_recovery(
        true,
        &json!({"status":"partial","errors":["SOURCE_BUSY","REDACTED_SECRET"]}),
        false,
    );
    assert_eq!(
        agent_view("claude", "Claude Code", &usage, 1, None),
        Some(golden[0].clone())
    );
    assert_eq!(
        agent_view("antigravity", "Antigravity", &usage, 0, None),
        Some(golden[1].clone())
    );
    assert_eq!(antigravity_view(0, None), golden[2]);
    let missing =
        json!({"status":"not-found","coverage":{"complete":true},"selection":{"state":"none"}});
    assert!(antigravity_view(2, Some(&missing))["installation"]["command"].is_string());
    let incomplete = json!({"status":"partial","coverage":{"complete":false},"selection":{"state":"incomplete"}});
    assert!(antigravity_view(3, Some(&incomplete))["installation"]["command"].is_null());
}
