use crate::{provider_http::ProviderHttp, provider_vault::wipe};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header, Method, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use usage_engine::time::now_ms;
use zeroize::{Zeroize, Zeroizing};

const API: &str = "https://api.github.com";
const GITHUB: &str = "https://github.com";
pub const DEVICE_PAGE: &str = "https://github.com/login/device";
const UPDATES: &str = "https://github.com/ydan120980-source/token/releases/";
const MAX_BODY: usize = 4 * 1024 * 1024;
const FAILED: &str = "GITHUB_REQUEST_FAILED";
pub const AUTH_REQUIRED: &str = "GITHUB_AUTH_REQUIRED";
pub const REPOSITORY_INVALID: &str = "GITHUB_REPOSITORY_INVALID";
pub type Result<T> = std::result::Result<T, &'static str>;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

impl Drop for Token {
    fn drop(&mut self) {
        self.token.zeroize();
        self.refresh_token.zeroize();
    }
}

pub struct Device {
    pub code: Zeroizing<String>,
    pub user_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

pub enum Poll {
    Pending,
    SlowDown,
    Authorized(Token),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub login: String,
    pub name: Option<String>,
    pub avatar: Option<String>,
}

pub struct GithubApi {
    client_id: String,
    http: ProviderHttp,
}

fn ascii(value: &str, min: usize, max: usize, extra: &[u8]) -> bool {
    (min..=max).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || extra.contains(&byte))
}

fn token(value: &str) -> bool {
    ascii(value, 8, 1024, b"_-")
}

pub fn owned_repository(repository: &str, login: &str) -> bool {
    repository.split_once('/').is_some_and(|(owner, name)| {
        ascii(owner, 1, 39, b"-")
            && owner.eq_ignore_ascii_case(login)
            && !name.starts_with('.')
            && ascii(name, 1, 100, b"_.-")
    })
}

pub fn install_url(slug: &str) -> Option<String> {
    ((1..=100).contains(&slug.len())
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
    .then(|| format!("{GITHUB}/apps/{slug}/installations/new"))
}

pub fn openable(value: &str, install: Option<&str>) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let canonical = url.as_str();
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && (matches!(
            canonical,
            DEVICE_PAGE | "https://github.com/settings/installations"
        ) || install == Some(canonical)
            || canonical.starts_with(UPDATES))
}

struct Body {
    status: u16,
    headers: header::HeaderMap,
    bytes: Zeroizing<Vec<u8>>,
}

impl Body {
    fn json(&self) -> Result<Value> {
        serde_json::from_slice(&self.bytes).map_err(|_| FAILED)
    }
}

async fn send(request: RequestBuilder, allowed: &[u16], limit: usize) -> Result<Body> {
    let mut response = request
        .timeout(Duration::from_secs(15))
        .header(header::USER_AGENT, "Agent-Usage-Quota")
        .send()
        .await
        .map_err(|_| "GITHUB_OFFLINE")?;
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    if !response.status().is_success() && !allowed.contains(&status) {
        return Err(match status {
            401 => AUTH_REQUIRED,
            429 => "GITHUB_RATE_LIMITED",
            403 if headers.contains_key("retry-after")
                || headers
                    .get("x-ratelimit-remaining")
                    .is_some_and(|h| h == "0") =>
            {
                "GITHUB_RATE_LIMITED"
            }
            403 | 404 => "GITHUB_FORBIDDEN",
            409 => "GITHUB_SYNC_CONFLICT",
            _ => FAILED,
        });
    }
    let mut bytes = Zeroizing::new(Vec::new());
    if status != 404 {
        if response
            .content_length()
            .is_some_and(|size| size > limit as u64)
        {
            return Err(FAILED);
        }
        while let Some(chunk) = response.chunk().await.map_err(|_| FAILED)? {
            if chunk.len() > limit - bytes.len() {
                return Err(FAILED);
            }
            bytes.extend_from_slice(&chunk);
        }
    }
    Ok(Body {
        status,
        headers,
        bytes,
    })
}

fn parse_token(value: &Value) -> Result<Token> {
    let access = value["access_token"]
        .as_str()
        .filter(|value| token(value))
        .ok_or(FAILED)?;
    let (expires_at, refresh_token) = if value["expires_in"].is_null() {
        (None, None)
    } else {
        let lifetime = value["expires_in"]
            .as_i64()
            .filter(|v| (1..=86_400).contains(v))
            .ok_or(FAILED)?;
        let refresh = value["refresh_token"]
            .as_str()
            .filter(|value| token(value))
            .ok_or(FAILED)?;
        (Some(now_ms() + lifetime * 1000), Some(refresh.to_owned()))
    };
    Ok(Token {
        token: access.to_owned(),
        refresh_token,
        expires_at,
    })
}

impl GithubApi {
    pub fn new(client_id: String) -> Result<Self> {
        if !ascii(&client_id, 8, 128, b"_.-") {
            return Err("GITHUB_NOT_CONFIGURED");
        }
        let http = ProviderHttp::new().map_err(|_| FAILED)?;
        Ok(Self { client_id, http })
    }

    fn api(
        &self,
        method: Method,
        path: &str,
        credential: &str,
        accept: &str,
    ) -> Result<RequestBuilder> {
        if !token(credential) {
            return Err(AUTH_REQUIRED);
        }
        Ok(self
            .http
            .client
            .request(method, format!("{API}{path}"))
            .bearer_auth(credential)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header(header::ACCEPT, accept))
    }

    async fn get(&self, path: &str, credential: &str) -> Result<Body> {
        send(
            self.api(Method::GET, path, credential, "application/json")?,
            &[],
            MAX_BODY,
        )
        .await
    }

    async fn oauth<T>(
        &self,
        path: &str,
        extra: &[(&str, &str)],
        parse: impl FnOnce(&Value) -> Result<T>,
    ) -> Result<T> {
        let mut fields = vec![("client_id", self.client_id.as_str())];
        fields.extend_from_slice(extra);
        let response = send(
            self.http
                .client
                .post(format!("{GITHUB}{path}"))
                .header(header::ACCEPT, "application/json")
                .form(&fields),
            &[400],
            64 * 1024,
        )
        .await?;
        let mut json = response.json()?;
        let result = parse(&json);
        wipe(&mut json);
        result
    }

    pub async fn start_device(&self) -> Result<Device> {
        self.oauth(
            "/login/device/code",
            &[("scope", "offline_access")],
            |row| {
                let code = row["device_code"]
                    .as_str()
                    .filter(|value| token(value))
                    .ok_or(FAILED)?;
                let user_code = row["user_code"]
                    .as_str()
                    .filter(|code| {
                        code.len() == 9
                            && code.bytes().enumerate().all(|(i, b)| {
                                if i == 4 {
                                    b == b'-'
                                } else {
                                    b.is_ascii_uppercase() || b.is_ascii_digit()
                                }
                            })
                    })
                    .ok_or(FAILED)?;
                if row["verification_uri"] != DEVICE_PAGE {
                    return Err(FAILED);
                }
                Ok(Device {
                    code: Zeroizing::new(code.to_owned()),
                    user_code: user_code.to_owned(),
                    expires_in: row["expires_in"]
                        .as_u64()
                        .filter(|n| (1..=3600).contains(n))
                        .ok_or(FAILED)?,
                    interval: row["interval"]
                        .as_u64()
                        .filter(|n| (1..=60).contains(n))
                        .ok_or(FAILED)?,
                })
            },
        )
        .await
    }

    pub async fn poll_device(&self, device: &Device) -> Result<Poll> {
        self.oauth(
            "/login/oauth/access_token",
            &[
                ("device_code", device.code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
            |row| match row["error"].as_str() {
                Some("authorization_pending") => Ok(Poll::Pending),
                Some("slow_down") => Ok(Poll::SlowDown),
                Some("access_denied") => Err("GITHUB_DENIED"),
                Some("expired_token") => Err("GITHUB_CODE_EXPIRED"),
                _ => parse_token(row).map(Poll::Authorized),
            },
        )
        .await
    }

    pub async fn refresh(&self, credential: &str) -> Result<Token> {
        if !token(credential) {
            return Err(AUTH_REQUIRED);
        }
        self.oauth(
            "/login/oauth/access_token",
            &[
                ("refresh_token", credential),
                ("grant_type", "refresh_token"),
            ],
            |row| match row["error"].as_str() {
                Some(
                    "bad_refresh_token"
                    | "invalid_grant"
                    | "expired_token"
                    | "invalid_refresh_token",
                ) => Err(AUTH_REQUIRED),
                _ => parse_token(row),
            },
        )
        .await
    }

    pub async fn user(&self, credential: &str) -> Result<User> {
        let value = self.get("/user", credential).await?.json()?;
        let login = value["login"]
            .as_str()
            .filter(|name| ascii(name, 1, 39, b"-"))
            .ok_or(FAILED)?;
        Ok(User {
            login: login.to_owned(),
            name: value["name"]
                .as_str()
                .map(|name| name.chars().take(120).collect()),
            avatar: self.avatar(&value["avatar_url"]).await,
        })
    }

    async fn avatar(&self, value: &Value) -> Option<String> {
        let mut url = Url::parse(value.as_str()?).ok()?;
        let id = url.path().strip_prefix("/u/")?;
        if url.scheme() != "https"
            || url.host_str() != Some("avatars.githubusercontent.com")
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || !ascii(id, 1, 24, b"")
            || !id.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        url.set_query(Some("s=96"));
        let response = send(
            self.http
                .client
                .get(url)
                .header(header::ACCEPT, "image/png,image/jpeg,image/webp"),
            &[],
            192 * 1024,
        )
        .await
        .ok()?;
        let mime = response.headers.get(header::CONTENT_TYPE)?.to_str().ok()?;
        (!response.bytes.is_empty() && matches!(mime, "image/png" | "image/jpeg" | "image/webp"))
            .then(|| format!("data:{mime};base64,{}", STANDARD.encode(&response.bytes)))
    }

    async fn page(
        &self,
        path: &str,
        key: &str,
        page: u16,
        credential: &str,
    ) -> Result<(Vec<Value>, bool)> {
        let response = self
            .get(&format!("{path}?per_page=100&page={page}"), credential)
            .await?;
        let next = response
            .headers
            .get(header::LINK)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(',')
                    .any(|item| item.trim_end().ends_with("rel=\"next\""))
            });
        let mut value = response.json()?;
        match value[key].take() {
            Value::Array(rows) if rows.len() <= 100 => Ok((rows, next)),
            _ => Err(FAILED),
        }
    }

    pub async fn repositories(&self, credential: &str, login: &str) -> Result<Vec<String>> {
        let mut matches = Vec::new();
        for page in 1..=100 {
            let (installs, next) = self
                .page("/user/installations", "installations", page, credential)
                .await?;
            for install in installs {
                let Some(id) = install["id"].as_u64().filter(|id| *id > 0) else {
                    continue;
                };
                if !install["suspended_at"].is_null()
                    || !same(&install["account"]["login"], login)
                    || install["permissions"]["contents"] != "write"
                {
                    continue;
                }
                for repo_page in 1..=100 {
                    let (rows, next) = self
                        .page(
                            &format!("/user/installations/{id}/repositories"),
                            "repositories",
                            repo_page,
                            credential,
                        )
                        .await?;
                    for repo in rows {
                        if !private_writable(&repo) {
                            continue;
                        }
                        if let Some(name) = repo["full_name"]
                            .as_str()
                            .filter(|name| owned_repository(name, login))
                        {
                            if !matches
                                .iter()
                                .any(|held: &String| held.eq_ignore_ascii_case(name))
                            {
                                matches.push(name.to_owned());
                                if matches.len() == 500 {
                                    return Ok(matches);
                                }
                            }
                        }
                    }
                    if !next {
                        break;
                    }
                }
            }
            if !next {
                break;
            }
        }
        Ok(matches)
    }

    pub async fn put(
        &self,
        credential: &str,
        login: &str,
        repository: &str,
        id: uuid::Uuid,
        payload: &str,
    ) -> Result<()> {
        if !owned_repository(repository, login) {
            return Err(REPOSITORY_INVALID);
        }
        let base = format!("/repos/{repository}");
        let repo = self.get(&base, credential).await?.json()?;
        if !private_writable(&repo)
            || !same(&repo["owner"]["login"], login)
            || !same(&repo["full_name"], repository)
        {
            return Err(REPOSITORY_INVALID);
        }
        let path = format!("agent-usage/{id}.json");
        let route = format!("{base}/contents/{path}");
        let previous = send(
            self.api(
                Method::GET,
                &route,
                credential,
                "application/vnd.github.object+json",
            )?,
            &[404],
            MAX_BODY,
        )
        .await?;
        let mut payload = json!({"message": "Sync Agent Usage daily totals", "content": STANDARD.encode(payload)});
        if previous.status != 404 {
            let file = previous.json()?;
            let sha = file["sha"].as_str().filter(|sha| {
                sha.len() == 40
                    && sha
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            });
            if file["type"] != "file" || file["path"] != path || sha.is_none() {
                return Err("GITHUB_SYNC_CONFLICT");
            }
            payload["sha"] = json!(sha);
        }
        send(
            self.api(Method::PUT, &route, credential, "application/json")?
                .header(header::CONTENT_TYPE, "application/json")
                .body(usage_engine::js_json::stringify(&payload)),
            &[],
            MAX_BODY,
        )
        .await?;
        Ok(())
    }
}

fn same(field: &Value, value: &str) -> bool {
    field
        .as_str()
        .is_some_and(|field| field.eq_ignore_ascii_case(value))
}

fn private_writable(row: &Value) -> bool {
    row["private"] == true
        && row["archived"] != true
        && row["disabled"] != true
        && row["permissions"]["push"] == true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_sync_targets_and_external_links_are_fixed() {
        assert!(owned_repository("Example-user/usage.data", "example-user"));
        for invalid in [
            "example-user/..",
            "example-user/a/b",
            "another-user/usage",
            "example-user/a%2fb",
        ] {
            assert!(!owned_repository(invalid, "example-user"));
        }
        assert!(openable(DEVICE_PAGE, None));
        assert!(openable(
            "https://github.com/ydan120980-source/token/releases/tag/v1",
            None
        ));
        for invalid in [
            "https://github.com/login/device/x",
            "https://login@github.com/login/device",
            "https://github.com/other/project/releases/tag/v1",
            "https://github.com.evil.invalid/login/device",
        ] {
            assert!(!openable(invalid, None));
        }
        assert!(private_writable(
            &json!({"private": true, "permissions": {"push": true}})
        ));
        assert!(!private_writable(
            &json!({"private": true, "archived": true, "permissions": {"push": true}})
        ));
        assert!(!private_writable(
            &json!({"private": false, "permissions": {"push": true}})
        ));
    }

    #[test]
    fn device_access_tokens_require_the_matching_renewal_fields() -> Result<()> {
        assert!(parse_token(&json!({"access_token":"invalid header\r\n"})).is_err());
        assert!(parse_token(&json!({"access_token":"fake-token", "expires_in": 3600})).is_err());
        let token = parse_token(
            &json!({"access_token":"fake-token", "refresh_token":"fake-refresh", "expires_in": 3600}),
        )?;
        assert!(token.expires_at.is_some_and(|expires| expires > now_ms()));
        assert_eq!(token.refresh_token.as_deref(), Some("fake-refresh"));
        Ok(())
    }
}
