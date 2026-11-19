use quota_engine::quota_watch::{bundled, evaluate, window_rows, QuotaWatch, Settings};
use serde_json::{json, to_value, Map, Value};
use std::{fs, path::Path, process::Command};
use usage_engine::js_json::stringify;

#[test]
fn watch_rows_and_notification_transitions_match_electron() -> Result<(), Box<dyn std::error::Error>>
{
    let reference = r#"
      const {windowRows,evaluate,bundled,DEFAULTS} = require('./src/quota/quota-watch');
      const now=Date.parse('2026-10-01T08:00:00Z'), later=ms=>new Date(now+ms).toISOString();
      const account = (remaining, reset, freshness='fresh') => ({
        id:'a', provider:'codex',alias:'Synthetic',quota:{fetchedAt:later(0),pools:[{
          id:'codex', label:'Codex', windows:[
            {id:'weekly',remainingPercent:remaining,label:'weekly',durationMins:10080,state:'available',resetsAt:later(reset),freshness:{state:freshness}},
            {id:'credits',remaining:'27',total:'100',state:'available',label:'积分',freshness:{state:'cached'}},
            {id:'unknown',remaining:null,total:null,remainingPercent:null,state:'unknown'},
            {id:'disabled',remainingPercent:0,state:'unavailable'}
          ], balances:[{id:'not-a-window',remaining:'0'}]
        }]}});
      const cases = [[18,3600000],[15,3600000],[15,8*60000],[15,7*60000],[90,86400000,'stale'],[90,86400000],[5,4*60000]];
      let prior={};
      const fixture = cases.map(([remaining,reset,fresh], index) => {
        const sample=account(remaining,reset,fresh);
        const accounts=index===6?[sample,{...sample,id:'b'}]:[sample];
        const settings=index===2?{...DEFAULTS,low:30}:DEFAULTS;
        const rows=windowRows(accounts), marks=prior, result=evaluate(rows,marks,settings,now);
        prior=result.marks;
        return {accounts,settings,marks,rows,result,bundled:bundled(result.notices)};
      });
      process.stdout.write(JSON.stringify({now,fixture}));
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
    let wire: Value = serde_json::from_slice(&js.stdout)?;
    let now = wire["now"].as_i64().expect("fixed clock");
    for (index, sample) in wire["fixture"]
        .as_array()
        .expect("watch cases")
        .iter()
        .enumerate()
    {
        let rows = window_rows(sample["accounts"].as_array().expect("accounts"));
        assert_eq!(
            stringify(&to_value(&rows)?),
            stringify(&sample["rows"]),
            "watch rows {index}"
        );
        let settings = Settings {
            low: u8::try_from(
                sample["settings"]["low"]
                    .as_u64()
                    .expect("numeric threshold"),
            )?,
            ..Default::default()
        };
        let evaluation = evaluate(
            &rows,
            sample["marks"].as_object().expect("earlier marks"),
            settings,
            now,
        );
        assert_eq!(
            stringify(&to_value(&evaluation)?),
            stringify(&sample["result"]),
            "watch transition {index}"
        );
        assert_eq!(
            stringify(&to_value(bundled(evaluation.notices))?),
            stringify(&sample["bundled"]),
            "notices {index}"
        );
    }
    Ok(())
}

#[test]
fn watch_reloads_saved_marks_and_applies_only_supported_preferences(
) -> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let accounts = [
        json!({"id":"a","provider":"codex","quota":{"pools":[{"id":"codex",
        "windows":[{"id":"week","remainingPercent":9,"freshness":{"state":"fresh"}}]}]}}),
    ];
    let rows = window_rows(&accounts);
    let mut watch = QuotaWatch::open(root.path());
    assert_eq!(watch.check(&rows, 0).len(), 1);
    assert!(watch.check(&rows, 0).is_empty());
    let mut restored = QuotaWatch::open(root.path());
    assert!(restored.check(&rows, 0).is_empty());
    assert!(restored
        .set(&json!({"enabled":false,"low":7,"reset":12}), &rows, 0)
        .is_empty());
    assert_eq!(
        restored.settings(),
        Settings {
            enabled: false,
            ..Default::default()
        }
    );
    let sanitized = fs::read(root.path().join("quota-watch.json"))?;
    let saved: Value = serde_json::from_slice(&sanitized)?;
    assert_eq!(saved["marks"], json!({"a/codex/week":{"low":true}}));
    assert!(!stringify(&saved).contains("remaining"));
    fs::write(root.path().join("quota-watch.json"), b"{broken")?;
    assert_eq!(
        QuotaWatch::open(root.path()).settings(),
        Settings::default()
    );
    assert_eq!(
        evaluate(&rows, &Map::new(), Settings::default(), 0)
            .notices
            .len(),
        1
    );
    Ok(())
}
