use crate::{
    account_cache::{read_bounded, valid_id, SECRET_LIMIT},
    dpapi,
    provider_antigravity_cli::{profile_access_token, ADAPTER as AGY, PROFILE_CONTEXT},
    provider_catalog::routes,
    provider_context as context,
    provider_credentials::normalize_credential,
    resource_state::date_millis,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fmt, path::Path};
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    Read,
    Decrypt,
    Record,
    Encrypt,
    Verify,
}

impl VaultError {
    pub fn stage(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Decrypt => "decrypt",
            Self::Record => "record",
            Self::Encrypt => "encrypt",
            Self::Verify => "verify",
        }
    }
}

impl fmt::Display for VaultError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PROVIDER_SECRET_STORAGE_FAILED")
    }
}
impl std::error::Error for VaultError {}

pub struct Secret {
    pub credential: Zeroizing<String>,
    pub context: Value,
    pub expires_at: Option<String>,
}

impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.context);
    }
}

pub(crate) fn wipe(value: &mut Value) {
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(items) => items.iter_mut().for_each(wipe),
        Value::Object(object) => object.values_mut().for_each(wipe),
        _ => {}
    }
}

impl Secret {
    pub fn new(
        adapter: &str,
        credential: &str,
        mut context: Value,
        expires_at: Option<String>,
    ) -> Result<Self, VaultError> {
        let Some(token) = normalize_credential(adapter, credential) else {
            wipe(&mut context);
            return Err(VaultError::Record);
        };
        let secret = Self {
            credential: Zeroizing::new(token),
            context,
            expires_at,
        };
        valid_secret(adapter, &secret)?;
        Ok(secret)
    }

    pub fn expired(&self, now: i64) -> bool {
        self.expires_at
            .as_ref()
            .is_some_and(|at| date_millis(&Value::String(at.to_owned())).is_none_or(|at| at <= now))
    }

    pub fn can_renew(&self, adapter: &str) -> bool {
        match adapter {
            "claude-oauth" | "gemini-code-assist" => {
                self.context.get("clientHome").is_some() && valid_oauth(&self.context["oauth"])
            }
            "opencode-zen" => {
                self.context["deviceGrant"] == true && valid_context(&self.context, adapter)
            }
            _ => false,
        }
    }

    pub fn needs_renewal(&self, adapter: &str, now: i64) -> bool {
        self.can_renew(adapter)
            && (self.expired(now.saturating_add(60_000))
                || date_millis(&self.context["oauth"]["expiresAt"])
                    .is_some_and(|at| at <= now.saturating_add(60_000)))
    }
}

fn valid_secret(adapter: &str, secret: &Secret) -> Result<(), VaultError> {
    if routes()
        .ok()
        .and_then(|routes| routes.get(adapter))
        .is_none_or(|route| route["kind"] == "passive")
        || !valid_context(&secret.context, adapter)
        || (secret.context.get(PROFILE_CONTEXT).is_some()
            && profile_access_token(&secret.context[PROFILE_CONTEXT])
                != Some(secret.credential.as_str()))
        || secret
            .expires_at
            .as_ref()
            .is_some_and(|at| date_millis(&Value::String(at.to_owned())).is_none())
    {
        return Err(VaultError::Record);
    }
    Ok(())
}

fn visible(value: &Value, min: usize, max: usize, low: u8) -> bool {
    value.as_str().is_some_and(|text| {
        (min..=max).contains(&text.len()) && text.bytes().all(|byte| (low..=0x7e).contains(&byte))
    })
}

fn valid_context(value: &Value, adapter: &str) -> bool {
    if value.is_null() {
        return true;
    }
    if value.is_string() {
        return context::google_project(value).is_some();
    }
    let Some(map) = value.as_object() else {
        return false;
    };
    if map.keys().any(|key| {
        !matches!(
            key.as_str(),
            "userAgent"
                | "organization"
                | "workspace"
                | "discover"
                | "clientHome"
                | "oauth"
                | "desktop"
                | "cursor"
                | "zcode"
                | "console"
                | "deviceGrant"
                | PROFILE_CONTEXT
        )
    }) {
        return false;
    }
    for (key, entry) in map {
        let valid = match key.as_str() {
            "userAgent" => visible(entry, 0, 512, 0x20),
            "organization" => context::organization(entry).is_some(),
            "workspace" => context::workspace(entry).is_some(),
            "discover" => entry == true,
            "clientHome" => entry.as_str().is_some_and(valid_id),
            PROFILE_CONTEXT => adapter == AGY && profile_access_token(entry).is_some(),
            "desktop" => context::workbuddy_account(entry).is_some(),
            "cursor" => context::cursor_subject(entry).is_some(),
            "zcode" => context::zcode_account(entry).is_some(),
            "console" => context::console_organization(entry).is_some(),
            "deviceGrant" => {
                adapter == "opencode-zen"
                    && entry == true
                    && value.get("console").is_some()
                    && value["oauth"]["clientId"] == "opencode-cli"
                    && value["oauth"].get("clientSecret").is_none()
            }
            "oauth" => {
                (value.get("clientHome").is_some() || value["deviceGrant"] == true)
                    && valid_oauth(entry)
            }
            _ => false,
        };
        if !valid {
            return false;
        }
    }
    true
}

fn valid_oauth(grant: &Value) -> bool {
    grant.as_object().is_some_and(|entry| {
        entry.keys().all(|key| {
            matches!(
                key.as_str(),
                "clientId" | "clientSecret" | "refreshToken" | "expiresAt"
            )
        })
    }) && grant["clientId"].as_str().is_some_and(|id| {
        (8..=256).contains(&id.len())
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
    }) && visible(&grant["refreshToken"], 8, 16_384, 0x21)
        && grant
            .get("clientSecret")
            .is_none_or(|token| visible(token, 8, 256, 0x21))
        && date_millis(&grant["expiresAt"]).is_some()
}

fn purpose(id: &str, adapter: &str) -> String {
    format!("QuotaDock ProviderSecretV2\0{id}\0{adapter}")
}

pub fn seal(id: &str, adapter: &str, secret: &Secret) -> Result<Vec<u8>, VaultError> {
    if !valid_id(id) {
        return Err(VaultError::Record);
    }
    valid_secret(adapter, secret)?;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Record<'a> {
        schema_version: &'static str,
        id: &'a str,
        adapter: &'a str,
        credential: &'a str,
        expires_at: Option<&'a str>,
        context: &'a Value,
    }
    let bytes = Zeroizing::new(
        serde_json::to_vec(&Record {
            schema_version: "ProviderSecretV2",
            id,
            adapter,
            credential: secret.credential.as_str(),
            expires_at: secret.expires_at.as_deref(),
            context: &secret.context,
        })
        .map_err(|_| VaultError::Record)?,
    );
    let purpose = purpose(id, adapter);
    let sealed =
        dpapi::protect(bytes.as_ref(), purpose.as_bytes()).map_err(|_| VaultError::Encrypt)?;
    if sealed.len() > SECRET_LIMIT {
        return Err(VaultError::Encrypt);
    }
    let verified = dpapi::unprotect(&sealed, purpose.as_bytes()).map_err(|_| VaultError::Verify)?;
    if verified.as_ref() != bytes.as_slice() {
        return Err(VaultError::Verify);
    }
    Ok(sealed)
}

pub fn open(id: &str, adapter: &str, sealed: &[u8]) -> Result<Secret, VaultError> {
    if !valid_id(id) || sealed.is_empty() || sealed.len() > SECRET_LIMIT {
        return Err(VaultError::Record);
    }
    let plain = dpapi::unprotect(sealed, purpose(id, adapter).as_bytes())
        .map_err(|_| VaultError::Decrypt)?;
    decode(id, adapter, plain.as_ref())
}

fn decode(id: &str, adapter: &str, plaintext: &[u8]) -> Result<Secret, VaultError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Header<'a> {
        schema_version: &'a str,
        id: &'a str,
        adapter: &'a str,
    }
    let record: Header = serde_json::from_slice(plaintext).map_err(|_| VaultError::Record)?;
    if record.id != id
        || record.adapter != adapter
        || !(record.schema_version == "ProviderSecretV2"
            || record.schema_version == "ProviderWebsiteSecretV1"
                && routes()
                    .ok()
                    .and_then(|routes| routes.get(adapter))
                    .is_some_and(|route| route["websiteLogin"] == true))
    {
        return Err(VaultError::Record);
    }
    let mut value: Value = serde_json::from_slice(plaintext).map_err(|_| VaultError::Record)?;
    let outcome = (|| {
        let expires_at = match value.get("expiresAt") {
            Some(Value::Null) => None,
            Some(Value::String(text)) => Some(text.to_owned()),
            _ => return Err(VaultError::Record),
        };
        let context = value
            .get_mut("context")
            .map(Value::take)
            .unwrap_or_default();
        let token = value["credential"].as_str().unwrap_or_default();
        Secret::new(adapter, token, context, expires_at)
    })();
    wipe(&mut value);
    outcome
}

/// Reads only a selected QuotaDock Electron profile, never a browser profile.
pub fn import_legacy(
    profile: &Path,
    id: &str,
    adapter: &str,
) -> Result<Option<Secret>, VaultError> {
    if !valid_id(id) {
        return Err(VaultError::Record);
    }
    let file = profile
        .join("provider-quotas/website-secrets")
        .join(format!("{id}.bin"));
    let Some(bytes) = read_bounded(&file, SECRET_LIMIT).map_err(|_| VaultError::Read)? else {
        return Ok(None);
    };
    if let Some(v10) = bytes.strip_prefix(b"v10") {
        let state = read_bounded(&profile.join("Local State"), 1024 * 1024)
            .map_err(|_| VaultError::Read)?
            .ok_or(VaultError::Decrypt)?;
        let state: Value = serde_json::from_slice(&state).map_err(|_| VaultError::Record)?;
        let wire = STANDARD
            .decode(
                state["os_crypt"]["encrypted_key"]
                    .as_str()
                    .ok_or(VaultError::Decrypt)?,
            )
            .map_err(|_| VaultError::Decrypt)?;
        let protected = wire.strip_prefix(b"DPAPI").ok_or(VaultError::Decrypt)?;
        let raw_key = dpapi::unprotect(protected, &[]).map_err(|_| VaultError::Decrypt)?;
        let key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, raw_key.as_ref()).map_err(|_| VaultError::Decrypt)?,
        );
        let (nonce, encrypted) = v10.split_at_checked(12).ok_or(VaultError::Decrypt)?;
        let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| VaultError::Decrypt)?;
        let mut encrypted = Zeroizing::new(encrypted.to_vec());
        let plain = key
            .open_in_place(nonce, Aad::empty(), encrypted.as_mut_slice())
            .map_err(|_| VaultError::Decrypt)?;
        decode(id, adapter, plain).map(Some)
    } else {
        let plain = dpapi::unprotect(&bytes, &[]).map_err(|_| VaultError::Decrypt)?;
        decode(id, adapter, plain.as_ref()).map(Some)
    }
}
