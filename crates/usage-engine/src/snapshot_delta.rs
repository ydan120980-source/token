use crate::local_snapshot::select_snapshot;
use crate::snapshot_codec::pack;
use serde_json::{json, Value};

// G9: JS plans deltas by row object identity (WeakMap). Rust Values carry no
// identity, so structural equality stands in until the projection layer reuses
// Rc rows; referenced rows are value-equal either way, restoration stays exact.
pub fn snapshot_delta(previous: Option<&Value>, next: &Value, base_revision: i64, catalog: Option<&Value>) -> Result<Option<Value>, String> {
    let Some(previous) = previous else { return Ok(None) };
    if base_revision.abs() > 9_007_199_254_740_991 {
        return Ok(None);
    }
    let next_daily = next.get("daily").and_then(|v| v.as_array()).ok_or("INVALID_USAGE_SNAPSHOT")?;
    let empty: Vec<Value> = Vec::new();
    let next_hourly = next.get("hourly").and_then(|v| v.as_array()).unwrap_or(&empty);
    if next_daily.len() > 100_000 || next_hourly.len() > 50_000 {
        return Err("INVALID_USAGE_SNAPSHOT".to_string());
    }
    let plan = |before: &[Value], after: &[Value]| -> Option<(Vec<Value>, Vec<i64>)> {
        let mut changed = 0;
        let mut rows: Vec<Value> = Vec::new();
        let mut order: Vec<i64> = Vec::new();
        for row in after {
            if let Some(index) = before.iter().position(|b| b == row) {
                order.push(index as i64);
            } else {
                changed += 1;
                if changed > 4096 {
                    return None;
                }
                rows.push(row.clone());
                order.push(-(rows.len() as i64));
            }
        }
        Some((rows, order))
    };
    let prev_daily = previous.get("daily").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let prev_hourly = previous.get("hourly").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let Some((daily_rows, daily_order)) = plan(&prev_daily, next_daily) else { return Ok(None) };
    let Some((hourly_rows, hourly_order)) = plan(&prev_hourly, next_hourly) else { return Ok(None) };
    let mut changed_snapshot = next.as_object().cloned().unwrap_or_default();
    changed_snapshot.insert("daily".into(), json!(daily_rows));
    changed_snapshot.insert("hourly".into(), json!(hourly_rows));
    let mut selected = select_snapshot(&Value::Object(changed_snapshot), catalog)?;
    let mut start: Option<String> = None;
    for row in next_daily {
        let date = row.get("date").and_then(|v| v.as_str()).unwrap_or("");
        let b = date.as_bytes();
        let shaped = date.len() == 10 && b[4] == b'-' && b[7] == b'-' && date.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() });
        if !shaped {
            return Err("INVALID_USAGE_ROW".to_string());
        }
        if start.as_deref().map(|s| date < s).unwrap_or(true) {
            start = Some(date.to_string());
        }
    }
    selected.as_object_mut().unwrap().insert("coverageStart".into(), json!(start));
    let mut out = pack(&selected).as_object().cloned().unwrap_or_default();
    out.insert("codec".into(), json!("LocalUsageDeltaV1"));
    out.insert("baseRevision".into(), json!(base_revision));
    out.insert("dailyOrder".into(), json!(daily_order));
    out.insert("hourlyOrder".into(), json!(hourly_order));
    Ok(Some(Value::Object(out)))
}