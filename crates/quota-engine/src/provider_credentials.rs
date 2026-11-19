use crate::provider_catalog::routes;

fn token_code(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"_!#$%&'*+.^`|~-".contains(&byte)
}

/// Normalize only the credential supplied by the caller for a catalog route.
pub fn normalize_credential(adapter: &str, value: &str) -> Option<String> {
    let route = routes().ok()?.get(adapter)?;
    if !(8..=16384).contains(&value.len())
        || !value.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
    {
        return None;
    }
    if route["kind"] != "cookie" {
        return (!value.contains(' ')).then(|| value.to_owned());
    }
    let provider = route["provider"].as_str()?;
    let (required, allowed): (&[&str], Option<&[&str]>) = match provider {
        "mimo" => (
            &["api-platform_serviceToken", "userId"],
            Some(&[
                "api-platform_serviceToken",
                "userId",
                "api-platform_ph",
                "api-platform_slh",
            ]),
        ),
        "claude" => (&["sessionKey"], Some(&["sessionKey"])),
        "opencode" => (
            &[],
            Some(&["auth", "__Host-auth", "__Host-console_session"]),
        ),
        "workbuddy" | "gemini" => (&[], None),
        _ => (
            &[],
            Some(&[
                "WorkosCursorSessionToken",
                "__Secure-next-auth.session-token",
                "next-auth.session-token",
            ]),
        ),
    };
    let value = if value
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("Cookie:"))
    {
        value[7..].trim_start()
    } else {
        value
    };
    let mut selected = Vec::new();
    for part in value.split(';') {
        let Some((name, token)) = part.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let token = token.trim();
        let allowed = allowed.map_or_else(
            || (1..=100).contains(&name.len()) && name.bytes().all(token_code),
            |names| names.contains(&name),
        );
        if !allowed {
            continue;
        }
        if token.is_empty()
            || token.bytes().any(|byte| b" ;,\"\\".contains(&byte))
            || selected.iter().any(|(existing, _)| *existing == name)
        {
            return None;
        }
        selected.push((name, token));
        if selected.len() > 64 {
            return None;
        }
    }
    if selected.is_empty()
        || provider == "cursor" && selected.len() != 1
        || required
            .iter()
            .any(|required| !selected.iter().any(|(name, _)| name == required))
    {
        return None;
    }
    Some(
        selected
            .into_iter()
            .map(|(name, token)| format!("{name}={token}"))
            .collect::<Vec<_>>()
            .join("; "),
    )
}
