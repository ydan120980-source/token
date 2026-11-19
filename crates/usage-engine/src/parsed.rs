// JS attaches .warnings/.sessions to parsed record arrays; the Rust shape keeps
// them beside the records with the same content and order.
use serde_json::Value;

#[derive(Default, Clone)]
pub struct Parsed {
    pub records: Vec<Value>,
    pub warnings: Vec<String>,
    pub sessions: Vec<Value>,
}

impl Parsed {
    pub fn new() -> Self {
        Parsed::default()
    }

    pub fn warn(&mut self, code: &str) {
        if !self.warnings.iter().any(|w| w == code) {
            self.warnings.push(code.to_string());
        }
    }
}

pub fn object(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Object(_)))
}

pub fn truthy(value: Option<&Value>) -> bool {
    value.map(crate::normalize::truthy).unwrap_or(false)
}

// JS `a || b` over optional values: first truthy wins.
pub fn or<'a>(a: Option<&'a Value>, b: Option<&'a Value>) -> Option<&'a Value> {
    if truthy(a) {
        a
    } else {
        b
    }
}

pub fn get<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}