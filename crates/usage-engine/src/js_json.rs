use num_bigint::BigUint;
use serde_json::{Map, Value};

pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(value, &mut out);
    out
}

pub(crate) fn pretty(value: &Value) -> String {
    pretty_width(value, 1)
}

pub(crate) fn pretty_width(value: &Value, width: usize) -> String {
    fn write(value: &Value, out: &mut String, depth: usize, width: usize) {
        let indent = |out: &mut String, depth| {
            out.push('\n');
            out.extend(std::iter::repeat_n(' ', depth * width));
        };
        match value {
            Value::Object(map) if !map.is_empty() => {
                out.push('{');
                for (position, key) in ordered_keys(map).into_iter().enumerate() {
                    if position != 0 { out.push(','); }
                    indent(out, depth + 1);
                    write_string(key, out);
                    out.push_str(": ");
                    write(&map[key], out, depth + 1, width);
                }
                indent(out, depth);
                out.push('}');
            }
            Value::Array(items) if !items.is_empty() => {
                out.push('[');
                for (position, item) in items.iter().enumerate() {
                    if position != 0 { out.push(','); }
                    indent(out, depth + 1);
                    write(item, out, depth + 1, width);
                }
                indent(out, depth);
                out.push(']');
            }
            _ => write_value(value, out),
        }
    }
    let mut out = String::new();
    write(value, &mut out, 0, width);
    out
}

fn is_array_index(key: &str) -> bool {
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if key.len() > 1 && key.starts_with('0') {
        return false;
    }
    key.parse::<u64>().map(|v| v <= 4_294_967_294).unwrap_or(false)
}

pub fn ordered_keys(map: &Map<String, Value>) -> Vec<&String> {
    let mut index: Vec<(u64, &String)> = Vec::new();
    let mut rest: Vec<&String> = Vec::new();
    for key in map.keys() {
        if is_array_index(key) {
            index.push((key.parse().unwrap(), key));
        } else {
            rest.push(key);
        }
    }
    index.sort_by_key(|(n, _)| *n);
    index.into_iter().map(|(_, k)| k).chain(rest).collect()
}

fn write_value(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&js_number(n.as_f64().unwrap())),
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => write_object(map, out),
    }
}

fn write_object(map: &Map<String, Value>, out: &mut String) {
    write_filtered_object(map, None, out);
}

pub(crate) fn stringify_without_field(value: &Value, field: &str) -> String {
    if let Value::Object(map) = value {
        let mut out = String::new();
        write_filtered_object(map, Some(field), &mut out);
        out
    } else {
        stringify(value)
    }
}

fn write_filtered_object(map: &Map<String, Value>, skip: Option<&str>, out: &mut String) {
    out.push('{');
    for (i, key) in ordered_keys(map).into_iter().filter(|key| Some(key.as_str()) != skip).enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_string(key, out);
        out.push(':');
        write_value(&map[key], out);
    }
    out.push('}');
}

fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

// ECMA-262 Number::toString formatting: ryu supplies the shortest round-trip
// digits, the placement rules (fixed vs signed exponent) are JavaScript's.
fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    if !value.is_finite() {
        return "null".to_string();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let text = ryu::Buffer::new().format_finite(value.abs()).to_string();
    let (digits, n) = if let Some((mantissa, exponent)) = text.split_once('e') {
        let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
        let digits = digits.trim_end_matches('0');
        (digits.to_string(), exponent.parse::<i32>().unwrap() + 1)
    } else {
        let (whole, fraction) = text.split_once('.').unwrap_or((text.as_str(), ""));
        let raw = format!("{whole}{fraction}");
        let point = whole.len() as i32;
        let first = raw.bytes().position(|b| b != b'0').unwrap();
        let digits = raw[first..].trim_end_matches('0');
        (digits.to_string(), point - first as i32)
    };
    let k = digits.len() as i32;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let exponent = n - 1;
        let mantissa = if digits.len() > 1 {
            format!("{}.{}", &digits[..1], &digits[1..])
        } else {
            digits.clone()
        };
        format!("{mantissa}e{}{}", if exponent >= 0 { "+" } else { "-" }, exponent.abs())
    };
    format!("{sign}{body}")
}

/// Match JavaScript's fixed-decimal rounding on the exact binary value.
pub(crate) fn to_fixed(value: f64, decimals: u32) -> String {
    if !value.is_finite() {
        return if value.is_nan() {
            "NaN"
        } else if value < 0.0 {
            "-Infinity"
        } else {
            "Infinity"
        }
        .to_owned();
    }
    if value.abs() >= 1e21 {
        return js_number(value);
    }
    let bits = value.abs().to_bits();
    let exponent = ((bits >> 52) as i32) - 1023;
    let fraction = bits & ((1 << 52) - 1);
    let (mantissa, shift) = if exponent == -1023 {
        (fraction, 1074)
    } else {
        (fraction | (1 << 52), 52 - exponent)
    };
    let scaled = BigUint::from(mantissa) * BigUint::from(10u8).pow(decimals);
    let integer = if shift > 0 {
        (scaled + (BigUint::from(1u8) << (shift - 1) as usize)) >> shift as usize
    } else {
        scaled << (-shift) as usize
    };
    let sign = if value < 0.0 { "-" } else { "" };
    let decimals = decimals as usize;
    if decimals == 0 {
        return format!("{sign}{integer}");
    }
    let digits = format!("{integer:0width$}", width = decimals + 1);
    let (whole, fraction) = digits.split_at(digits.len() - decimals);
    format!("{sign}{whole}.{fraction}")
}

struct Chunked<'a> {
    parts: Vec<String>,
    length: usize,
    write: &'a mut dyn FnMut(&str),
}

impl<'a> Chunked<'a> {
    fn append(&mut self, text: &str) {
        self.parts.push(text.to_string());
        self.length += text.len();
        if self.length >= 65536 {
            (self.write)(&self.parts.join(""));
            self.parts.clear();
            self.length = 0;
        }
    }

    fn object(&mut self, map: &Map<String, Value>, root: bool) {
        self.append("{");
        let mut first = true;
        for key in ordered_keys(map) {
            let item = &map[key];
            if root && key == "records" && item.is_object() {
                if !first {
                    self.append(",");
                }
                first = false;
                let mut head = String::new();
                write_string(key, &mut head);
                head.push(':');
                self.append(&head);
                self.object(item.as_object().unwrap(), false);
            } else {
                let text = stringify(item);
                if !first {
                    self.append(",");
                }
                first = false;
                let mut head = String::new();
                write_string(key, &mut head);
                head.push(':');
                head.push_str(&text);
                self.append(&head);
            }
        }
        self.append("}");
    }
}

pub fn write_statistics(value: &Value, write: &mut dyn FnMut(&str)) {
    match value.as_object() {
        None => write(&stringify(value)),
        Some(map) => {
            let mut chunked = Chunked { parts: Vec::new(), length: 0, write };
            chunked.object(map, true);
            if !chunked.parts.is_empty() {
                (chunked.write)(&chunked.parts.join(""));
            }
        }
    }
}
