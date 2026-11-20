use std::cmp::Ordering;

pub enum Route {
    Native {
        package: &'static str,
        platform: &'static str,
        binary: &'static str,
        alternate: Option<&'static str>,
    },
    Node {
        package: &'static str,
        entry: &'static str,
    },
    Binary {
        binary: &'static str,
    },
    Desktop {
        publisher: &'static [&'static str],
        executable: &'static str,
    },
}

pub const AGENTS: &[&str] = &[
    "codex",
    "claude",
    "opencode",
    "mimo",
    "gemini",
    "deepseek",
    "antigravity",
    "workbuddy",
    "cursor",
    "zcode",
];

pub fn plan(agent: &str) -> Option<Route> {
    Some(match agent {
        "codex" => Route::Native {
            package: "@openai/codex",
            platform: "@openai/codex",
            binary: "codex.exe",
            alternate: None,
        },
        "claude" => Route::Native {
            package: "@anthropic-ai/claude-code",
            platform: "@anthropic-ai/claude-code-win32-",
            binary: "claude.exe",
            alternate: None,
        },
        "opencode" => Route::Native {
            package: "opencode-ai",
            platform: "opencode-windows-",
            binary: "opencode.exe",
            alternate: None,
        },
        "mimo" => Route::Native {
            package: "@mimo-ai/cli",
            platform: "@mimo-ai/mimocode-windows-",
            binary: "mimo.exe",
            alternate: Some("mimocode.exe"),
        },
        "gemini" => Route::Node {
            package: "@google/gemini-cli",
            entry: "bundle/gemini.js",
        },
        "deepseek" => Route::Node {
            package: "@deepseek-ai/dsh",
            entry: "lib/bin.js",
        },
        "antigravity" => Route::Binary { binary: "agy.exe" },
        "workbuddy" => Route::Desktop {
            publisher: &["Tencent", "腾讯"],
            executable: "WorkBuddy.exe",
        },
        "cursor" => Route::Desktop {
            publisher: &["Anysphere"],
            executable: "Cursor.exe",
        },
        "zcode" => Route::Desktop {
            publisher: &["Zhipu", "智谱"],
            executable: "ZCode.exe",
        },
        _ => return None,
    })
}

impl Route {
    pub fn package(&self) -> Option<&'static str> {
        match self {
            Self::Native { package, .. } | Self::Node { package, .. } => Some(package),
            _ => None,
        }
    }

    pub fn desktop(&self) -> bool {
        matches!(self, Self::Desktop { .. })
    }
}

pub fn version(value: &str) -> Option<&str> {
    if value.encode_utf16().count() > 120 {
        return None;
    }
    let value = value.trim();
    let value = value.strip_prefix('v').unwrap_or(value);
    let (main, pre) = value
        .split_once('-')
        .map_or((value, None), |(left, right)| (left, Some(right)));
    if pre.is_some_and(|text| {
        text.is_empty()
            || text.len() > 80
            || !text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    }) {
        return None;
    }
    let mut count = 0;
    for part in main.split('.') {
        let maximum = if count == 0 { 4 } else { 9 };
        if part.is_empty()
            || part.len() > maximum
            || !part.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        count += 1;
    }
    (3..=4).contains(&count).then_some(value)
}

fn parts(value: &str) -> ([u32; 4], Option<&str>) {
    let (main, pre) = value
        .split_once('-')
        .map_or((value, None), |(left, right)| (left, Some(right)));
    let mut result = [0; 4];
    for (dst, part) in result.iter_mut().zip(main.split('.')) {
        *dst = part.parse().unwrap_or_default();
    }
    (result, pre)
}

fn prerelease(a: &str, b: &str) -> Ordering {
    let numeric_a = !a.is_empty() && a.bytes().all(|byte| byte.is_ascii_digit());
    let numeric_b = !b.is_empty() && b.bytes().all(|byte| byte.is_ascii_digit());
    match (numeric_a, numeric_b) {
        (true, true) => {
            let a = a.trim_start_matches('0');
            let b = b.trim_start_matches('0');
            a.len().cmp(&b.len()).then_with(|| a.cmp(b))
        }
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.cmp(b),
    }
}

pub fn compare(candidate: &str, existing: &str) -> Option<Ordering> {
    let (candidate, candidate_pre) = parts(version(candidate)?);
    let (existing, existing_pre) = parts(version(existing)?);
    Some(
        candidate
            .cmp(&existing)
            .then_with(|| match (candidate_pre, existing_pre) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(a), Some(b)) => {
                    let mut at = a.split('.');
                    let mut bt = b.split('.');
                    loop {
                        let order = match (at.next(), bt.next()) {
                            (None, None) => break Ordering::Equal,
                            (Some(_), None) => Ordering::Greater,
                            (None, Some(_)) => Ordering::Less,
                            (Some(a), Some(b)) => prerelease(a, b),
                        };
                        if order != Ordering::Equal {
                            break order;
                        }
                    }
                }
            }),
    )
}
