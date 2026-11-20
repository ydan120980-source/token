use indexmap::IndexMap;
use serde_json::{Map, Number, Value};
use std::sync::LazyLock;

pub type ParseResult<T> = Result<T, &'static str>;
const UNSUPPORTED: &str = "SYNTAX_UNSUPPORTED";
const DUPLICATE: &str = "DUPLICATE_KEY";
const LIMIT: &str = "PARSE_LIMIT";

#[derive(Default)]
struct Table {
    entries: IndexMap<String, Node>,
    sealed: bool,
    dotted: bool,
    declared: bool,
}

enum Node {
    Scalar(Value),
    List(Vec<Node>),
    Table(Table),
    TableArray(Vec<Table>),
}

impl Node {
    fn value(self) -> Value {
        match self {
            Self::Scalar(value) => value,
            Self::List(items) => Value::Array(items.into_iter().map(Self::value).collect()),
            Self::Table(table) => Value::Object(table.into_values()),
            Self::TableArray(items) => Value::Array(
                items
                    .into_iter()
                    .map(|t| Value::Object(t.into_values()))
                    .collect(),
            ),
        }
    }
}

impl Table {
    fn into_values(self) -> Map<String, Value> {
        self.entries
            .into_iter()
            .map(|(key, node)| (key, node.value()))
            .collect()
    }

    fn insert(&mut self, keys: &[String], value: Node) -> ParseResult<()> {
        let (last, parents) = keys.split_last().ok_or(UNSUPPORTED)?;
        let mut table = self;
        for key in parents {
            match table
                .entries
                .entry(key.clone())
                .or_insert_with(|| Node::Table(Table::default()))
            {
                Node::Table(child) if !child.sealed => {
                    child.dotted = true;
                    table = child;
                }
                _ => return Err(UNSUPPORTED),
            }
        }
        if table.entries.contains_key(last) {
            return Err(DUPLICATE);
        }
        table.entries.insert(last.clone(), value);
        Ok(())
    }

    fn header(&mut self, keys: &[String], array: bool) -> ParseResult<()> {
        let (last, parents) = keys.split_last().ok_or(UNSUPPORTED)?;
        let mut table = self;
        for key in parents {
            table = table.child(key, true)?;
        }
        if array {
            let Node::TableArray(rows) = table
                .entries
                .entry(last.clone())
                .or_insert_with(|| Node::TableArray(Vec::new()))
            else {
                return Err(UNSUPPORTED);
            };
            rows.push(Table {
                declared: true,
                ..Table::default()
            });
        } else {
            let current = table.child(last, true)?;
            if current.declared || current.dotted {
                return Err(DUPLICATE);
            }
            current.declared = true;
        }
        Ok(())
    }

    fn child(&mut self, key: &str, create: bool) -> ParseResult<&mut Table> {
        if create && !self.entries.contains_key(key) {
            self.entries
                .insert(key.to_owned(), Node::Table(Table::default()));
        }
        let next = match self.entries.get_mut(key).ok_or(UNSUPPORTED)? {
            Node::Table(table) => table,
            Node::TableArray(rows) => rows.last_mut().ok_or(UNSUPPORTED)?,
            _ => return Err(UNSUPPORTED),
        };
        if next.sealed {
            return Err(UNSUPPORTED);
        }
        Ok(next)
    }
}

struct Scanner<'a> {
    text: &'a str,
    at: usize,
    nodes: usize,
    toml: bool,
}

impl<'a> Scanner<'a> {
    fn new(text: &'a str, toml: bool) -> Self {
        Self {
            text,
            at: 0,
            nodes: 0,
            toml,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.text.as_bytes().get(self.at).copied()
    }

    fn take(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn require(&mut self, byte: u8) -> ParseResult<()> {
        self.take(byte).then_some(()).ok_or(UNSUPPORTED)
    }

    fn skip(&mut self, allowed: fn(u8) -> bool) {
        while self.peek().is_some_and(allowed) {
            self.at += 1;
        }
    }

    fn space(&mut self) {
        loop {
            self.skip(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n'));
            if !(self.toml && self.take(b'#')) {
                break;
            }
            self.skip(|byte| byte != b'\n');
        }
    }

    fn string(&mut self) -> ParseResult<String> {
        let start = self.at;
        let quote = self.peek().ok_or(UNSUPPORTED)?;
        self.at += 1;
        if self.text.as_bytes().get(self.at..self.at + 2) == Some(&[quote, quote]) {
            return Err(UNSUPPORTED);
        }
        while let Some(byte) = self.peek() {
            self.at += 1;
            if byte == quote {
                return if quote == b'\'' {
                    Ok(self.text[start + 1..self.at - 1].to_owned())
                } else {
                    serde_json::from_str(&self.text[start..self.at]).map_err(|_| UNSUPPORTED)
                };
            }
            if byte < 32 || self.toml && byte == 127 {
                return Err(UNSUPPORTED);
            }
            if byte == b'\\' && quote == b'"' {
                let escape = self.peek().ok_or(UNSUPPORTED)?;
                if self.toml
                    && !matches!(
                        escape,
                        b'b' | b't' | b'n' | b'f' | b'r' | b'"' | b'\\' | b'u'
                    )
                {
                    return Err(UNSUPPORTED);
                }
                self.at += 1;
            }
        }
        Err(UNSUPPORTED)
    }

    fn key(&mut self) -> ParseResult<String> {
        self.space();
        if self.peek() == Some(b'"') || self.toml && self.peek() == Some(b'\'') {
            return self.string();
        }
        if !self.toml {
            return Err(UNSUPPORTED);
        }
        let start = self.at;
        self.skip(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
        if self.at == start {
            return Err(UNSUPPORTED);
        }
        Ok(self.text[start..self.at].to_owned())
    }

    fn keys(&mut self) -> ParseResult<Vec<String>> {
        let start = self.at;
        let mut keys = vec![self.key()?];
        loop {
            if keys.len() > 24 {
                return Err(LIMIT);
            }
            if self.text[start..self.at].contains('\n') {
                return Err(UNSUPPORTED);
            }
            self.skip(|byte| matches!(byte, b' ' | b'\t'));
            if !self.take(b'.') {
                return Ok(keys);
            }
            keys.push(self.key()?);
        }
    }

    fn next_value(&mut self, depth: usize) -> ParseResult<Node> {
        self.nodes += 1;
        if depth > 24 || self.nodes > 20_000 {
            return Err(LIMIT);
        }
        self.space();
        match self.peek() {
            Some(b'"') => self.string().map(|s| Node::Scalar(Value::String(s))),
            Some(b'\'') if self.toml => self.string().map(|s| Node::Scalar(Value::String(s))),
            Some(b'[') => self.list(depth),
            Some(b'{') => self.inline_object(depth),
            _ => self.scalar(),
        }
    }

    fn list(&mut self, depth: usize) -> ParseResult<Node> {
        self.require(b'[')?;
        self.space();
        let mut items = Vec::new();
        if !self.take(b']') {
            loop {
                items.push(self.next_value(depth + 1)?);
                self.space();
                if self.take(b']') {
                    break;
                }
                self.require(b',')?;
                self.space();
                if self.toml && self.take(b']') {
                    break;
                }
            }
        }
        Ok(Node::List(items))
    }

    fn inline_object(&mut self, depth: usize) -> ParseResult<Node> {
        self.require(b'{')?;
        let start = self.at;
        let mut table = Table::default();
        self.space();
        if !self.take(b'}') {
            loop {
                let keys = if self.toml {
                    self.keys()?
                } else {
                    vec![self.key()?]
                };
                self.space();
                self.require(if self.toml { b'=' } else { b':' })?;
                let value = self.next_value(depth + 1)?;
                table.insert(&keys, value)?;
                self.space();
                if self.toml && self.text[start..self.at].contains('\n') {
                    return Err(UNSUPPORTED);
                }
                if self.take(b'}') {
                    break;
                }
                self.require(b',')?;
            }
        }
        table.sealed = true;
        Ok(Node::Table(table))
    }

    fn scalar(&mut self) -> ParseResult<Node> {
        let start = self.at;
        while self.peek().is_some_and(|byte| {
            !(byte.is_ascii_whitespace()
                || matches!(byte, b',' | b']' | b'}')
                || self.toml && byte == b'#')
        }) {
            self.at += 1;
        }
        let token = &self.text[start..self.at];
        let value = match token {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            "null" if !self.toml => Value::Null,
            _ => {
                let numeric = if self.toml {
                    token.strip_prefix('+').unwrap_or(token)
                } else {
                    token
                };
                let parsed: Number = serde_json::from_str(numeric).map_err(|_| UNSUPPORTED)?;
                Value::Number(
                    Number::from_f64(parsed.as_f64().ok_or(UNSUPPORTED)?).ok_or(UNSUPPORTED)?,
                )
            }
        };
        Ok(Node::Scalar(value))
    }
}

pub fn json(text: &str) -> ParseResult<Value> {
    let mut scan = Scanner::new(text, false);
    let value = scan.next_value(0)?.value();
    scan.space();
    (scan.at == text.len()).then_some(value).ok_or(UNSUPPORTED)
}

pub fn toml(text: &str) -> ParseResult<Value> {
    let mut scan = Scanner::new(text, true);
    let mut root = Table::default();
    let mut active = Vec::new();
    loop {
        scan.space();
        if scan.at == text.len() {
            return Ok(Value::Object(root.into_values()));
        }
        if scan.take(b'[') {
            let start = scan.at;
            let array = scan.take(b'[');
            active = scan.keys()?;
            if text[start..scan.at].contains('\n') {
                return Err(UNSUPPORTED);
            }
            scan.require(b']')?;
            if array {
                scan.require(b']')?;
            }
            root.header(&active, array)?;
        } else {
            let keys = scan.keys()?;
            scan.skip(|byte| matches!(byte, b' ' | b'\t'));
            scan.require(b'=')?;
            scan.skip(|byte| matches!(byte, b' ' | b'\t'));
            if matches!(scan.peek(), Some(b'\r' | b'\n' | b'#')) {
                return Err(UNSUPPORTED);
            }
            let mut table = &mut root;
            for key in &active {
                table = table.child(key, false)?;
            }
            table.insert(&keys, scan.next_value(0)?)?;
        }
        scan.skip(|byte| matches!(byte, b' ' | b'\t' | b'\r'));
        if scan.take(b'#') {
            scan.skip(|byte| byte != b'\n');
        }
        if scan.peek().is_some() {
            scan.require(b'\n')?;
        }
    }
}

static YAML_LINE: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"^([a-z][a-z0-9_-]*):(?:[ \t]+(.*))?$").ok());
static YAML_BLOCK: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"^[|>][-+]?$").ok());
static YAML_LIST: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"^( +)- (.+)$").ok());
static YAML_LITERAL: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"^'(?:[^']|'')*'$").ok());
static YAML_RESERVED: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"[!&*{}\[\]]|(?:^|\s)#|:(?:\s|$)").ok());
static YAML_NUMBER: LazyLock<Option<regex::Regex>> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)^[+-]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?|\.[0-9_]+|0[xob][0-9a-f_]+|\.inf|\.nan)$").ok()
});

fn yaml_scalar(raw: &str) -> ParseResult<Value> {
    if raw.starts_with('"') {
        return json(raw);
    }
    if raw.starts_with('\'') {
        if !YAML_LITERAL
            .as_ref()
            .is_some_and(|pattern| pattern.is_match(raw))
        {
            return Err(UNSUPPORTED);
        }
        return Ok(Value::String(raw[1..raw.len() - 1].replace("''", "'")));
    }
    if YAML_RESERVED
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(raw))
    {
        return Err(UNSUPPORTED);
    }
    let lowercase = raw.to_ascii_lowercase();
    if matches!(lowercase.as_str(), "true" | "false" | "null") {
        return json(&lowercase);
    }
    if raw == "~" {
        return Ok(Value::Null);
    }
    if YAML_NUMBER
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(raw))
    {
        return json(raw).and_then(|value| value.is_number().then_some(value).ok_or(UNSUPPORTED));
    }
    Ok(Value::String(raw.to_owned()))
}

pub fn frontmatter(text: &str) -> ParseResult<Value> {
    let text = text.replace("\r\n", "\n");
    let inner = text
        .strip_prefix("---\n")
        .and_then(|text| text.strip_suffix("\n---"))
        .or_else(|| (text == "---\n---").then_some(""))
        .ok_or(UNSUPPORTED)?;
    let mut lines = inner.split('\n').peekable();
    let mut entries = Map::new();
    while let Some(line) = lines.next() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let matched = YAML_LINE
            .as_ref()
            .and_then(|pattern| pattern.captures(line))
            .ok_or(UNSUPPORTED)?;
        let key = matched.get(1).ok_or(UNSUPPORTED)?.as_str();
        let raw = matched.get(2).map_or("", |capture| capture.as_str());
        if entries.contains_key(key) {
            return Err(DUPLICATE);
        }
        let value = if YAML_BLOCK
            .as_ref()
            .is_some_and(|pattern| pattern.is_match(raw))
        {
            let mut parts = Vec::new();
            while lines
                .peek()
                .is_some_and(|line| line.starts_with([' ', '\t']) || line.trim().is_empty())
            {
                if let Some(line) = lines.next() {
                    parts.push(line.trim());
                }
            }
            Value::String(parts.join(" ").trim().to_owned())
        } else if raw.starts_with('[') {
            json(raw)?
        } else if raw.is_empty()
            && lines.peek().is_some_and(|line| {
                line.starts_with([' ', '\t']) && line.trim_start().starts_with("- ")
            })
        {
            let mut list = Vec::new();
            let mut indent = None;
            while lines
                .peek()
                .is_some_and(|line| line.starts_with([' ', '\t']))
            {
                let line = lines.next().ok_or(UNSUPPORTED)?;
                let captures = YAML_LIST
                    .as_ref()
                    .and_then(|pattern| pattern.captures(line))
                    .ok_or(UNSUPPORTED)?;
                let length = captures[1].len();
                if indent.is_some_and(|indent| indent != length) {
                    return Err(UNSUPPORTED);
                }
                indent = Some(length);
                if list.len() >= 64 {
                    return Err(LIMIT);
                }
                list.push(yaml_scalar(&captures[2])?);
            }
            Value::Array(list)
        } else {
            yaml_scalar(raw)?
        };
        entries.insert(key.to_owned(), value);
    }
    Ok(Value::Object(entries))
}
