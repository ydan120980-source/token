use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

static KEY: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?[ \t]*$").ok());

#[derive(Default)]
pub struct Frontmatter {
    pub present: bool,
    pub closed: bool,
    pub fields: Map<String, Value>,
    pub hazard: Option<&'static str>,
    pub odd: bool,
}

fn comment(value: &str) -> &str {
    value
        .find(" #")
        .or_else(|| value.find("\t#"))
        .map_or(value, |index| &value[..index])
        .trim_end()
}

fn quoted(raw: &str) -> Option<String> {
    let quote = raw.chars().next()?;
    let mut chars = raw[quote.len_utf8()..].char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if quote == '"' && ch == '\\' {
            chars.next();
        } else if quote == '\''
            && ch == quote
            && chars.peek().is_some_and(|(_, next)| *next == quote)
        {
            chars.next();
        } else if ch == quote {
            let body = &raw[1..index + 1];
            return if quote == '\'' {
                Some(body.replace("''", "'"))
            } else {
                Some(
                    serde_json::from_str(&raw[..index + 2].replace('\n', " "))
                        .unwrap_or_else(|_| body.to_owned()),
                )
            };
        }
    }
    None
}

fn list_item(value: &str) -> String {
    if value.starts_with(['"', '\'']) {
        quoted(value).unwrap_or_else(|| value.to_owned())
    } else {
        comment(value).to_owned()
    }
}

fn flow(raw: &str) -> Vec<Value> {
    let Some(end) = raw.rfind(']') else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut item = String::new();
    let mut quote = None;
    for ch in raw[1..end].chars() {
        if let Some(open) = quote {
            if ch == open {
                quote = None;
            } else {
                item.push(ch);
            }
        } else if matches!(ch, '\'' | '"') {
            quote = Some(ch);
        } else if ch == ',' {
            if !item.trim().is_empty() {
                result.push(Value::String(item.trim().to_owned()));
            }
            item.clear();
            if result.len() >= 256 {
                return result;
            }
        } else {
            item.push(ch);
        }
    }
    if !item.trim().is_empty() {
        result.push(Value::String(item.trim().to_owned()));
    }
    result
}

fn indented(value: &str) -> bool {
    value.starts_with([' ', '\t']) && !value.trim().is_empty()
}

fn take<'a>(
    lines: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>,
    filter: impl Fn(&str) -> bool,
) -> Vec<&'a str> {
    let mut nested = Vec::new();
    while let Some(line) = lines.next_if(|value| filter(value)) {
        nested.push(line);
    }
    nested
}

/// Inventory follows an Agent's permissive header rules. Config writes use the
/// stricter parser in config_health_syntax.
pub fn read(source: &str) -> Frontmatter {
    let source = source.trim_start_matches('\u{feff}');
    let mut result = Frontmatter::default();
    let mut lines = source.lines();
    if !lines
        .next()
        .is_some_and(|line| line.trim_end_matches([' ', '\t']) == "---")
    {
        return result;
    }
    result.present = true;
    let mut size = 0usize;
    let mut body = Vec::new();
    for line in lines {
        if line.trim_end_matches([' ', '\t']) == "---" {
            result.closed = true;
            break;
        }
        size += line.encode_utf16().count() + 1;
        if size > 65537 {
            break;
        }
        body.push(line);
    }
    if !result.closed {
        result.odd = true;
        return result;
    }
    let mut lines = body.into_iter().peekable();
    while let Some(line) = lines.next() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let Some(captures) = KEY.as_ref().and_then(|key| key.captures(line)) else {
            result.odd = true;
            continue;
        };
        let key = captures[1].to_owned();
        let raw = captures.get(2).map_or("", |m| m.as_str()).trim();
        let block = raw
            .split_once(" #")
            .map_or(raw, |(value, _)| value)
            .trim_end();
        let value = if block.starts_with(['|', '>'])
            && block[1..]
                .chars()
                .all(|ch| ch.is_ascii_digit() || matches!(ch, '+' | '-'))
        {
            let lines = take(&mut lines, |line| indented(line) || line.trim().is_empty());
            let body = lines
                .iter()
                .map(|line| line.trim())
                .collect::<Vec<_>>()
                .join(if block.starts_with('>') { " " } else { "\n" });
            Value::String(body.trim().to_owned())
        } else if raw.is_empty() || raw.starts_with('#') {
            let nested = take(&mut lines, |line| {
                indented(line) || line.trim().is_empty() || line.starts_with("- ")
            });
            let items: Vec<_> = nested
                .iter()
                .filter_map(|line| line.trim_start().strip_prefix("- "))
                .map(|line| Value::String(list_item(line.trim())))
                .collect();
            if !items.is_empty()
                && items.len()
                    == nested
                        .iter()
                        .filter(|line| !line.trim().is_empty() && !line.starts_with("    "))
                        .count()
            {
                Value::Array(items)
            } else if nested.iter().any(|line| !line.trim().is_empty()) {
                Value::Object(Map::new())
            } else {
                Value::Null
            }
        } else if raw.starts_with(['\'', '"']) {
            let mut candidate = raw.to_owned();
            while quoted(&candidate).is_none() {
                let Some(line) = lines.next_if(|line| indented(line) || line.trim().is_empty())
                else {
                    break;
                };
                candidate.push('\n');
                candidate.push_str(line.trim());
            }
            Value::String(quoted(&candidate).unwrap_or_else(|| {
                result.odd = true;
                candidate[1..].to_owned()
            }))
        } else if raw.starts_with('[') {
            let mut candidate = raw.to_owned();
            while !candidate.contains(']') {
                let Some(line) = lines.next_if(|line| indented(line) || line.trim().is_empty())
                else {
                    break;
                };
                candidate.push(' ');
                candidate.push_str(line.trim());
            }
            result.odd |= !candidate.contains(']');
            Value::Array(flow(&candidate))
        } else if raw.starts_with('{') {
            take(&mut lines, indented);
            Value::Object(Map::new())
        } else {
            let plain = comment(raw);
            let rest = take(&mut lines, indented);
            if plain.contains(": ") || plain.contains(":\t") || plain.ends_with(':') {
                result.hazard.get_or_insert("colon");
            } else if plain.starts_with(['*', '&', '!', '%', '@', '|', '>', '?', '-'])
                && !plain
                    .trim_start_matches('-')
                    .starts_with(|ch: char| ch.is_ascii_digit())
            {
                result.hazard.get_or_insert("mark");
            }
            let combined = std::iter::once(plain)
                .chain(rest.into_iter().map(str::trim))
                .collect::<Vec<_>>()
                .join(" ");
            Value::String(combined.trim().to_owned())
        };
        result.fields.insert(key, value);
    }
    result
}
