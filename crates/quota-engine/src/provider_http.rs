use crate::{
    provider_catalog::routes, provider_context as context,
    provider_credentials::normalize_credential, quota_json::decode_body,
};
use chrono::{Datelike, Local, TimeZone};
use reqwest::{
    header::{self, HeaderMap, HeaderName, HeaderValue},
    Client, Method, Request, Url,
};
use serde_json::{json, Value};
use std::{fmt, time::Duration};
use tokio::sync::watch;
use usage_engine::{js_json::stringify, time::now_ms};
use zeroize::Zeroizing;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: usize = 512 * 1024;
const ZCODE_VERSION: &str = "3.14.3";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderHttpError {
    CredentialRequired,
    ActionInvalid,
    Canceled,
    AuthRequired,
    AccessDenied,
    RateLimited,
    RedirectRejected,
    RequestFailed,
    Timeout,
    OutputLimit,
    ResponseInvalid,
    ClientAccountChanged,
}

impl fmt::Display for ProviderHttpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::CredentialRequired => "PROVIDER_CREDENTIAL_REQUIRED",
            Self::ActionInvalid => "PROVIDER_ACTION_INVALID",
            Self::Canceled => "PROVIDER_CANCELED",
            Self::AuthRequired => "PROVIDER_AUTH_REQUIRED",
            Self::AccessDenied => "PROVIDER_ACCESS_DENIED",
            Self::RateLimited => "PROVIDER_RATE_LIMITED",
            Self::RedirectRejected => "PROVIDER_REDIRECT_REJECTED",
            Self::RequestFailed => "PROVIDER_REQUEST_FAILED",
            Self::Timeout => "PROVIDER_TIMEOUT",
            Self::OutputLimit => "PROVIDER_OUTPUT_LIMIT",
            Self::ResponseInvalid => "PROVIDER_RESPONSE_INVALID",
            Self::ClientAccountChanged => "PROVIDER_CLIENT_ACCOUNT_CHANGED",
        })
    }
}

impl std::error::Error for ProviderHttpError {}
use ProviderHttpError::*;

#[derive(Default)]
pub struct ReadOptions<'a> {
    pub project: Option<&'a Value>,
    pub part: Option<&'a str>,
    pub organization: Option<&'a str>,
    pub page_number: Option<u8>,
    pub workbuddy_at: Option<i64>,
}

pub struct ProviderHttp {
    pub(crate) client: Client,
}

impl ProviderHttp {
    pub fn new() -> Result<Self, ProviderHttpError> {
        Ok(Self {
            client: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .https_only(true)
                .timeout(HTTP_TIMEOUT)
                .build()
                .map_err(request_failure)?,
        })
    }

    /// A true cancellation value or a dropped cancellation owner stops the read.
    pub async fn read(
        &self,
        adapter: &str,
        credential: &str,
        options: ReadOptions<'_>,
        cancellation: &mut watch::Receiver<bool>,
    ) -> Result<Value, ProviderHttpError> {
        let request = prepare(adapter, credential, options)?;
        tokio::select! {
            biased;
            _ = cancellation.wait_for(|canceled| *canceled) => Err(Canceled),
            result = execute(&self.client, adapter, request) => result,
        }
    }
}

fn prepare(
    adapter: &str,
    credential: &str,
    options: ReadOptions<'_>,
) -> Result<Request, ProviderHttpError> {
    let route = routes()
        .ok()
        .and_then(|routes| routes.get(adapter))
        .ok_or(CredentialRequired)?;
    let endpoint = route["url"].as_str().ok_or(CredentialRequired)?;
    let token =
        Zeroizing::new(normalize_credential(adapter, credential).ok_or(CredentialRequired)?);
    let url = match options.part {
        Some(part) => route["extra"][part].as_str().ok_or(ActionInvalid)?,
        None => endpoint,
    };
    let organization_url = if let Some(organization) = options.organization {
        if adapter != "claude-web" || !context::valid_organization(organization) {
            return Err(ActionInvalid);
        }
        Some(format!(
            "https://claude.ai/api/organizations/{organization}/usage"
        ))
    } else {
        None
    };
    if options
        .page_number
        .is_some_and(|page| adapter != "workbuddy-desktop" || !(1..=10).contains(&page))
    {
        return Err(ActionInvalid);
    }
    let project = options.project.unwrap_or(&Value::Null);
    let mut headers = HeaderMap::new();
    if route["kind"] == "cookie" {
        credential_header(&mut headers, header::COOKIE, token.as_str())?;
    } else {
        let bearer = Zeroizing::new(format!("Bearer {token}", token = token.as_str()));
        credential_header(&mut headers, header::AUTHORIZATION, bearer.as_str())?;
    }
    headers.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
    let user_agent = match adapter {
        "workbuddy-web" => project["userAgent"]
            .as_str()
            .filter(|value| {
                (1..=512).contains(&value.len())
                    && value.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
            })
            .ok_or(ActionInvalid)?,
        "zcode-device" => "ZCode/3.14.3",
        _ => "AgentUsage-Quota/1",
    };
    headers.insert(
        header::USER_AGENT,
        HeaderValue::from_str(user_agent).map_err(|_| ActionInvalid)?,
    );
    let mut desktop_body = None;
    match adapter {
        "workbuddy-desktop" => {
            let (uid, domain, enterprise) =
                context::workbuddy_account(&project["desktop"]).ok_or(ActionInvalid)?;
            credential_header(&mut headers, HeaderName::from_static("x-user-id"), uid)?;
            if !domain.is_empty() {
                insert(&mut headers, "x-domain", domain)?;
            }
            if let Some(enterprise) = enterprise {
                credential_header(
                    &mut headers,
                    HeaderName::from_static("x-enterprise-id"),
                    enterprise,
                )?;
                credential_header(
                    &mut headers,
                    HeaderName::from_static("x-tenant-id"),
                    enterprise,
                )?;
            }
            let at = options.workbuddy_at.unwrap_or_else(now_ms);
            if !(0..=8_000_000_000_000_000).contains(&at) {
                return Err(ActionInvalid);
            }
            desktop_body = Some(json!({
                "PageNumber":options.page_number.unwrap_or(1), "PageSize":100, "ProductCode":"p_tcaca",
                "Status":[0,3], "PackageEndTimeRangeBegin":local_timestamp(at)?,
                "PackageEndTimeRangeEnd":local_timestamp(at + 365 * 101 * 86_400_000)?,
            }));
        }
        "workbuddy-web" => {
            insert(&mut headers, "origin", "https://www.workbuddy.cn")?;
            insert(
                &mut headers,
                "referer",
                "https://www.workbuddy.cn/profile/plans-usage",
            )?;
        }
        "opencode-zen" => insert(
            &mut headers,
            "x-org-id",
            context::console_organization(&project["console"]).ok_or(ActionInvalid)?,
        )?,
        "opencode-web" if options.part.is_some() => insert(
            &mut headers,
            "x-org-id",
            context::workspace(&project["workspace"]).ok_or(ActionInvalid)?,
        )?,
        "zcode-device" => {
            let (_, device) = context::zcode_account(&project["zcode"]).ok_or(ActionInvalid)?;
            credential_header(
                &mut headers,
                HeaderName::from_static("x-device-mid"),
                device,
            )?;
            insert(&mut headers, "x-zcode-app-version", ZCODE_VERSION)?;
            insert(&mut headers, "http-referer", "https://zcode.z.ai")?;
            insert(&mut headers, "x-platform", "win32")?;
            insert(&mut headers, "x-os-category", "windows")?;
        }
        "claude-oauth" => insert(&mut headers, "anthropic-beta", "oauth-2025-04-20")?,
        "deepseek-web" => insert(&mut headers, "x-client-platform", "web")?,
        "gemini-web" => insert(&mut headers, "referer", "https://gemini.google.com/usage")?,
        "gemini-code-assist"
            if context::google_project(project).is_none()
                && project["discover"] != true
                && options.part != Some("bootstrap") =>
        {
            return Err(ActionInvalid)
        }
        _ => {}
    }
    let mut request = Request::new(
        if route["method"] == "POST" {
            Method::POST
        } else {
            Method::GET
        },
        Url::parse(organization_url.as_deref().unwrap_or(url)).map_err(|_| ActionInvalid)?,
    );
    if request.method() == Method::POST {
        let payload = if let Some(body) = desktop_body {
            body
        } else if options.part == Some("bootstrap") {
            json!({"metadata":{"ideType":"GEMINI_CLI","pluginType":"GEMINI"}})
        } else if adapter != "workbuddy-web" && project.is_string() {
            json!({"project":project})
        } else {
            json!({})
        };
        let body = stringify(&payload);
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        insert(&mut headers, "content-length", &body.len().to_string())?;
        *request.body_mut() = Some(body.into());
    }
    *request.headers_mut() = headers;
    Ok(request)
}

fn local_timestamp(at: i64) -> Result<String, ProviderHttpError> {
    let date = Local
        .timestamp_millis_opt(at)
        .single()
        .ok_or(ActionInvalid)?;
    Ok(format!("{}{}", date.year(), date.format("-%m-%d %H:%M:%S")))
}

fn credential_header(
    headers: &mut HeaderMap,
    name: HeaderName,
    value: &str,
) -> Result<(), ProviderHttpError> {
    let mut value = HeaderValue::from_str(value).map_err(|_| ActionInvalid)?;
    value.set_sensitive(true);
    headers.insert(name, value);
    Ok(())
}

fn insert(
    headers: &mut HeaderMap,
    name: &'static str,
    value: &str,
) -> Result<(), ProviderHttpError> {
    headers.insert(
        HeaderName::from_static(name),
        HeaderValue::from_str(value).map_err(|_| ActionInvalid)?,
    );
    Ok(())
}

pub(crate) fn request_failure(error: reqwest::Error) -> ProviderHttpError {
    if error.is_timeout() {
        Timeout
    } else {
        RequestFailed
    }
}

async fn execute(
    client: &Client,
    adapter: &str,
    request: Request,
) -> Result<Value, ProviderHttpError> {
    let mut response = client.execute(request).await.map_err(request_failure)?;
    match response.status().as_u16() {
        200 => {}
        401 => return Err(AuthRequired),
        403 => return Err(AccessDenied),
        429 => return Err(RateLimited),
        300..=399 => return Err(RedirectRejected),
        _ => return Err(RequestFailed),
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err(OutputLimit);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_failure)? {
        if chunk.len() > MAX_BODY - body.len() {
            return Err(OutputLimit);
        }
        body.extend_from_slice(&chunk);
    }
    decode_body(adapter, &body).map_err(|_| ResponseInvalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        path::Path,
        process::Command,
        thread,
    };

    #[test]
    fn request_urls_headers_and_payloads_match_electron_without_sending(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let reference = r#"
          const {EventEmitter} = require('node:events');
          const {readProvider} = require('./src/quota/provider-http');
          const {routes} = require('./src/quota/provider-catalog');
          const id = '11111111-2222-4333-8444-555555555555';
          const desktops = {
            'workbuddy-desktop': {desktop:{uid:'synthetic',domain:'workbuddy.cn',enterpriseId:'example'}},
            'zcode-device': {zcode:{userId:'synthetic',deviceMid:id}},
            'opencode-zen': {console:{orgId:'org_sample'}},
            'workbuddy-web': {userAgent:'Synthetic Client/1'},
            'opencode-web': {workspace:'wrk_sample'},
            'gemini-code-assist': 'synthetic-project',
          };
          const cookies = {'cursor-web':'WorkosCursorSessionToken=synthetic_key','claude-web':'sessionKey=synthetic_key','mimo-web':'api-platform_serviceToken=synthetic_key; userId=test_user'};
          function capture(call) {
            let observed;
            const mock = (url, {method, headers}, consume) => {
              const request = new EventEmitter();
              request.destroy = () => {};
              observed = {url, method, headers:Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(), String(v)])), body:null};
              request.end = body => { observed.body = body; };
              setImmediate(() => {
                const response = new EventEmitter();
                response.statusCode = 200;
                response.destroy = () => {};
                consume(response);
                response.emit('data', Buffer.from('{}'));
                response.emit('end');
              });
              return request;
            };
            return readProvider(call.adapter,call.credential,{...call.options,get:mock,post:mock}).then(() => ({...call,observed}));
          }
          const calls = [];
          for (const [adapter, route] of Object.entries(routes)) {
            if (!route.url) continue;
            const credential = route.kind === 'cookie' ? cookies[adapter] || 'auth=synthetic_key' : 'synthetic_key';
            const options = {project:desktops[adapter], workbuddyAt:1760938800000};
            calls.push({adapter,credential,options});
            for (const part of Object.keys(route.extra || {})) {
              calls.push({adapter,credential,options:{...options,part}});
            }
          }
          calls.push({adapter:'claude-web',credential:cookies['claude-web'],options:{organization:id}});
          calls.push({adapter:'workbuddy-desktop',credential:'synthetic_key',options:{project:desktops['workbuddy-desktop'],pageNumber:10,workbuddyAt:1760938800000}});
          Promise.all(calls.map(capture)).then(rows => process.stdout.write(JSON.stringify(rows))).catch(error => { console.error(error.message); process.exitCode=1; });
        "#;
        let js = Command::new("node")
            .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
            .args(["-e", reference])
            .output()?;
        assert!(
            js.status.success(),
            "{}",
            String::from_utf8_lossy(&js.stderr)
        );
        let rows: Vec<Value> = serde_json::from_slice(&js.stdout)?;
        assert!(rows.len() >= 20);
        for row in rows {
            let adapter = row["adapter"].as_str().expect("catalog route");
            let options = &row["options"];
            let request = prepare(
                adapter,
                row["credential"].as_str().expect("synthetic credential"),
                ReadOptions {
                    project: options.get("project"),
                    part: options["part"].as_str(),
                    organization: options["organization"].as_str(),
                    page_number: options["pageNumber"]
                        .as_u64()
                        .and_then(|page| u8::try_from(page).ok()),
                    workbuddy_at: options["workbuddyAt"].as_i64(),
                },
            )?;
            let expected = &row["observed"];
            assert_eq!(request.url().as_str(), expected["url"], "{adapter}");
            assert_eq!(request.method().as_str(), expected["method"], "{adapter}");
            assert_eq!(
                request.headers().len(),
                expected["headers"].as_object().expect("header map").len(),
                "{adapter}"
            );
            for (name, value) in request.headers() {
                assert_eq!(
                    value.to_str()?,
                    expected["headers"][name.as_str()],
                    "{adapter} {name}"
                );
                if name == header::AUTHORIZATION || name == header::COOKIE {
                    assert!(value.is_sensitive());
                }
            }
            let body = request
                .body()
                .and_then(reqwest::Body::as_bytes)
                .map(std::str::from_utf8)
                .transpose()?;
            assert_eq!(body, expected["body"].as_str(), "{adapter}");
        }
        Ok(())
    }

    #[tokio::test]
    async fn rejects_bad_status_redirects_and_large_bodies_and_preserves_exact_json(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()?;
        for (wire, expected) in [
            ("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/no-follow\r\nContent-Length: 0\r\n\r\n", Err(RedirectRejected)),
            ("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n", Err(AuthRequired)),
            ("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", Err(AccessDenied)),
            ("HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n", Err(RateLimited)),
            ("HTTP/1.1 200 OK\r\nContent-Length: 524289\r\n\r\n", Err(OutputLimit)),
            ("HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nxxx", Err(ResponseInvalid)),
            ("HTTP/1.1 200 OK\r\nContent-Length: 16\r\n\r\n{\"balance\":0.29}", Ok(json!({"balance":"0.29"}))),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0))?;
            let url = Url::parse(&format!("http://{}/", listener.local_addr()?))?;
            let server = thread::spawn(move || -> std::io::Result<()> {
                let (mut socket, _) = listener.accept()?;
                socket.set_read_timeout(Some(Duration::from_secs(3)))?;
                let mut bytes = BufReader::new(&mut socket);
                let mut line = String::new();
                while bytes.read_line(&mut line)? > 0 && line != "\r\n" {
                    line.clear();
                }
                socket.write_all(wire.as_bytes())
            });
            let actual = execute(&client, "deepseek-api", Request::new(Method::GET, url)).await;
            server.join().expect("loopback server completed")?;
            assert_eq!(actual, expected, "{}", wire.lines().next().unwrap_or_default());
        }
        let http = ProviderHttp::new()?;
        let (_owner, mut canceled) = watch::channel(true);
        assert_eq!(
            http.read(
                "deepseek-api",
                "synthetic_key",
                ReadOptions::default(),
                &mut canceled
            )
            .await,
            Err(Canceled)
        );
        let scope = json!({"workspace":"../../wrong"});
        assert_eq!(
            http.read(
                "opencode-web",
                "auth=synthetic_key",
                ReadOptions {
                    part: Some("usage"),
                    project: Some(&scope),
                    ..Default::default()
                },
                &mut canceled
            )
            .await,
            Err(ActionInvalid)
        );
        Ok(())
    }
}
