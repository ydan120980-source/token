use serde_json::{Map, Value};
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub const DEFAULT_CHUNK_SIZE: usize = 65536;
pub const DEFAULT_THRESHOLD: u64 = 4 * 1024 * 1024;

const INVALID: &str = "INVALID_SAVED_JSON";

pub fn read_statistics(file: &Path, chunk_size: usize, threshold: u64) -> Result<Value, String> {
    if chunk_size < 1 || chunk_size > 1_048_576 {
        return Err("INVALID_JSON_CHUNK_SIZE".to_string());
    }
    let mut handle = File::open(file).map_err(|e| io_code(&e))?;
    let size = handle.metadata().map_err(|e| io_code(&e))?.len();
    if size < threshold {
        let mut text = String::new();
        handle.read_to_string(&mut text).map_err(|e| io_code(&e))?;
        return serde_json::from_str(&text).map_err(|_| INVALID.to_string());
    }
    let mut scanner = Scanner { handle, chunk_size, chunk: String::new(), offset: 0, ended: false, pending: Vec::new() };
    scanner.whitespace();
    let value = if scanner.peek() == Some('{') {
        Value::Object(scanner.object(true)?)
    } else {
        scanner.token(false)?
    };
    scanner.whitespace();
    if scanner.peek().is_some() {
        return Err(INVALID.to_string());
    }
    Ok(value)
}

fn io_code(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "ENOENT".to_string(),
        _ => error.raw_os_error().map(|c| c.to_string()).unwrap_or_else(|| "EIO".to_string()),
    }
}

struct Scanner {
    handle: File,
    chunk_size: usize,
    chunk: String,
    offset: usize,
    ended: bool,
    pending: Vec<u8>,
}

impl Scanner {
    fn refill(&mut self) -> bool {
        while self.offset == self.chunk.len() && !self.ended {
            let mut buffer = vec![0u8; self.chunk_size];
            let n = self.handle.read(&mut buffer).unwrap_or(0);
            if n == 0 {
                self.ended = true;
                if !self.pending.is_empty() {
                    self.chunk.push('\u{fffd}');
                    self.pending.clear();
                } else {
                    self.chunk.clear();
                }
                self.offset = 0;
                break;
            }
            self.pending.extend_from_slice(&buffer[..n]);
            let valid = match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    self.chunk = text.to_string();
                    self.pending.clear();
                    self.chunk.len()
                }
                Err(e) => {
                    let up_to = e.valid_up_to();
                    self.chunk = std::str::from_utf8(&self.pending[..up_to]).unwrap().to_string();
                    self.pending.drain(..up_to);
                    self.chunk.len()
                }
            };
            let _ = valid;
            self.offset = 0;
        }
        self.offset < self.chunk.len()
    }

    fn peek(&mut self) -> Option<char> {
        if self.refill() {
            self.chunk[self.offset..].chars().next()
        } else {
            None
        }
    }

    fn whitespace(&mut self) {
        while matches!(self.peek(), Some(' ' | '\n' | '\r' | '\t')) {
            self.offset += 1;
        }
    }

    fn require_char(&mut self, expected: char) -> Result<(), String> {
        self.whitespace();
        if self.peek() != Some(expected) {
            return Err(INVALID.to_string());
        }
        self.offset += 1;
        Ok(())
    }

    fn token(&mut self, string_only: bool) -> Result<Value, String> {
        self.whitespace();
        if string_only && self.peek() != Some('"') {
            return Err(INVALID.to_string());
        }
        let mut parts = String::new();
        let mut quoted = false;
        let mut escaped = false;
        let mut depth = 0i32;
        let mut start = self.offset;
        loop {
            if self.offset == self.chunk.len() {
                parts.push_str(&self.chunk[start..]);
                if !self.refill() {
                    break;
                }
                start = self.offset;
            }
            let ch = self.chunk[self.offset..].chars().next().unwrap();
            if !quoted && !string_only && depth == 0 && (ch == ',' || ch == '}') {
                break;
            }
            self.offset += ch.len_utf8();
            if quoted {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    quoted = false;
                    if string_only {
                        break;
                    }
                }
            } else if ch == '"' {
                quoted = true;
            } else if ch == '{' || ch == '[' {
                depth += 1;
            } else if ch == '}' || ch == ']' {
                depth -= 1;
            }
        }
        parts.push_str(&self.chunk[start..self.offset]);
        serde_json::from_str(&parts).map_err(|_| INVALID.to_string())
    }

    fn object(&mut self, root: bool) -> Result<Map<String, Value>, String> {
        self.require_char('{')?;
        let mut result = Map::new();
        self.whitespace();
        if self.peek() == Some('}') {
            self.offset += 1;
            return Ok(result);
        }
        loop {
            let key = match self.token(true)? {
                Value::String(text) => text,
                _ => return Err(INVALID.to_string()),
            };
            self.require_char(':')?;
            self.whitespace();
            let value = if root && key == "records" && self.peek() == Some('{') {
                Value::Object(self.object(false)?)
            } else {
                self.token(false)?
            };
            result.insert(key, value);
            self.whitespace();
            if self.peek() == Some('}') {
                self.offset += 1;
                return Ok(result);
            }
            self.require_char(',')?;
        }
    }
}