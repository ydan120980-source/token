use crate::{
    provider_context,
    provider_credentials::normalize_credential,
    provider_http::{request_failure, ProviderHttp, ProviderHttpError},
    provider_vault::{wipe, Secret},
};
use reqwest::{header, RequestBuilder};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::watch;
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

const MAX_RESPONSE: usize = 65_536;

pub async fn renew(
    http: &ProviderHttp,
    adapter: &str,
    previous: &Secret,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<Secret, ProviderHttpError> {
    let request = prepare(http, adapter, previous)?;
    tokio::select! {
        biased;
        _ = cancellation.wait_for(|requested| *requested) => Err(ProviderHttpError::Canceled),
        result = receive(request, adapter, previous) => result,
    }
}

fn prepare(
    http: &ProviderHttp,
    adapter: &str,
    previous: &Secret,
) -> Result<RequestBuilder, ProviderHttpError> {
    let endpoint = match adapter {
        "claude-oauth" => "https://platform.claude.com/v1/oauth/token",
        "gemini-code-assist" => "https://oauth2.googleapis.com/token",
        "opencode-zen" => "https://opencode.ai/console/auth/device/token",
        _ => return Err(ProviderHttpError::ActionInvalid),
    };
    if !previous.can_renew(adapter) {
        return Err(ProviderHttpError::ActionInvalid);
    }
    let oauth = &previous.context["oauth"];
    let token = oauth["refreshToken"]
        .as_str()
        .and_then(|token| normalize_credential(adapter, token))
        .map(Zeroizing::new)
        .ok_or(ProviderHttpError::ActionInvalid)?;
    #[derive(Serialize)]
    struct Form<'a> {
        grant_type: &'static str,
        refresh_token: &'a str,
        client_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_secret: Option<&'a str>,
    }
    let form = Form {
        grant_type: "refresh_token",
        refresh_token: token.as_str(),
        client_id: oauth["clientId"]
            .as_str()
            .ok_or(ProviderHttpError::ActionInvalid)?,
        client_secret: oauth["clientSecret"].as_str(),
    };
    let request = http
        .client
        .post(endpoint)
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "AgentUsage-Quota/1");
    if adapter == "opencode-zen" {
        let body = serde_json::to_vec(&form).map_err(|_| ProviderHttpError::ActionInvalid)?;
        Ok(request
            .header(header::CONTENT_TYPE, "application/json")
            .body(body))
    } else {
        Ok(request.form(&form))
    }
}

async fn receive(
    request: RequestBuilder,
    adapter: &str,
    previous: &Secret,
) -> Result<Secret, ProviderHttpError> {
    use ProviderHttpError::*;
    let mut response = request.send().await.map_err(request_failure)?;
    match response.status().as_u16() {
        200 => {}
        400 | 401 => return Err(AuthRequired),
        429 => return Err(RateLimited),
        300..=399 => return Err(RedirectRejected),
        _ => return Err(RequestFailed),
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE as u64)
    {
        return Err(OutputLimit);
    }
    let mut body = Zeroizing::new(Vec::new());
    while let Some(bytes) = response.chunk().await.map_err(request_failure)? {
        if bytes.len() > MAX_RESPONSE - body.len() {
            return Err(OutputLimit);
        }
        body.extend_from_slice(&bytes);
    }
    let mut parsed: Value = serde_json::from_slice(&body).map_err(|_| ResponseInvalid)?;
    let result = project(adapter, previous, &parsed, now_ms());
    wipe(&mut parsed);
    result
}

fn project(
    adapter: &str,
    previous: &Secret,
    raw: &Value,
    now: i64,
) -> Result<Secret, ProviderHttpError> {
    use ProviderHttpError::*;
    if adapter == "opencode-zen" && !raw["org_id"].is_null() {
        let org = provider_context::console_organization(&previous.context["console"]);
        if raw["org_id"].as_str().is_none() || raw["org_id"].as_str() != org {
            return Err(ClientAccountChanged);
        }
    }
    let seconds = raw["expires_in"]
        .as_f64()
        .filter(|seconds| (1.0..=2_678_400.0).contains(seconds) && seconds.fract() == 0.0)
        .ok_or(ResponseInvalid)? as i64;
    let at = iso_from_ms(now.saturating_add(seconds * 1000));
    let credential = raw["access_token"].as_str().ok_or(ResponseInvalid)?;
    let refresh = raw
        .get("refresh_token")
        .map(|refresh| {
            refresh
                .as_str()
                .and_then(|token| normalize_credential(adapter, token))
                .ok_or(ResponseInvalid)
        })
        .transpose()?;
    let mut context = previous.context.clone();
    context["oauth"]["expiresAt"] = json!(at);
    if let Some(refresh) = refresh {
        if let Some(old) = context["oauth"].get_mut("refreshToken") {
            wipe(old);
        }
        context["oauth"]["refreshToken"] = Value::String(refresh);
    }
    Secret::new(adapter, credential, context, Some(at)).map_err(|_| ResponseInvalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembered_grant_controls_endpoint_and_rotation() -> Result<(), Box<dyn std::error::Error>> {
        let at = "2026-11-19T12:00:00.000Z";
        let grant = Secret::new(
            "opencode-zen",
            "synthetic-access",
            json!({
                "console":{"orgId":"org_fixture"},"deviceGrant":true,
                "oauth":{"clientId":"opencode-cli","refreshToken":"synthetic-refresh","expiresAt":at}
            }),
            Some(at.to_owned()),
        )?;
        let http = ProviderHttp::new()?;
        let request = prepare(&http, "opencode-zen", &grant)?.build()?;
        assert_eq!(request.url().path(), "/console/auth/device/token");
        let rotated = project(
            "opencode-zen",
            &grant,
            &json!({"access_token":"synthetic-next",
            "refresh_token":"synthetic-next-refresh","expires_in":900,"org_id":"org_fixture"}),
            0,
        )?;
        assert_eq!(
            rotated.expires_at.as_deref(),
            Some("1970-01-01T00:15:00.000Z")
        );
        assert_eq!(
            rotated.context["oauth"]["refreshToken"],
            "synthetic-next-refresh"
        );
        assert!(matches!(
            project("opencode-zen", &grant, &json!({"org_id":"org_other"}), 0),
            Err(ProviderHttpError::ClientAccountChanged)
        ));
        let external = Secret::new("claude-oauth", "synthetic-access", Value::Null, None)?;
        assert!(matches!(
            prepare(&http, "claude-oauth", &external),
            Err(ProviderHttpError::ActionInvalid)
        ));
        Ok(())
    }
}
