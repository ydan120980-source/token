use crate::{
    provider_catalog::routes, provider_context as context,
    provider_credentials::normalize_credential,
};
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::Value;
use sha2::Sha256;
use std::{collections::HashMap, fmt};
use usage_engine::normalize::truthy;
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug)]
pub struct IdentityKeyUnavailable;

impl fmt::Display for IdentityKeyUnavailable {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PROVIDER_IDENTITY_KEY_UNAVAILABLE")
    }
}

impl std::error::Error for IdentityKeyUnavailable {}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityView<'a> {
    pub identity_status: &'static str,
    pub duplicate_known: bool,
    pub duplicate_account_ids: Vec<&'a str>,
}

struct Entry {
    digest: [u8; 32],
    status: &'static str,
}

impl Drop for Entry {
    fn drop(&mut self) {
        self.digest.zeroize();
    }
}

/// Owns only session-local evidence. Submit an observation after publishing
/// a successful quota result for the same account and credential generation.
pub struct ConnectionIdentities {
    key: Option<Zeroizing<[u8; 32]>>,
    entries: HashMap<String, Entry>,
}

impl ConnectionIdentities {
    pub fn new() -> Result<Self, IdentityKeyUnavailable> {
        let mut key = Zeroizing::new([0; 32]);
        getrandom::fill(key.as_mut()).map_err(|_| IdentityKeyUnavailable)?;
        Ok(Self {
            key: Some(key),
            entries: HashMap::new(),
        })
    }

    pub fn forget(&mut self, id: &str) {
        self.entries.remove(id);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.key = None;
    }

    pub fn observe(&mut self, id: &str, adapter: &str, credential: &str, scope: &Value) {
        self.forget(id);
        let Some(key) = &self.key else { return };
        let Some(entry) = derive_entry(key, adapter, credential, scope) else {
            return;
        };
        self.entries.insert(id.to_owned(), entry);
    }

    pub fn view(&self, id: &str) -> IdentityView<'_> {
        let entry = self.entries.get(id);
        let mut duplicates = Vec::new();
        if let Some(entry) = entry {
            duplicates.extend(self.entries.iter().filter_map(|(other, candidate)| {
                (other != id && candidate.digest == entry.digest).then_some(other.as_str())
            }));
            duplicates
                .sort_unstable_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
        }
        IdentityView {
            identity_status: entry.map_or("unknown", |entry| entry.status),
            duplicate_known: !duplicates.is_empty(),
            duplicate_account_ids: duplicates,
        }
    }
}

fn derive_entry(key: &[u8; 32], adapter: &str, credential: &str, scope: &Value) -> Option<Entry> {
    let route = routes().ok()?.get(adapter)?;
    let kind = route["kind"].as_str().unwrap_or("http");
    if matches!(kind, "passive" | "local-report") {
        return None;
    }
    let token = Zeroizing::new(normalize_credential(adapter, credential)?);
    let mut sorted_cookie = Zeroizing::new(String::new());
    let (status, evidence) = match adapter {
        "workbuddy-desktop" => {
            let (uid, domain, enterprise) = context::workbuddy_account(&scope["desktop"])?;
            ("client-bound", vec![Some(uid), Some(domain), enterprise])
        }
        "zcode-device" => (
            "server-reported",
            vec![Some(context::zcode_account(&scope["zcode"])?.0)],
        ),
        "cursor-web" if truthy(&scope["cursor"]) => (
            "client-bound",
            vec![Some(context::cursor_subject(&scope["cursor"])?)],
        ),
        _ => {
            let scope = match adapter {
                "claude-web" => Some(context::organization(&scope["organization"])?),
                "opencode-web" => Some(context::workspace(&scope["workspace"])?),
                "opencode-zen" => Some(context::console_organization(&scope["console"])?),
                "gemini-code-assist" => Some(context::google_project(scope)?),
                _ => None,
            };
            let token = if kind == "cookie" {
                let mut cookies: Vec<_> = token.split("; ").collect();
                cookies.sort_unstable();
                *sorted_cookie = cookies.join("; ");
                sorted_cookie.as_str()
            } else {
                token.as_str()
            };
            ("credential-match", vec![Some(token), scope])
        }
    };
    let wire = Zeroizing::new(serde_json::to_vec(&(adapter, status, evidence)).ok()?);
    let mut mac = Hmac::<Sha256>::new_from_slice(key).ok()?;
    mac.update(wire.as_ref());
    let digest = mac.finalize().into_bytes().into();
    Some(Entry { digest, status })
}
