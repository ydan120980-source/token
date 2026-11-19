use serde_json::{json, Value};
use std::{path::Path, process::Command};
use usage_engine::{cost_insights, cost_table, insights_math, js_json::stringify, store::Store};

fn rows(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}

fn string(value: &Value) -> &str {
    value.as_str().expect("fixture string")
}

fn size(value: &Value) -> usize {
    value.as_u64().expect("fixture size") as usize
}

fn grouping(value: &Value) -> cost_table::GroupBy {
    match value.as_str() {
        Some("agent") => cost_table::GroupBy::Agent,
        Some("model") | None => cost_table::GroupBy::Model,
        _ => panic!("unexpected grouping {value}"),
    }
}

fn fixture(section: &str, run: impl Fn(&str, &[Value]) -> Value) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cost-gen.cjs");
    let output = Command::new("node")
        .arg(path)
        .arg(section)
        .output()
        .expect("run JS fixture generator");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let fixture: Value = serde_json::from_slice(&output.stdout).expect("decode JS fixture");
    assert!(
        !rows(&fixture).is_empty(),
        "missing fixture section {section}"
    );
    for (index, case) in rows(&fixture).iter().enumerate() {
        let operation = string(&case["operation"]);
        let actual = run(operation, rows(&case["args"]));
        let actual = stringify(&actual);
        let expected = string(&case["expected"]);
        if actual != expected {
            let offset = actual
                .chars()
                .zip(expected.chars())
                .position(|(left, right)| left != right)
                .unwrap_or_else(|| actual.chars().count().min(expected.chars().count()));
            let excerpt = |value: &str| {
                value
                    .chars()
                    .skip(offset.saturating_sub(60))
                    .take(180)
                    .collect::<String>()
            };
            panic!("{section} #{index}: {operation}, mismatch at character {offset}\nRust: {}\nJS:   {}", excerpt(&actual), excerpt(expected));
        }
    }
}

#[test]
fn cost_table_matches_js() {
    fixture("table", |operation, args| match operation {
        "table" => json!(cost_table::table(
            rows(&args[0]),
            grouping(&args[1]["by"]),
            args[1]["previousRows"].as_array().map(Vec::as_slice)
        )),
        "sort" => json!(cost_table::sort(rows(&args[0]), string(&args[1]))),
        "fold" => json!(cost_table::fold(rows(&args[0]).to_vec(), size(&args[1]))),
        "points" => json!(cost_table::points(rows(&args[0]).to_vec(), size(&args[1]))),
        "csv" => json!(cost_table::csv(
            rows(&args[0]),
            grouping(&args[1]),
            string(&args[2]),
            |id| match id {
                "codex" => "Codex",
                "claude" => "Claude Code",
                "opencode" => "OpenCode",
                other => other,
            }
            .to_owned(),
            str::to_owned
        )),
        _ => panic!("unexpected fixture operation: {operation}"),
    });
}

#[test]
fn cost_export_matches_js() {
    fixture("export", |operation, args| {
        assert_eq!(operation, "export");
        match usage_engine::cost_export::cost_export(&args[0], &args[1]) {
            Ok(export) => json!(export),
            Err(error) => json!({"error": error.to_string()}),
        }
    });
}

#[test]
fn cost_insights_match_js() {
    fixture("insights", |operation, args| match operation {
        "total" => json!(cost_insights::total(rows(&args[0]))),
        "months" => json!(cost_insights::months(
            rows(&args[0]),
            args[1]["today"].as_str().unwrap_or_default(),
            args[1]["coverageStart"].as_str(),
            args[1]["minimumDays"].as_i64().unwrap_or(7)
        )),
        "waffle" => json!(cost_insights::waffle(
            &rows(&args[0]).iter().map(Value::as_f64).collect::<Vec<_>>(),
            size(&args[1])
        )),
        "composition" => cost_insights::composition(
            rows(&args[0]),
            args[1]["bucket"].as_str().unwrap_or("week"),
            args[1]["from"].as_str(),
        ),
        "subscriptions" => json!(cost_insights::subscriptions(
            rows(&args[0]),
            args[1]["from"].as_str(),
            args[1]["to"].as_str(),
            &args[1]["fees"],
            &rows(&args[1]["agents"])
                .iter()
                .map(string)
                .collect::<Vec<_>>()
        )),
        "coverage" => cost_insights::coverage(rows(&args[0])),
        "cache" => cost_insights::cache(rows(&args[0])),
        "monthEnd" => json!(cost_insights::month_end(string(&args[0]))),
        "shift" => json!(cost_insights::shift(
            string(&args[0]),
            args[1].as_i64().expect("day offset")
        )),
        _ => panic!("unexpected fixture operation: {operation}"),
    });
}

#[test]
fn insights_math_matches_js() {
    fixture("math", |operation, args| match operation {
        "recorded" => {
            let recorded = insights_math::recorded_fields(rows(&args[0]));
            json!(rows(&args[1])
                .iter()
                .map(|agent| {
                    rows(&args[2])
                        .iter()
                        .map(|field| recorded(string(agent), string(field)))
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>())
        }
        "categoryView" | "cacheHitRate" | "costDestination" | "efficiency" => {
            let entries = rows(&args[0]);
            let recorded = insights_math::recorded_fields(rows(&args[1]));
            match operation {
                "categoryView" => json!(insights_math::category_view(entries, &recorded)),
                "cacheHitRate" => json!(insights_math::cache_hit_rate(entries, &recorded)),
                "costDestination" => insights_math::cost_destination(entries, &recorded),
                _ => insights_math::efficiency(entries, &recorded),
            }
        }
        "shares" => json!(insights_math::shares(
            rows(&args[0]),
            string(&args[1]),
            size(&args[2])
        )),
        "weekHour" => insights_math::week_hour(rows(&args[0])),
        "streaks" => insights_math::streaks(&args[0], string(&args[1]), string(&args[2])),
        "peakWindow" => {
            let hours = rows(&args[0])
                .iter()
                .map(|hour| hour.as_f64().expect("hourly tokens"))
                .collect::<Vec<_>>();
            insights_math::peak_window(&hours.try_into().expect("24 hours"), size(&args[1]))
        }
        "change" => json!(insights_math::change(args[0].as_f64(), args[1].as_f64())),
        _ => panic!("unexpected fixture operation: {operation}"),
    });
}

#[test]
fn subscription_fees_are_validated_and_persisted() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join(format!(
        "cost-parity-{}-{}",
        std::process::id(),
        usage_engine::time::now_ms()
    ));
    struct TempDirectory(std::path::PathBuf);
    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    std::fs::create_dir(&path)?;
    let temp = TempDirectory(path);
    let directory = temp.0.to_str().ok_or("non-UTF-8 test directory")?;
    let mut store = Store::new(directory, &json!({}))?;
    assert!(store.subscriptions().is_empty());
    store.set_subscription("codex", &json!(20))?;
    assert_eq!(stringify(&json!(store.subscriptions())), "{\"codex\":20}");
    store.set_subscription("claude", &json!(99.999))?;
    let preferences = temp.0.join("preferences.json");
    let before = std::fs::read(&preferences)?;
    for (agent, fee) in [
        ("nobody", json!(10)),
        ("codex", json!(0)),
        ("codex", json!(-1)),
        ("codex", json!("20")),
        ("codex", json!(1e6)),
    ] {
        assert_eq!(
            store
                .set_subscription(agent, &fee)
                .as_ref()
                .map_err(String::as_str),
            Err("SUBSCRIPTION_INVALID")
        );
    }
    assert_eq!(std::fs::read(&preferences)?, before);
    store.set_subscription("codex", &Value::Null)?;
    drop(store);
    let restarted = Store::new(directory, &json!({}))?;
    assert_eq!(
        stringify(&json!(restarted.subscriptions())),
        "{\"claude\":100}"
    );
    Ok(())
}
