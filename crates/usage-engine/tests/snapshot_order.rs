use serde_json::{json, Map, Value};
use usage_engine::normalize::normalize;
use usage_engine::usage_snapshot::{select_usage_snapshot, FIELDS};

const TIME: &str = "2026-10-05T12:00:00Z";

fn obs(name: &str) -> Value {
    match name {
        "A120" => json!({"input": 100, "output": 20, "reasoning": 0}),
        "B120" => json!({"input": 90, "output": 30, "reasoning": 0}),
        "C120" => json!({"input": 100, "output": 20}),
        "D140" => json!({"input": 100, "output": 40, "reasoning": 0}),
        "F160" => json!({"input": 100, "output": 60}),
        "G140" => json!({"input": 90, "output": 50, "reasoning": 0}),
        "X140" => json!({"input": 100, "output": 40, "reasoning": 0, "total": 150}),
        "Y100" => json!({"input": 80, "output": 20, "reasoning": 0, "total": 90}),
        _ => unreachable!(),
    }
}

fn record(name: &str) -> Value {
    let mut usage = obs(name);
    usage.as_object_mut().unwrap().insert("cache".into(), json!({"read": 0, "write": 0}));
    normalize("opencode", &usage, &json!({"id": "same", "session": "s", "model": "gpt-4.1", "time": TIME}), "salt", "exclusive").unwrap()
}

fn rank(r: &Value) -> i32 {
    let quality = r
        .get("measurementQuality")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| r.get("quality").and_then(|v| v.as_str()))
        .unwrap_or("");
    match quality {
        "measured" => 2,
        "partial" => 1,
        _ => 0,
    }
}

fn known(r: &Value) -> i32 {
    FIELDS.iter().filter(|f| r.get(**f).and_then(|v| v.as_f64()).map(|v| v.is_finite()).unwrap_or(false)).count() as i32
}

fn disagree(a: &Value, b: &Value) -> bool {
    rank(a) > 0
        && rank(b) > 0
        && FIELDS.iter().any(|f| {
            let x = a.get(*f).and_then(|v| v.as_f64());
            let y = b.get(*f).and_then(|v| v.as_f64());
            matches!((x, y), (Some(x), Some(y)) if x.is_finite() && y.is_finite() && x != y)
        })
}

fn view(r: &Value) -> Value {
    let mut map = Map::new();
    map.insert("total".into(), r.get("totalTokens").cloned().unwrap_or(Value::Null));
    if r.get("usageConflict").and_then(|v| v.as_bool()).unwrap_or(false) {
        map.insert("conflict".into(), json!(true));
    } else {
        map.insert("quality".into(), r.get("quality").cloned().unwrap_or(Value::Null));
        map.insert("model".into(), r.get("model").cloned().unwrap_or(Value::Null));
        for f in FIELDS {
            map.insert(f.into(), r.get(f).cloned().unwrap_or(Value::Null));
        }
    }
    Value::Object(map)
}

fn expected(records: &[Value]) -> Value {
    let valid: Vec<&Value> = records.iter().filter(|r| rank(r) > 0).collect();
    let pool: Vec<&Value> = if valid.is_empty() { records.iter().collect() } else { valid };
    let total = pool.iter().map(|r| r.get("totalTokens").and_then(|v| v.as_f64()).unwrap()).fold(f64::NEG_INFINITY, f64::max);
    let top: Vec<&Value> = pool.into_iter().filter(|r| r.get("totalTokens").and_then(|v| v.as_f64()).unwrap() == total).collect();
    if top.iter().any(|r| r.get("usageConflict").and_then(|v| v.as_bool()).unwrap_or(false))
        || top.iter().any(|a| top.iter().any(|b| disagree(a, b)))
    {
        return json!({"total": total, "conflict": true});
    }
    let score = |r: &Value| (rank(r), known(r), if r.get("model").and_then(|v| v.as_str()) == Some("unknown") { 0 } else { 1 });
    let best = top.iter().copied().reduce(|best, r| if score(r) > score(best) { r } else { best }).unwrap();
    view(best)
}

fn permutations(items: &[Value]) -> Vec<Vec<Value>> {
    if items.len() < 2 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for i in 0..items.len() {
        let mut rest = items.to_vec();
        let head = rest.remove(i);
        for mut p in permutations(&rest) {
            let mut row = vec![head.clone()];
            row.append(&mut p);
            out.push(row);
        }
    }
    out
}

fn subsets(items: &[Value], min: usize, max: usize) -> Vec<Vec<Value>> {
    let mut all: Vec<Vec<Value>> = vec![Vec::new()];
    for x in items {
        let mut grown = all.clone();
        for s in &mut grown {
            s.push(x.clone());
        }
        all.extend(grown);
    }
    all.into_iter().filter(|s| s.len() >= min && s.len() <= max).collect()
}

fn fold(records: &[Value]) -> (Value, Vec<&'static str>) {
    let mut saved: Option<Value> = None;
    let mut issues = Vec::new();
    for r in records {
        let choice = select_usage_snapshot(saved.as_ref(), r);
        saved = Some(choice.record);
        if let Some(issue) = choice.issue {
            if !issues.contains(&issue) {
                issues.push(issue);
            }
        }
    }
    (saved.unwrap(), issues)
}

#[test]
fn normalize_matches_reference_bytes() {
    let expected: Value = serde_json::from_str(include_str!("fixtures/normalize-expected.json")).unwrap();
    for (name, want) in expected.as_object().unwrap() {
        assert_eq!(&record(name), want, "record {name}");
    }
}

#[test]
fn selection_is_order_independent_for_every_observation_set() {
    let mut pool: Vec<Value> = ["A120", "B120", "C120", "D140", "F160", "G140", "X140", "Y100"].iter().map(|n| record(n)).collect();
    let mut unknown = record("A120");
    unknown.as_object_mut().unwrap().insert("model".into(), json!("unknown"));
    unknown.as_object_mut().unwrap().insert("provider".into(), json!("unknown"));
    pool.push(unknown);
    for set in subsets(&pool, 1, 4) {
        let want = expected(&set);
        for order in permutations(&set) {
            let (saved, issues) = fold(&order);
            assert_eq!(
                usage_engine::js_json::stringify(&view(&saved)),
                usage_engine::js_json::stringify(&want),
                "order {:?}",
                order.iter().map(|r| r.get("totalTokens").unwrap()).collect::<Vec<_>>()
            );
            if saved.get("usageConflict").and_then(|v| v.as_bool()).unwrap_or(false) {
                assert!(issues.contains(&"SOURCE_USAGE_CONFLICT"));
            }
        }
    }
}

#[test]
fn larger_partial_supersedes_smaller_measured_and_invalid_never_displaces() {
    for order in permutations(&[record("A120"), record("F160")]) {
        assert_eq!(view(&fold(&order).0), view(&record("F160")));
    }
    for order in permutations(&[record("A120"), record("X140")]) {
        assert_eq!(view(&fold(&order).0), view(&record("A120")));
    }
    for later in ["D140", "F160"] {
        for order in permutations(&[record("A120"), record("B120"), record(later)]) {
            assert_eq!(view(&fold(&order).0), view(&record(later)));
        }
    }
    let (_, issues) = fold(&[record("D140"), record("A120")]);
    assert!(issues.contains(&"SOURCE_USAGE_REGRESSION"));
}