use serde_json::json;
use usage_engine::js_json::{stringify, write_statistics};

// Expectations generated from the JS reference (JSON.stringify) on synthetic inputs.
#[test]
fn number_formatting_matches_js() {
    let cases: &[(f64, &str)] = &[
        (1e21, "1e+21"),
        (1e-7, "1e-7"),
        (1e-6, "0.000001"),
        (0.000001, "0.000001"),
        (123.456, "123.456"),
        (100.0, "100"),
        (0.5, "0.5"),
        (-0.0, "0"),
        (0.0, "0"),
        (9007199254740991.0, "9007199254740991"),
        (1.5e300, "1.5e+300"),
        (5e-324, "5e-324"),
        (123456789012345678901234567890.0, "1.2345678901234568e+29"),
        (0.1, "0.1"),
        (2.5e-10, "2.5e-10"),
        (1e20, "100000000000000000000"),
        (3.141592653589793, "3.141592653589793"),
        (-42.5, "-42.5"),
    ];
    for (value, expected) in cases {
        assert_eq!(stringify(&json!(value)), *expected, "value {value}");
    }
    assert_eq!(stringify(&json!(f64::NAN)), "null");
    assert_eq!(stringify(&json!(f64::INFINITY)), "null");
}

#[test]
fn object_key_order_matches_js() {
    let value = json!({
        "__proto__": {"retained": true},
        "2": {"zero": -0.0},
        "1": null,
        "b": 1,
        "a": 2,
        "01": "x",
        "4294967295": "y",
        "4294967294": "z",
        "r10": 1,
        "r2": 2
    });
    assert_eq!(
        stringify(&value),
        r#"{"1":null,"2":{"zero":0},"4294967294":"z","__proto__":{"retained":true},"b":1,"a":2,"01":"x","4294967295":"y","r10":1,"r2":2}"#
    );
}

#[test]
fn string_escaping_matches_js() {
    let value = json!({"s": "\"\n{}\\\u{8}\u{c}\t\r\u{1}\u{1f}中文🙂/"});
    assert_eq!(
        stringify(&value),
        "{\"s\":\"\\\"\\n{}\\\\\\b\\f\\t\\r\\u0001\\u001f中文🙂/\"}"
    );
}

#[test]
fn sparse_values_match_js() {
    // JS `undefined` members are absent keys on the Rust side; the bytes must agree.
    let value = json!({"n": null, "t": true, "arr": [0, null, {"x": true}]});
    assert_eq!(stringify(&value), r#"{"n":null,"t":true,"arr":[0,null,{"x":true}]}"#);
    for value in [json!(null), json!([]), json!(true), json!(42), json!("text"), json!({}), json!({"records": []}), json!({"records": null})] {
        let mut out = String::new();
        write_statistics(&value, &mut |t| out.push_str(t));
        assert_eq!(out, stringify(&value));
    }
}

#[test]
fn streamed_ledger_equals_native_bytes_in_bounded_chunks() {
    let mut records = serde_json::Map::new();
    records.insert("__proto__".into(), json!({"retained": true}));
    records.insert("2".into(), json!({"zero": -0.0}));
    records.insert("1".into(), json!(null));
    for i in 0..10000 {
        records.insert(
            format!("r{i}"),
            json!({"model": "中文🙂", "text": "\\\"\n{}", "nullable": null, "nested": [0, null, {"x": true}], "unknownSavedField": i}),
        );
    }
    let value = json!({
        "version": 1,
        "sequence": 5,
        "records": records,
        "unknown": {"retained": true},
        "statuses": {"codex": {"lastSuccess": null}}
    });
    let mut chunks: Vec<String> = Vec::new();
    write_statistics(&value, &mut |t| chunks.push(t.to_string()));
    let native = stringify(&value);
    assert_eq!(chunks.join(""), native);
    assert!(chunks.len() > 10);
    assert!(chunks.iter().all(|c| c.len() < 70000));
}