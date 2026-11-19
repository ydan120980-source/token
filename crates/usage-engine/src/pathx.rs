// Node path.win32 semantics: the product is Windows-only, and scans compare
// folded resolved paths exactly as the JS policy does.
use std::path::Path;

pub fn is_sep(c: char) -> bool {
    c == '/' || c == '\\'
}

pub fn is_absolute(p: &str) -> bool {
    let bytes = p.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && is_sep(bytes[2] as char) {
        return true;
    }
    p.starts_with('/') || p.starts_with('\\')
}

fn split_root(p: &str) -> (String, &str) {
    let bytes = p.as_bytes();
    if p.starts_with("\\\\") || p.starts_with("//") {
        // UNC: \\server\share\
        let rest = &p[2..];
        let server_end = rest.find(is_sep).unwrap_or(rest.len());
        let after_server = &rest[server_end..];
        let share = after_server.trim_start_matches(is_sep);
        let share_end = share.find(is_sep).unwrap_or(share.len());
        let root_len = 2 + server_end + (after_server.len() - share.len()) + share_end;
        let mut root = p[..root_len].to_string();
        if !root.ends_with('\\') {
            root.push('\\');
        }
        return (root.replace('/', "\\"), &p[root_len..]);
    }
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && is_sep(bytes[2] as char) {
        return (p[..3].replace('/', "\\"), &p[3..]);
    }
    if p.starts_with('\\') || p.starts_with('/') {
        return ("\\".to_string(), &p[1..]);
    }
    (String::new(), p)
}

pub fn normalize(p: &str) -> String {
    if p.is_empty() {
        return ".".to_string();
    }
    let (root, rest) = split_root(p);
    let absolute = !root.is_empty();
    let trailing = rest.ends_with(is_sep) && !rest.is_empty();
    let mut parts: Vec<&str> = Vec::new();
    for segment in rest.split(is_sep) {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            if let Some(last) = parts.last() {
                if *last != ".." {
                    parts.pop();
                    continue;
                }
            }
            if !absolute {
                parts.push("..");
            }
            continue;
        }
        parts.push(segment);
    }
    let mut out = root.clone();
    out.push_str(&parts.join("\\"));
    if out.is_empty() {
        out = ".".to_string();
    }
    if trailing && !out.ends_with('\\') {
        out.push('\\');
    }
    out
}

pub fn join(parts: &[&str]) -> String {
    let joined: Vec<&str> = parts.iter().copied().filter(|p| !p.is_empty()).collect();
    if joined.is_empty() {
        return ".".to_string();
    }
    normalize(&joined.join("\\"))
}

pub fn dirname(p: &str) -> String {
    if p.is_empty() {
        return ".".to_string();
    }
    let (root, _) = split_root(p);
    let trimmed = p.trim_end_matches(is_sep);
    if trimmed.is_empty() {
        return if root.is_empty() { "\\".to_string() } else { root.trim_end_matches('\\').to_string() + "\\" };
    }
    match trimmed.rfind(is_sep) {
        None => {
            if root.is_empty() {
                ".".to_string()
            } else {
                root.clone()
            }
        }
        Some(at) => {
            let head = &trimmed[..at];
            if head.is_empty() {
                if root.is_empty() { "\\".to_string() } else { root.clone() }
            } else if !root.is_empty() && head.len() <= root.trim_end_matches('\\').len() {
                root.clone()
            } else {
                head.to_string()
            }
        }
    }
}

pub fn basename(p: &str) -> String {
    let trimmed = p.trim_end_matches(is_sep);
    match trimmed.rfind(is_sep) {
        Some(at) => trimmed[at + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

pub fn resolve(p: &str) -> String {
    let mut resolved = if is_absolute(p) {
        p.to_string()
    } else {
        let cwd = std::env::current_dir().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
        if p.is_empty() {
            cwd
        } else {
            format!("{cwd}\\{p}")
        }
    };
    resolved = normalize(&resolved);
    if !is_absolute(&resolved) {
        let cwd = std::env::current_dir().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
        resolved = normalize(&format!("{cwd}\\{resolved}"));
    }
    resolved
}

pub fn relative(from: &str, to: &str) -> String {
    let from = resolve(from);
    let to = resolve(to);
    if from.eq_ignore_ascii_case(&to) {
        return String::new();
    }
    let (from_root, from_rest) = split_root(&from);
    let (to_root, to_rest) = split_root(&to);
    if !from_root.eq_ignore_ascii_case(&to_root) {
        return to;
    }
    let from_parts: Vec<&str> = from_rest.split(is_sep).filter(|s| !s.is_empty()).collect();
    let to_parts: Vec<&str> = to_rest.split(is_sep).filter(|s| !s.is_empty()).collect();
    let mut common = 0;
    while common < from_parts.len() && common < to_parts.len() && from_parts[common].eq_ignore_ascii_case(to_parts[common]) {
        common += 1;
    }
    let mut out: Vec<String> = Vec::new();
    for _ in common..from_parts.len() {
        out.push("..".to_string());
    }
    out.extend(to_parts[common..].iter().map(|s| s.to_string()));
    out.join("\\")
}

pub fn std_path(p: &str) -> &Path {
    Path::new(p)
}

pub fn normalize_posix(p: &str) -> String {
    if p.is_empty() {
        return ".".to_string();
    }
    let absolute = p.starts_with('/');
    let trailing = p.ends_with('/') && p.len() > 1;
    let mut parts: Vec<&str> = Vec::new();
    for segment in p.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            if let Some(last) = parts.last() {
                if *last != ".." {
                    parts.pop();
                    continue;
                }
            }
            if !absolute {
                parts.push("..");
            }
            continue;
        }
        parts.push(segment);
    }
    let mut out = String::new();
    if absolute {
        out.push('/');
    }
    out.push_str(&parts.join("/"));
    if out.is_empty() {
        out = ".".to_string();
    }
    if trailing && !out.ends_with('/') {
        out.push('/');
    }
    out
}