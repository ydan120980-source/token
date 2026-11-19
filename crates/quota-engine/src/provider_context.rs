use serde_json::Value;

fn matching<'a>(value: &'a Value, maximum: usize, punctuation: &[u8]) -> Option<&'a str> {
    value.as_str().filter(|text| {
        (1..=maximum).contains(&text.len())
            && text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || punctuation.contains(&byte))
    })
}

pub(crate) fn workspace(value: &Value) -> Option<&str> {
    let id = matching(value, 104, b"_-")?;
    let suffix = id
        .strip_prefix("wrk_")
        .or_else(|| id.strip_prefix("org_"))?;
    (!suffix.is_empty()).then_some(id)
}

pub(crate) fn organization(value: &Value) -> Option<&str> {
    value.as_str().filter(|value| valid_organization(value))
}

pub(crate) fn valid_organization(text: &str) -> bool {
    text.len() == 36
        && text
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

pub(crate) fn google_project(value: &Value) -> Option<&str> {
    let text = value.as_str()?;
    let bytes = text.as_bytes();
    ((6..=100).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-'))
    .then_some(text)
}

pub(crate) fn console_organization(value: &Value) -> Option<&str> {
    (value.as_object()?.len() == 1)
        .then(|| workspace(&value["orgId"]))
        .flatten()
}

pub(crate) fn cursor_subject(value: &Value) -> Option<&str> {
    if value.as_object()?.len() != 1 {
        return None;
    }
    matching(&value["subject"], 256, b"._-")
}

pub(crate) fn zcode_account(value: &Value) -> Option<(&str, &str)> {
    let device = organization(&value["deviceMid"])?;
    if value.as_object()?.len() != 2 || device.bytes().any(|byte| byte.is_ascii_uppercase()) {
        return None;
    }
    Some((matching(&value["userId"], 256, b"._|@-")?, device))
}

pub(crate) fn workbuddy_account(value: &Value) -> Option<(&str, &str, Option<&str>)> {
    if value
        .as_object()?
        .keys()
        .any(|key| !matches!(key.as_str(), "uid" | "enterpriseId" | "domain"))
    {
        return None;
    }
    let uid = visible_ascii(&value["uid"])?;
    let domain = value["domain"].as_str().filter(|domain| {
        matches!(
            *domain,
            "" | "copilot.tencent.com"
                | "www.codebuddy.cn"
                | "codebuddy.cn"
                | "www.workbuddy.cn"
                | "workbuddy.cn"
        )
    })?;
    let enterprise = match value.get("enterpriseId") {
        Some(value) => Some(visible_ascii(value)?),
        None => None,
    };
    Some((uid, domain, enterprise))
}

fn visible_ascii(value: &Value) -> Option<&str> {
    value.as_str().filter(|text| {
        (1..=256).contains(&text.len()) && text.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    })
}
