use serde_json::json;
use std::{fs, path::PathBuf};
use usage_engine::store::Store;

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn summary_counts_attributed_sessions_with_model_membership_across_all_dates(
) -> Result<(), Box<dyn std::error::Error>> {
    let directory =
        Scratch(std::env::temp_dir().join(format!("quotadock-summary-{}", rand::random::<u64>())));
    let mut store = Store::new(directory.0.to_str().ok_or("fixture directory")?, &json!({}))?;
    let desired = "2026-10-12T12:00:00.000Z";
    let other = "2026-09-30T12:00:00.000Z";
    let row = |id, agent, key, model, timestamp| json!({"id":id,"agent":agent,"sessionKey":key,"model":model,"timestamp":timestamp});
    store.state["records"] = json!({
        "a":row("a","codex","one","different",desired),
        "b":row("b","codex","one","different",desired),
        "c":row("c","codex","one","selected",other),
        "d":row("d","claude","two","selected",desired),
        "e":row("e","claude","three","selected",desired),
        "f":row("f","claude","","selected",desired)
    });
    store.state["duplicateIds"] = json!({"e":true});
    let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_owned());
    let date = usage_engine::usage_projection::day(desired, &timezone);
    assert_eq!(
        serde_json::to_value(store.session_summary(&json!({"date":date,"model":"selected"}))?)?,
        json!({"count":2,"agents":{"codex":1,"claude":1},"date":date,"model":"selected"})
    );
    assert_eq!(
        store
            .session_summary(&json!({"date":date,"agent":"kimi"}))?
            .count,
        0
    );
    assert_eq!(
        store
            .session_summary(&json!({"date":date,"agent":"codex"}))?
            .count,
        1
    );
    for invalid in [
        json!({"date":"20261012"}),
        json!({"agent":"unknown"}),
        json!({"model":12}),
        json!({"model":"😀".repeat(91)}),
    ] {
        assert_eq!(
            store.session_summary(&invalid).err().as_deref(),
            Some("SESSION_SELECTION_INVALID")
        );
    }
    Ok(())
}
