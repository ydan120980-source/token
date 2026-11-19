use usage_engine::amount::{amount_number, amount_str, compare, subtract};

// Expectations generated from the JS reference (src/quota/amount.js) on synthetic inputs.
#[test]
fn normalization_matches_reference() {
    let cases: &[(&str, Option<&str>)] = &[
        ("0", Some("0")),
        ("0.0", Some("0")),
        ("000123", Some("123")),
        ("1.2300", Some("1.23")),
        ("0.000", Some("0")),
        (
            "123456789012345678901234567890123456.123456789012345678",
            Some("123456789012345678901234567890123456.123456789012345678"),
        ),
        ("1e5", None),
        ("0.5", Some("0.5")),
        ("-0", None),
        ("1.5", Some("1.5")),
        ("abc", None),
        ("", None),
        ("1234567890123456789012345678901234567.1", None),
        ("1.1234567890123456789", None),
        ("1.", None),
        (".5", None),
        ("1.2.3", None),
        ("000", Some("0")),
    ];
    for (input, expected) in cases {
        assert_eq!(amount_str(input).as_deref(), *expected, "input {input:?}");
    }
}

#[test]
fn number_inputs_match_reference() {
    assert_eq!(amount_number(0.0).as_deref(), Some("0"));
    assert_eq!(amount_number(-0.0).as_deref(), Some("0"));
    assert_eq!(amount_number(42.0).as_deref(), Some("42"));
    assert_eq!(amount_number(1.5), None);
    assert_eq!(amount_number(-1.0), None);
    assert_eq!(amount_number(9_007_199_254_740_991.0).as_deref(), Some("9007199254740991"));
    assert_eq!(amount_number(9_007_199_254_740_993.0), None);
    assert_eq!(amount_number(f64::NAN), None);
    assert_eq!(amount_number(f64::INFINITY), None);
}

#[test]
fn arithmetic_matches_reference() {
    assert_eq!(subtract("10", &["1.5", "2.25"]).as_deref(), Some("6.25"));
    assert_eq!(subtract("1", &["2"]), None);
    assert_eq!(subtract("0.3", &["0.1"]).as_deref(), Some("0.2"));
    assert_eq!(subtract("5.000", &["0.000"]).as_deref(), Some("5"));
    assert_eq!(subtract("0", &["0"]).as_deref(), Some("0"));
    assert_eq!(
        subtract("1000000000000000000000000000000000000", &["1"]),
        None // 37 integer digits: rejected before arithmetic
    );
    assert_eq!(compare("1.10", "1.1"), Some(0));
    assert_eq!(compare("2", "10"), Some(-1));
    assert_eq!(compare("10", "2"), Some(1));
    assert_eq!(compare("1", "1"), Some(0));
    assert_eq!(compare("x", "1"), None);
    assert_eq!(subtract("10", &["x"]), None);
}

#[test]
fn scale_alignment_keeps_exact_decimals() {
    assert_eq!(
        subtract("1", &["0.000000000000000001"]).as_deref(),
        Some("0.999999999999999999")
    );
    assert_eq!(subtract("0.1", &["0.2", "0.3"]), None);
    assert_eq!(
        subtract("999999999999999999999999999999999999.999999999999999999", &["0.000000000000000001"])
            .as_deref(),
        Some("999999999999999999999999999999999999.999999999999999998")
    );
}