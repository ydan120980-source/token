use crate::{
    account_service::AccountError,
    provider_context,
    provider_credentials::normalize_credential,
    provider_http::{request_failure, ProviderHttp, ProviderHttpError},
    provider_observation::ObservationError,
    provider_vault::{wipe, Secret},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{RequestBuilder, Url};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{json, Value};
use std::{fmt::Write, time::Duration};
use tokio::time::Instant;
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

const MAX_REPLY: usize = 512 * 1024;
const CONSOLE: &str = "https://opencode.ai/console";
const CONSOLE_CLIENT: &str = "opencode-cli";
const ZCODE: &str = "https://zcode.z.ai";

struct Reply(Value);

impl Drop for Reply {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

fn http_error(error: ProviderHttpError) -> AccountError {
    AccountError::Observation(ObservationError::from(error))
}

async fn response(request: RequestBuilder, permit_pending: bool) -> Result<Reply, AccountError> {
    use ProviderHttpError::*;
    let mut response = request
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| http_error(request_failure(error)))?;
    match response.status().as_u16() {
        200 => {}
        400 if permit_pending => {}
        401 => return Err(http_error(AuthRequired)),
        403 => return Err(http_error(AccessDenied)),
        429 => return Err(http_error(RateLimited)),
        300..=399 => return Err(http_error(RedirectRejected)),
        _ => return Err(http_error(RequestFailed)),
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_REPLY as u64)
    {
        return Err(http_error(OutputLimit));
    }
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| http_error(request_failure(error)))?
    {
        if chunk.len() > MAX_REPLY - bytes.len() {
            return Err(http_error(OutputLimit));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map(Reply)
        .map_err(|_| AccountError::Response)
}

fn authorize_url(raw: &Value, console: bool) -> Result<Url, AccountError> {
    let raw = raw
        .as_str()
        .filter(|url| url.len() <= 16_384)
        .ok_or(AccountError::Response)?;
    let url = if console {
        Url::parse("https://opencode.ai/console/").and_then(|base| base.join(raw))
    } else {
        Url::parse(raw)
    }
    .map_err(|_| AccountError::Response)?;
    let allowed = if console {
        url.host_str() == Some("opencode.ai") && url.path().starts_with("/console/")
    } else {
        matches!(
            url.host_str(),
            Some("zcode.z.ai" | "open.bigmodel.cn" | "bigmodel.cn" | "z.ai" | "chat.z.ai")
        )
    };
    if !allowed
        || url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AccountError::Response);
    }
    Ok(url)
}

fn seconds(value: &Value, min_ms: u64, max_ms: u64) -> Option<Duration> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.)
        .map(|n| Duration::from_millis((n * 1000.).clamp(min_ms as f64, max_ms as f64) as u64))
}

async fn next_poll(deadline: Instant, interval: Duration) -> Result<(), AccountError> {
    tokio::time::sleep_until((Instant::now() + interval).min(deadline)).await;
    if Instant::now() >= deadline {
        return Err(AccountError::LoginTimeout);
    }
    Ok(())
}

pub async fn login(
    http: &ProviderHttp,
    adapter: &str,
    open: impl FnOnce(Url) -> Result<(), AccountError>,
) -> Result<Secret, AccountError> {
    match adapter {
        "opencode-zen" => console(http, open).await,
        "zcode-device" => zcode(http, open).await,
        _ => Err(AccountError::Action),
    }
}

async fn console(
    http: &ProviderHttp,
    open: impl FnOnce(Url) -> Result<(), AccountError>,
) -> Result<Secret, AccountError> {
    let init = response(
        http.client
            .post(format!("{CONSOLE}/auth/device/code"))
            .header("User-Agent", "AgentUsage-Quota/1")
            .json(&json!({"client_id":CONSOLE_CLIENT,"supports_org_scope":true})),
        false,
    )
    .await?;
    let code = init.0["device_code"]
        .as_str()
        .and_then(|value| normalize_credential("opencode-zen", value))
        .map(Zeroizing::new)
        .ok_or(AccountError::Response)?;
    let ttl = seconds(&init.0["expires_in"], 1, 300_000).ok_or(AccountError::Response)?;
    let mut interval = seconds(&init.0["interval"], 1000, 30_000).ok_or(AccountError::Response)?;
    let deadline = Instant::now() + ttl;
    open(authorize_url(&init.0["verification_uri_complete"], true)?)?;
    drop(init);
    loop {
        next_poll(deadline, interval).await?;
        #[derive(serde::Serialize)]
        struct Poll<'a> {
            grant_type: &'static str,
            device_code: &'a str,
            client_id: &'static str,
        }
        let token = tokio::time::timeout_at(
            deadline,
            response(
                http.client
                    .post(format!("{CONSOLE}/auth/device/token"))
                    .header("User-Agent", "AgentUsage-Quota/1")
                    .json(&Poll {
                        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                        device_code: &code,
                        client_id: CONSOLE_CLIENT,
                    }),
                true,
            ),
        )
        .await
        .map_err(|_| AccountError::LoginTimeout)??;
        match token.0["error"].as_str() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval = (interval + Duration::from_secs(5)).min(Duration::from_secs(30));
                continue;
            }
            Some(_) => return Err(AccountError::LoginFailed),
            None => {}
        }
        let access = token.0["access_token"]
            .as_str()
            .filter(|value| normalize_credential("opencode-zen", value).is_some())
            .ok_or(AccountError::Response)?;
        let orgs;
        let org_id = if let Some(org) = token.0.get("org_id").filter(|org| !org.is_null()) {
            org.as_str().ok_or(AccountError::Response)?
        } else {
            orgs = response(
                http.client
                    .get(format!("{CONSOLE}/api/orgs"))
                    .header("User-Agent", "AgentUsage-Quota/1")
                    .bearer_auth(access),
                false,
            )
            .await?;
            let list = orgs
                .0
                .as_array()
                .filter(|list| list.len() <= 100)
                .ok_or(AccountError::Response)?;
            if list.len() != 1 {
                return Err(AccountError::Observation(
                    ObservationError::OrganizationRequired,
                ));
            }
            list[0]["id"].as_str().ok_or(AccountError::Response)?
        };
        return console_secret(&token.0, org_id);
    }
}

fn console_secret(raw: &Value, org: &str) -> Result<Secret, AccountError> {
    let expiry = raw["expires_in"]
        .as_f64()
        .filter(|value| (1. ..=2_678_400.).contains(value) && value.fract() == 0.)
        .ok_or(AccountError::Response)? as i64;
    let at = iso_from_ms(now_ms().saturating_add(expiry * 1000));
    let context = json!({
        "console":{"orgId":org}, "deviceGrant":true,
        "oauth":{"clientId":CONSOLE_CLIENT,"refreshToken":raw["refresh_token"],"expiresAt":at}
    });
    Secret::new(
        "opencode-zen",
        raw["access_token"].as_str().ok_or(AccountError::Response)?,
        context,
        Some(at),
    )
    .map_err(|_| AccountError::Response)
}

fn zcode_request(request: RequestBuilder, secret: &str) -> RequestBuilder {
    request
        .bearer_auth(secret)
        .header("User-Agent", "ZCode/3.14.3")
        .header("X-ZCode-App-Version", "3.14.3")
        .header("HTTP-Referer", ZCODE)
        .header("X-Platform", "win32")
}

async fn zcode(
    http: &ProviderHttp,
    open: impl FnOnce(Url) -> Result<(), AccountError>,
) -> Result<Secret, AccountError> {
    let mut random = Zeroizing::new([0_u8; 32]);
    SystemRandom::new()
        .fill(random.as_mut())
        .map_err(|_| AccountError::LoginFailed)?;
    let mut secret = Zeroizing::new(String::with_capacity(64));
    for byte in random.iter() {
        write!(&mut *secret, "{byte:02x}").map_err(|_| AccountError::LoginFailed)?;
    }
    let init = response(
        zcode_request(
            http.client.post(format!("{ZCODE}/api/v1/oauth/cli/init")),
            &secret,
        )
        .json(&json!({"provider":"bigmodel"})),
        false,
    )
    .await?;
    let flow = &init.0["data"];
    let flow_id = flow["flow_id"]
        .as_str()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 256
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
        .filter(|_| init.0["code"] == 0)
        .ok_or(AccountError::Response)?;
    let interval =
        seconds(&flow["poll_interval_sec"], 1000, 10_000).unwrap_or(Duration::from_secs(2));
    let remaining = flow["expires_at"]
        .as_f64()
        .map_or(300_000., |expires| expires * 1000. - now_ms() as f64)
        .clamp(0., 300_000.) as u64;
    if remaining == 0 {
        return Err(AccountError::LoginTimeout);
    }
    let deadline = Instant::now() + Duration::from_millis(remaining);
    open(authorize_url(&flow["authorize_url"], false)?)?;
    let endpoint = format!("{ZCODE}/api/v1/oauth/cli/poll/{flow_id}");
    drop(init);
    loop {
        next_poll(deadline, interval).await?;
        let result = tokio::time::timeout_at(
            deadline,
            response(zcode_request(http.client.get(&endpoint), &secret), false),
        )
        .await
        .map_err(|_| AccountError::LoginTimeout)??;
        if result.0["code"] != 0 {
            return Err(AccountError::Response);
        }
        let data = &result.0["data"];
        match data["status"].as_str() {
            Some("pending") => continue,
            Some("failed") => return Err(AccountError::LoginFailed),
            Some("ready") => return zcode_secret(data),
            _ => return Err(AccountError::Response),
        }
    }
}

fn zcode_secret(data: &Value) -> Result<Secret, AccountError> {
    let token = data["token"]
        .as_str()
        .filter(|token| {
            (8..=16384).contains(&token.len())
                && token
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        })
        .ok_or(AccountError::Response)?;
    let context = json!({"userId": data["user"]["user_id"].as_str().or_else(|| data["user"]["id"].as_str()),
        "deviceMid":uuid::Uuid::new_v4().to_string()});
    if provider_context::zcode_account(&context).is_none() {
        return Err(AccountError::Response);
    }
    let expiry = token
        .split('.')
        .nth(1)
        .and_then(|body| URL_SAFE_NO_PAD.decode(body).ok())
        .map(Zeroizing::new)
        .and_then(|body| serde_json::from_slice::<Value>(&body).ok())
        .and_then(|mut body| {
            let at = body["exp"]
                .as_i64()
                .filter(|exp| (1..8_640_000_000_000).contains(exp));
            wipe(&mut body);
            at
        })
        .map(|at| at * 1000);
    if expiry.is_some_and(|at| at <= now_ms()) {
        return Err(AccountError::AuthRequired);
    }
    Secret::new(
        "zcode-device",
        token,
        json!({"zcode":context}),
        expiry.map(iso_from_ms),
    )
    .map_err(|_| AccountError::Response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_links_and_grants_are_scoped() -> Result<(), AccountError> {
        let url = authorize_url(&json!("/console/device?code=sample"), true)?;
        assert_eq!(
            url.as_str(),
            "https://opencode.ai/console/device?code=sample"
        );
        assert!(authorize_url(
            &json!("https://opencode.ai.example.test/console/device"),
            true
        )
        .is_err());
        assert!(authorize_url(&json!("https://bigmodel.cn.example.test"), false).is_err());
        assert!(authorize_url(&json!("https://zcode.z.ai:444"), false).is_err());
        let secret = console_secret(
            &json!({
                "access_token":"synthetic-access","refresh_token":"synthetic-renew","expires_in":300
            }),
            "org_fixture",
        )?;
        assert!(secret.can_renew("opencode-zen"));
        assert!(zcode_secret(&json!({"token":"synthetic-token","user":{"id":"fixture"}})).is_ok());
        assert!(
            zcode_secret(&json!({"token":"synthetic-token","user":{"id":"bad subject"}})).is_err()
        );
        Ok(())
    }
}
