use num_bigint::BigInt;
use num_traits::Signed;

const MAX_INTEGER_DIGITS: usize = 36;
const MAX_SCALE: usize = 18;

pub fn amount_number(value: f64) -> Option<String> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > 9_007_199_254_740_991.0 {
        return None;
    }
    amount_str(&(value as u64).to_string())
}

pub fn amount_str(value: &str) -> Option<String> {
    if value.len() > MAX_INTEGER_DIGITS + MAX_SCALE + 1 {
        return None;
    }
    let (whole, fraction) = match value.split_once('.') {
        Some((w, f)) => {
            if f.is_empty() {
                return None;
            }
            (w, f)
        }
        None => (value, ""),
    };
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if whole.len() > MAX_INTEGER_DIGITS || fraction.len() > MAX_SCALE {
        return None;
    }
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let fraction = fraction.trim_end_matches('0');
    Some(if fraction.is_empty() {
        whole.to_string()
    } else {
        format!("{whole}.{fraction}")
    })
}

fn aligned(values: &[&str]) -> Option<(usize, Vec<BigInt>)> {
    let normalized: Vec<String> = values.iter().map(|v| amount_str(v)).collect::<Option<_>>()?;
    let scale = normalized
        .iter()
        .map(|v| v.split_once('.').map(|(_, f)| f.len()).unwrap_or(0))
        .max()
        .unwrap_or(0);
    let mut out = Vec::with_capacity(normalized.len());
    for v in &normalized {
        let (w, f) = v.split_once('.').unwrap_or((v.as_str(), ""));
        let mut digits = String::from(w);
        digits.push_str(f);
        for _ in f.len()..scale {
            digits.push('0');
        }
        out.push(digits.parse::<BigInt>().ok()?);
    }
    Some((scale, out))
}

fn format(value: &BigInt, scale: usize) -> Option<String> {
    let text = value.to_string();
    let padded = if text.len() < scale + 1 {
        format!("{}{}", "0".repeat(scale + 1 - text.len()), text)
    } else {
        text
    };
    let candidate = if scale == 0 {
        padded
    } else {
        format!("{}.{}", &padded[..padded.len() - scale], &padded[padded.len() - scale..])
    };
    amount_str(&candidate)
}

pub fn subtract(total: &str, used: &[&str]) -> Option<String> {
    let mut all = vec![total];
    all.extend_from_slice(used);
    let (scale, values) = aligned(&all)?;
    let mut result = values[0].clone();
    for v in &values[1..] {
        result -= v;
    }
    if result.is_negative() {
        return None;
    }
    format(&result, scale)
}

pub fn compare(left: &str, right: &str) -> Option<i8> {
    let (_, values) = aligned(&[left, right])?;
    Some(match values[0].cmp(&values[1]) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Equal => 0,
    })
}