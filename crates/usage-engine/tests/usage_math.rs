use serde_json::{json, Value};
use std::collections::HashSet;
use usage_engine::js_json::stringify;
use usage_engine::usage_math::{disjoint_mix, series_by_model, shift, start_for, SeriesOptions};

fn curves(rows: &[Value], days: &[String], display: &str, metric: &str, observed: &HashSet<String>, order: &[String]) -> std::collections::HashMap<String, Vec<Option<f64>>> {
    let models = vec!["a".to_string(), "b".to_string(), "absent".to_string()];
    series_by_model(&SeriesOptions { rows, models: &models, days: order, display, metric, coverage_start: &days[0], observed_dates: Some(observed) })
}

#[test]
fn batched_curves_retain_calendar_ledger() {
    let days: Vec<String> = (0..32).map(|i| shift("2026-09-01", i)).collect();
    let mut rows: Vec<Value> = Vec::new();
    for date in &days {
        rows.push(json!({"date": date, "model": "a", "totalTokens": 30, "estimatedCostUsd": null}));
        rows.push(json!({"date": date, "model": "b", "totalTokens": 0, "estimatedCostUsd": 0}));
    }
    rows.push(json!({"date": days[31], "model": "a", "totalTokens": 15, "estimatedCostUsd": 3}));
    let mut observed: HashSet<String> = days.iter().cloned().collect();
    fn get(rows: &[Value], days: &[String], observed: &HashSet<String>, display: &str, metric: &str, model: &str, order: &[String]) -> Vec<Option<f64>> {
        curves(rows, days, display, metric, observed, order).remove(model).unwrap()
    }
    let mut expect_a: Vec<Option<f64>> = (0..31).map(|_| Some(30.0)).collect();
    expect_a.push(Some(45.0));
    assert_eq!(get(&rows, &days, &observed, "daily", "tokens", "a", &days), expect_a);
    let mut expect_cost: Vec<Option<f64>> = (0..31).map(|_| None).collect();
    expect_cost.push(Some(3.0));
    assert_eq!(get(&rows, &days, &observed, "daily", "cost", "a", &days), expect_cost);
    assert_eq!(get(&rows, &days, &observed, "daily", "cost", "b", &days), vec![Some(0.0); 32]);
    assert_eq!(get(&rows, &days, &observed, "daily", "cost", "absent", &days), vec![Some(0.0); 32]);
    let mut expect_avg: Vec<Option<f64>> = (0..6).map(|_| None).collect();
    expect_avg.extend((0..25).map(|_| Some(30.0)));
    expect_avg.push(Some(30.5));
    assert_eq!(get(&rows, &days, &observed, "average", "tokens", "a", &days), expect_avg);
    let mut expect_absent: Vec<Option<f64>> = (0..6).map(|_| None).collect();
    expect_absent.extend(vec![Some(0.0); 26]);
    assert_eq!(get(&rows, &days, &observed, "average", "tokens", "absent", &days), expect_absent);
    assert_eq!(get(&rows, &days, &observed, "average", "cost", "a", &days), vec![None; 32]);
    let expect_total: Vec<Option<f64>> = (0..32).map(|i| Some(((i + 1) * 30 + if i == 31 { 15 } else { 0 }) as f64)).collect();
    assert_eq!(get(&rows, &days, &observed, "total", "tokens", "a", &days), expect_total);
    let reversed: Vec<String> = days.iter().rev().cloned().collect();
    for display in ["daily", "average", "total"] {
        for metric in ["tokens", "cost"] {
            for model in ["a", "b", "absent"] {
                let forward = get(&rows, &days, &observed, display, metric, model, &days);
                let mut back = get(&rows, &days, &observed, display, metric, model, &reversed);
                back.reverse();
                assert_eq!(back, forward, "{display}/{metric}/{model}");
            }
        }
    }
    let week: Vec<String> = days[25..].to_vec();
    assert_eq!(get(&rows, &days, &observed, "average", "tokens", "a", &week), vec![Some(30.0), Some(30.0), Some(30.0), Some(30.0), Some(30.0), Some(30.0), Some(30.5)]);
    observed.remove(&days[30]);
    assert_eq!(get(&rows, &days, &observed, "daily", "tokens", "a", &days)[30], None);
    assert_eq!(get(&rows, &days, &observed, "average", "tokens", "a", &days)[31], Some((28.0 * 30.0 + 45.0) / 29.0));
    assert_eq!(get(&rows, &days, &observed, "total", "tokens", "a", &days)[31], Some(975.0));
    let empty_models = vec!["a".to_string()];
    let empty = series_by_model(&SeriesOptions { rows: &[], models: &empty_models, days: &[], display: "average", metric: "cost", coverage_start: &days[0], observed_dates: None });
    assert_eq!(empty.get("a").unwrap(), &Vec::<Option<f64>>::new());
    let sparse: Vec<String> = (0..40).map(|i| shift("2026-09-01", i)).collect();
    let kept: Vec<String> = sparse.iter().enumerate().filter(|(i, _)| i % 3 != 0).map(|(_, d)| d.clone()).collect();
    let sparse_rows: Vec<Value> = kept.iter().map(|date| json!({"date": date, "model": "c", "totalTokens": 30, "estimatedCostUsd": null})).collect();
    let kept_set: HashSet<String> = kept.iter().cloned().collect();
    let models = vec!["c".to_string()];
    let values = series_by_model(&SeriesOptions { rows: &sparse_rows, models: &models, days: &sparse, display: "average", metric: "tokens", coverage_start: &sparse[0], observed_dates: Some(&kept_set) }).remove("c").unwrap();
    assert_eq!(values.iter().position(|v| v.is_some()), Some(10));
    assert!(values[10..].iter().all(|v| *v == Some(30.0)));
}

#[test]
fn calendar_ranges_include_today_and_respect_boundaries() {
    assert_eq!(start_for("2026-01-03", "7", None), "2025-12-28");
    assert_eq!(start_for("2026-03-01", "30", None), "2026-01-31");
    assert_eq!(start_for("2026-10-02", "today", None), "2026-10-02");
    assert_eq!(start_for("2026-10-02", "all", Some("2025-01-01")), "2025-01-01");
}

#[test]
fn disjoint_mix_matches_reference() {
    let rows = json!([
        {"totalTokens": 130, "inputUncached": 100, "output": 20, "cacheRead": 10, "cacheWrite": 0, "reasoning": 5, "records": 2,
         "knownUsage": {"inputUncached": 100, "outputPlain": 15, "cacheRead": 10, "cacheWrite": 0, "reasoning": 5},
         "knownRecords": {"inputUncached": 2, "outputPlain": 2, "cacheRead": 2, "cacheWrite": 2, "reasoning": 2}},
        {"totalTokens": 100, "inputUncached": null, "output": 20, "cacheRead": null, "cacheWrite": 0, "reasoning": null, "records": 1,
         "knownUsage": {"outputPlain": 20}, "knownRecords": {"outputPlain": 1}},
        {"totalTokens": 50, "inputUncached": 40, "output": 10, "cacheRead": 0, "cacheWrite": 0, "reasoning": 15, "records": 1}
    ]);
    let expected = json!({"total": 130, "values": [100, 15, 10, 0, 5], "displayValues": [100, 35, 10, 0, 5], "partialValues": [true, true, true, false, true], "incomplete": true, "coverage": 0.4642857142857143});
    assert_eq!(stringify(&disjoint_mix(rows.as_array().unwrap())), stringify(&expected));
}