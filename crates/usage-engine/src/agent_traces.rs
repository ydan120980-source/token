use crate::pathx;
use serde::Serialize;

const TRACES: &[(&str, &str, &[&str])] = &[
    ("augment", "Augment", &["~/.augment"]),
    ("codebuddy", "CodeBuddy", &["~/.codebuddy"]),
    ("factory", "Factory Droid", &["~/.factory"]),
    ("grok", "Grok CLI", &["~/.grok"]),
    ("iflow", "iFlow CLI", &["~/.iflow"]),
    ("kiro", "Kiro", &["~/.kiro", "%APPDATA%/Kiro"]),
    ("qoder", "Qoder", &["~/.qoder"]),
    (
        "roo",
        "Roo Code",
        &["%APPDATA%/Code/User/globalStorage/rooveterinaryinc.roo-cline"],
    ),
    ("trae", "Trae", &["~/.trae", "%APPDATA%/Trae"]),
    ("windsurf", "Windsurf", &["~/.codeium/windsurf"]),
];

#[derive(Clone, Copy)]
pub struct Places<'a> {
    pub home: Option<&'a str>,
    pub app_data: Option<&'a str>,
    pub local_app_data: Option<&'a str>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTrace {
    pub id: &'static str,
    pub name: &'static str,
    pub markers: Vec<&'static str>,
}

fn exists(marker: &str, places: Places<'_>) -> bool {
    let Some((prefix, tail)) = marker.split_once('/') else {
        return false;
    };
    let location = match prefix {
        "~" => places.home,
        "%APPDATA%" => places.app_data,
        "%LOCALAPPDATA%" => places.local_app_data,
        _ => None,
    };
    location
        .filter(|base| !base.is_empty())
        .is_some_and(|base| std::fs::metadata(pathx::std_path(&pathx::join(&[base, tail]))).is_ok())
}

pub fn detect(places: Places<'_>) -> Vec<AgentTrace> {
    TRACES
        .iter()
        .filter_map(|&(id, name, markers)| {
            let markers: Vec<_> = markers
                .iter()
                .copied()
                .filter(|marker| exists(marker, places))
                .collect();
            (!markers.is_empty()).then_some(AgentTrace { id, name, markers })
        })
        .collect()
}

pub fn installed(agent: &str, places: Places<'_>) -> bool {
    let markers: &[&str] = match agent {
        "codex" => &["~/.codex"],
        "claude" => &["~/.claude"],
        "opencode" => &["~/.local/share/opencode"],
        "workbuddy" => &["~/.workbuddy", "~/.workbuddy-ai"],
        "mimo" => &["~/.local/share/mimocode"],
        "gemini" => &["~/.gemini/tmp"],
        "cursor" => &["~/.cursor"],
        "zcode" => &["~/.zcode"],
        "deepseek" => &["~/.dsh"],
        "antigravity" => &[
            "~/.gemini/antigravity",
            "~/.gemini/antigravity-cli",
            "~/.gemini/antigravity-ide",
        ],
        "copilot" => &["~/.copilot"],
        "cline" => &[
            "%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev",
            "~/.cline",
        ],
        "pi" => &["~/.pi/agent"],
        "continue" => &["~/.continue"],
        "kilo" => &[
            "~/.local/share/kilo",
            "%APPDATA%/Code/User/globalStorage/kilocode.kilo-code",
        ],
        "qwen" => &["~/.qwen"],
        "kimi" => &["~/.kimi", "~/.kimi-code"],
        _ => &[],
    };
    markers.iter().any(|marker| exists(marker, places))
}
