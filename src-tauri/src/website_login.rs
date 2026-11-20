use quota_engine::{account_service::AccountError, provider_vault::Secret};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};
use tauri::{
    webview::Cookie, AppHandle, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::{mpsc, watch};
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

use crate::webview_profile::{Profile, LOGIN_PREFIX};

struct Site {
    entry: &'static str,
    domains: &'static [&'static str],
    names: Option<&'static [&'static str]>,
    redirects: &'static [&'static str],
}

fn site(adapter: &str) -> Option<Site> {
    let (entry, domains, names, redirects): (_, &[_], Option<&[_]>, &[_]) = match adapter {
        "gemini-web" => (
            "https://gemini.google.com/usage",
            &["google.com", "gemini.google.com"],
            None,
            &[
                "gemini.google.com",
                "accounts.google.com",
                "myaccount.google.com",
                "consent.google.com",
            ],
        ),
        "opencode-web" => (
            "https://opencode.ai/auth",
            &["opencode.ai"],
            Some(&["auth", "__Host-auth", "__Host-console_session"]),
            &[
                "opencode.ai",
                "auth.opencode.ai",
                "github.com",
                "accounts.google.com",
            ],
        ),
        "deepseek-web" => (
            "https://platform.deepseek.com",
            &["platform.deepseek.com"],
            Some(&[]),
            &[
                "platform.deepseek.com",
                "open.weixin.qq.com",
                "accounts.google.com",
            ],
        ),
        "claude-web" => (
            "https://claude.ai/login",
            &["claude.ai"],
            Some(&["sessionKey"]),
            &["claude.ai", "accounts.google.com", "appleid.apple.com"],
        ),
        "workbuddy-web" => (
            "https://www.workbuddy.cn/profile/plans-usage",
            &["workbuddy.cn", "www.workbuddy.cn"],
            None,
            &[
                "www.workbuddy.cn",
                "workbuddy.cn",
                "accounts.google.com",
                "github.com",
                "open.weixin.qq.com",
                "xui.ptlogin2.qq.com",
                "ssl.ptlogin2.qq.com",
                "graph.qq.com",
                "login.workbuddy.cn",
            ],
        ),
        "cursor-web" => (
            "https://cursor.com/dashboard",
            &["cursor.com"],
            Some(&[
                "WorkosCursorSessionToken",
                "__Secure-next-auth.session-token",
                "next-auth.session-token",
            ]),
            &[
                "cursor.com",
                "authenticator.cursor.sh",
                "accounts.x.ai",
                "accounts.spacex.ai",
                "auth.x.ai",
                "auth.grok.com",
                "auth.grokusercontent.com",
                "auth.grokipedia.com",
                "accounts.google.com",
                "github.com",
            ],
        ),
        "mimo-web" => (
            "https://platform.xiaomimimo.com",
            &["platform.xiaomimimo.com", "xiaomimimo.com"],
            Some(&[
                "api-platform_serviceToken",
                "userId",
                "api-platform_ph",
                "api-platform_slh",
            ]),
            &[
                "platform.xiaomimimo.com",
                "account.xiaomi.com",
                "account.xiaomi.net",
                "passport.xiaomi.com",
            ],
        ),
        _ => return None,
    };
    Some(Site {
        entry,
        domains,
        names,
        redirects,
    })
}

fn allowed_navigation(site: &Site, url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|port| port == 443)
        && url
            .host_str()
            .is_some_and(|host| site.redirects.contains(&host))
}

fn extract_cookies(
    adapter: &str,
    site: &Site,
    cookies: &[Cookie<'_>],
    context: Value,
    now: i64,
) -> Option<Secret> {
    if cookies.len() > 200 {
        return None;
    }
    let mut seen = HashSet::new();
    let mut header = Zeroizing::new(String::new());
    let mut earliest = None;
    for cookie in cookies {
        let expiry = cookie
            .expires_datetime()
            .map(|at| at.unix_timestamp().saturating_mul(1000));
        if site
            .names
            .is_some_and(|names| !names.contains(&cookie.name()))
            || cookie.secure() != Some(true)
            || !cookie
                .domain()
                .is_some_and(|domain| site.domains.contains(&domain.trim_start_matches('.')))
            || expiry.is_some_and(|at| at <= now || at > 8_640_000_000_000_000)
        {
            continue;
        }
        if !seen.insert(cookie.name())
            || cookie.value().is_empty()
            || !cookie
                .value()
                .bytes()
                .all(|byte| (0x21..=0x7e).contains(&byte) && !b";,\"\\".contains(&byte))
        {
            return None;
        }
        if !header.is_empty() {
            header.push_str("; ");
        }
        header.push_str(cookie.name());
        header.push('=');
        header.push_str(cookie.value());
        if header.len() > 16_384 {
            return None;
        }
        if let Some(at) = expiry {
            earliest = Some(earliest.map_or(at, |prior: i64| prior.min(at)));
        }
    }
    Secret::new(adapter, &header, context, earliest.map(iso_from_ms)).ok()
}

pub struct LoginWindow {
    window: WebviewWindow,
    _profile: Profile,
}

impl LoginWindow {
    pub fn open(
        app: &AppHandle,
        adapter: &str,
        cancel: watch::Sender<bool>,
    ) -> Result<Self, AccountError> {
        let site = site(adapter).ok_or(AccountError::Action)?;
        let entry = Url::parse(site.entry).map_err(|_| AccountError::Action)?;
        Self::open_window(
            app,
            WebviewUrl::External(entry),
            move |url| allowed_navigation(&site, url),
            cancel,
        )
    }

    fn open_window(
        app: &AppHandle,
        entry: WebviewUrl,
        navigate: impl Fn(&Url) -> bool + Send + 'static,
        cancel: watch::Sender<bool>,
    ) -> Result<Self, AccountError> {
        let profile = Profile::new(LOGIN_PREFIX).map_err(|_| AccountError::BrowserFailed)?;
        let label = profile
            .path()
            .file_name()
            .and_then(|part| part.to_str())
            .ok_or(AccountError::BrowserFailed)?;
        let window = WebviewWindowBuilder::new(app, label, entry)
            .title("QuotaDock · 登录")
            .inner_size(960., 760.)
            .data_directory(profile.path().join("WebView2"))
            .devtools(false)
            .on_navigation(navigate)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .build()
            .map_err(|_| AccountError::BrowserFailed)?;
        window.on_window_event(move |event| {
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) {
                cancel.send_replace(true);
            }
        });
        Ok(Self {
            window,
            _profile: profile,
        })
    }

    pub async fn credential(&self, adapter: &str) -> Result<Secret, AccountError> {
        let site = site(adapter).ok_or(AccountError::Action)?;
        let quota_url = quota_engine::provider_catalog::routes()
            .ok()
            .and_then(|routes| routes.get(adapter))
            .and_then(|route| route["url"].as_str())
            .and_then(|url| Url::parse(url).ok())
            .ok_or(AccountError::Action)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
        while tokio::time::Instant::now() < deadline {
            let window = self.window.clone();
            let current = window.url().map_err(|_| AccountError::BrowserFailed)?;
            if matches!(adapter, "deepseek-web" | "workbuddy-web")
                && current.origin() != quota_url.origin()
            {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            if adapter == "deepseek-web" {
                let raw = evaluate_string(&window, "location.origin === 'https://platform.deepseek.com' ? localStorage.getItem('userToken') : null").await?;
                if let Some(secret) = raw.as_ref().and_then(|raw| platform_secret(raw)) {
                    return Ok(secret);
                }
            } else {
                let context = if adapter == "workbuddy-web" {
                    let user_agent = evaluate_string(&window, "location.origin === 'https://www.workbuddy.cn' ? navigator.userAgent : null").await?;
                    json!({"userAgent":user_agent.as_deref().map(String::as_str)})
                } else {
                    Value::Null
                };
                let url = quota_url.clone();
                let cookies =
                    tauri::async_runtime::spawn_blocking(move || window.cookies_for_url(url))
                        .await
                        .map_err(|_| AccountError::BrowserFailed)?
                        .map_err(|_| AccountError::BrowserFailed)?;
                if let Some(secret) = extract_cookies(adapter, &site, &cookies, context, now_ms()) {
                    return Ok(secret);
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err(AccountError::LoginTimeout)
    }
}

impl Drop for LoginWindow {
    fn drop(&mut self) {
        // The profile lease stays held while WebView2 releases its last handles.
        let _ = self.window.destroy();
    }
}

async fn evaluate_string(
    window: &WebviewWindow,
    expression: &str,
) -> Result<Option<Zeroizing<String>>, AccountError> {
    let (send, mut receive) = mpsc::channel(1);
    window
        .eval_with_callback(expression, move |raw| {
            let _ = send.try_send(Zeroizing::new(raw));
        })
        .map_err(|_| AccountError::BrowserFailed)?;
    let raw = tokio::time::timeout(Duration::from_secs(5), receive.recv())
        .await
        .map_err(|_| AccountError::BrowserFailed)?
        .ok_or(AccountError::BrowserFailed)?;
    if raw.len() > 32_768 {
        return Ok(None);
    }
    Ok(serde_json::from_str::<Option<String>>(&raw)
        .map_err(|_| AccountError::BrowserFailed)?
        .map(Zeroizing::new))
}

fn platform_secret(raw: &str) -> Option<Secret> {
    if raw.len() > 32_768 {
        return None;
    }
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum PlatformToken {
        Text(String),
        Record(std::collections::HashMap<String, String>),
    }
    let token = match serde_json::from_str(raw) {
        Ok(PlatformToken::Text(token)) => Zeroizing::new(token),
        Ok(PlatformToken::Record(mut fields)) => {
            let selected = ["value", "token", "access_token", "accessToken", "userToken"]
                .iter()
                .find_map(|name| fields.remove(*name));
            use zeroize::Zeroize;
            fields.values_mut().for_each(Zeroize::zeroize);
            Zeroizing::new(selected?)
        }
        Err(_) if !raw.starts_with('{') && !raw.starts_with('[') => {
            return Secret::new("deepseek-web", raw, Value::Null, None).ok()
        }
        Err(_) => return None,
    };
    Secret::new("deepseek-web", &token, Value::Null, None).ok()
}

pub async fn fixture(app: AppHandle, root: std::path::PathBuf) -> Result<Value, AccountError> {
    use quota_engine::{
        account_service::{AccountService, ReadResult},
        provider_observation::Observation,
    };
    use tauri::Manager;

    let main = app
        .get_webview_window("main")
        .ok_or(AccountError::BrowserFailed)?;
    let at = Url::parse("https://claude.ai/api/organizations").map_err(|_| AccountError::Action)?;
    let site = site("claude-web").ok_or(AccountError::Action)?;
    let (popup, path, secret, isolated) = tauri::async_runtime::spawn_blocking(move || {
        let entry = Url::parse("about:blank").map_err(|_| AccountError::BrowserFailed)?;
        let popup = LoginWindow::open_window(
            &app,
            WebviewUrl::External(entry),
            |url| url.as_str() == "about:blank",
            watch::channel(false).0,
        )?;
        let path = popup._profile.path().to_owned();
        let cookie = Cookie::build(("sessionKey", "synthetic-website-fixture"))
            .domain("claude.ai")
            .path("/")
            .secure(true)
            .http_only(true)
            .build();
        popup
            .window
            .set_cookie(cookie)
            .map_err(|_| AccountError::BrowserFailed)?;
        let cookies = popup
            .window
            .cookies_for_url(at.clone())
            .map_err(|_| AccountError::BrowserFailed)?;
        let main_cookies = main
            .cookies_for_url(at)
            .map_err(|_| AccountError::BrowserFailed)?;
        let isolated = !main_cookies
            .iter()
            .any(|cookie| cookie.name() == "sessionKey");
        let secret = extract_cookies("claude-web", &site, &cookies, Value::Null, now_ms())
            .ok_or(AccountError::AuthRequired)?;
        Ok::<_, AccountError>((popup, path, secret, isolated))
    })
    .await
    .map_err(|_| AccountError::BrowserFailed)??;
    let opened = path.join("WebView2").is_dir();
    let account_root = root.join("website-login-fixture");
    let accounts = AccountService::open(&account_root)?;
    accounts.set_experimental(true)?;
    let observed = json!({
        "schemaVersion":"AccountQuotaV2","provider":"claude","fetchedAt":iso_from_ms(now_ms()),
        "incomplete":true,"provenance":{"kind":"undocumented-api","version":null},
        "entitlement":{},"pools":[]
    });
    let verified = accounts
        .verified_login(
            "claude-web",
            "Synthetic website",
            None,
            false,
            secret,
            |read| async move {
                if read.secret.credential.as_str() != "sessionKey=synthetic-website-fixture" {
                    return Err(quota_engine::provider_http::ProviderHttpError::AuthRequired.into());
                }
                Ok(ReadResult {
                    observation: Observation {
                        resources: observed,
                        identity_context: None,
                    },
                    renewed: None,
                })
            },
        )
        .await;
    tauri::async_runtime::spawn_blocking(move || drop(popup))
        .await
        .map_err(|_| AccountError::BrowserFailed)?;
    verified?;
    let id = accounts
        .refreshable()?
        .pop()
        .ok_or(AccountError::AuthRequired)?;
    accounts.close().await?;
    let restarted = AccountService::open(&account_root)?;
    let recovered = restarted.refreshable()? == [id];
    Ok(
        json!({"separateProfileCreated":opened,"cookieIsolated":isolated,
        "profileRemoved":!path.exists(),"dpapiRestart":recovered}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pinned_https_hosts_and_current_secure_cookie_can_be_used() {
        let site = site("claude-web").expect("configured route");
        for url in ["https://claude.ai/login", "https://accounts.google.com/"] {
            assert!(allowed_navigation(
                &site,
                &Url::parse(url).expect("fixture URL")
            ));
        }
        for url in [
            "https://claude.ai.example.test",
            "http://claude.ai",
            "https://claude.ai:444",
            "https://example@claude.ai",
        ] {
            assert!(!allowed_navigation(
                &site,
                &Url::parse(url).expect("fixture URL")
            ));
        }
        let unrelated = Cookie::build(("sessionKey", "synthetic-wrong-origin"))
            .domain("example.test")
            .secure(true)
            .build();
        let insecure = Cookie::build(("sessionKey", "synthetic-insecure"))
            .domain("claude.ai")
            .build();
        let expected = Cookie::build(("sessionKey", "synthetic-correct"))
            .domain("claude.ai")
            .secure(true)
            .build();
        let secret = extract_cookies(
            "claude-web",
            &site,
            &[unrelated, insecure, expected.clone()],
            Value::Null,
            1,
        )
        .expect("synthetic cookie");
        assert_eq!(secret.credential.as_str(), "sessionKey=synthetic-correct");
        assert!(extract_cookies(
            "claude-web",
            &site,
            &[expected.clone(), expected],
            Value::Null,
            1
        )
        .is_none());
        assert!(platform_secret(r#"{"password":"synthetic-private"}"#).is_none());
        assert!(platform_secret(r#"{"value":"synthetic-token"}"#).is_some());
    }
}
