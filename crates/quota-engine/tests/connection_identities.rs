use quota_engine::connection_identities::ConnectionIdentities;
use serde_json::{to_value, Value};
use std::{path::Path, process::Command};
use usage_engine::js_json::stringify;

#[test]
fn duplicate_evidence_matches_electron_without_exposing_credentials_or_digests(
) -> Result<(), Box<dyn std::error::Error>> {
    let node = r#"
      const {ConnectionIdentities} = require('./src/quota/connection-identities');
      const {routes} = require('./src/quota/provider-catalog');
      const id = '11111111-2222-4333-8444-555555555555';
      const contexts = {
        'workbuddy-desktop':{desktop:{uid:'synthetic',domain:'workbuddy.cn',enterpriseId:'example'}},
        'zcode-device':{zcode:{userId:'synthetic',deviceMid:id}},
        'opencode-zen':{console:{orgId:'org_sample'}},
        'opencode-web':{workspace:'wrk_sample'},
        'claude-web':{organization:id},
        'gemini-code-assist':'synthetic-project',
      };
      const cookies = {
        'cursor-web':'WorkosCursorSessionToken=synthetic_key',
        'claude-web':'sessionKey=synthetic_key',
        'mimo-web':'api-platform_serviceToken=synthetic_key; userId=test_user',
      };
      const rows = [];
      const run = (first,second) => {
        const ids = new ConnectionIdentities();
        const inputs = [{id:'origin',...first},{id:'z',...second},{id:'a',...second}];
        const result = () => inputs.map(input => ids.view(input.id));
        for (const row of inputs) ids.observe(row.id,row.adapter,row.token,row.context);
        const observations = result();
        ids.forget('a'); const afterForget = result();
        ids.clear(); const afterClear = result();
        rows.push({inputs,observations,afterForget,afterClear});
      };
      for (const [adapter, route] of Object.entries(routes)) {
        const sample = {adapter,token:route.kind === 'cookie' ? cookies[adapter] || 'auth=synthetic_key' : 'synthetic_key',context:contexts[adapter] || null};
        run(sample,sample);
        run(sample,{...sample,context:null});
      }
      const desktop = {adapter:'workbuddy-desktop',token:'synthetic_key',context:contexts['workbuddy-desktop']};
      run(desktop,{...desktop,token:'different_key'});
      run(desktop,{...desktop,context:{desktop:{...desktop.context.desktop,domain:'invalid.test'}}});
      const cursor = {adapter:'cursor-web',token:cookies['cursor-web'],context:{cursor:{subject:'synthetic'}}};
      run(cursor,{...cursor,token:'WorkosCursorSessionToken=different_key'});
      run(cursor,{...cursor,context:{cursor:{subject:'different'}}});
      const mimo = {adapter:'mimo-web',token:cookies['mimo-web'],context:null};
      run(mimo,{...mimo,token:mimo.token.split('; ').reverse().join('; ')});
      run({adapter:'zai-cn',token:'synthetic_key',context:null},{adapter:'zai-global',token:'synthetic_key',context:null});
      process.stdout.write(JSON.stringify(rows));
    "#;
    let reference = Command::new("node")
        .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .args(["-e", node])
        .output()?;
    assert!(reference.status.success());
    let rows: Vec<Value> = serde_json::from_slice(&reference.stdout)?;
    for (index, row) in rows.iter().enumerate() {
        let mut identities = ConnectionIdentities::new()?;
        let inputs = row["inputs"].as_array().expect("identity inputs");
        for input in inputs {
            identities.observe(
                input["id"].as_str().expect("id"),
                input["adapter"].as_str().expect("adapter"),
                input["token"].as_str().expect("synthetic token"),
                &input["context"],
            );
        }
        let check = |state: &ConnectionIdentities, phase| -> Result<(), serde_json::Error> {
            let observations: Vec<_> = inputs
                .iter()
                .map(|input| state.view(input["id"].as_str().expect("id")))
                .collect();
            let view = stringify(&to_value(observations)?);
            assert_eq!(
                view,
                stringify(&row[phase]),
                "synthetic identity row {index}, {phase}"
            );
            assert!(
                !view.contains("synthetic_key")
                    && !view.contains("digest")
                    && !view.contains("context")
            );
            Ok(())
        };
        check(&identities, "observations")?;
        identities.forget("a");
        check(&identities, "afterForget")?;
        identities.clear();
        check(&identities, "afterClear")?;
    }
    Ok(())
}
