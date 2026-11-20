use crate::{
    codex_resources,
    provider_vault::wipe,
    windows_job::{ExecutablePin, JobError, JobProcess, LineSession, StartOptions},
};
use reqwest::Url;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fmt,
    path::Path,
    time::{Duration, Instant},
};
use usage_engine::time::{iso_from_ms, now_ms};

const CONFIG: &[&str] = &[
    "cli_auth_credentials_store=\"keyring\"",
    "analytics.enabled=false",
    "feedback.enabled=false",
    "check_for_update_on_startup=false",
    "otel.exporter=\"none\"",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Unavailable,
    Keyring,
    Protocol,
    Canceled,
    Timeout,
    AuthRequired,
    Browser,
    Request,
}
impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "CODEX_PROCESS_UNAVAILABLE",
            Self::Keyring => "SYSTEM_CREDENTIAL_STORE_REQUIRED",
            Self::Protocol => "CODEX_PROTOCOL_INVALID",
            Self::Canceled => "LOGIN_CANCELED",
            Self::Timeout => "CODEX_REQUEST_TIMEOUT",
            Self::AuthRequired => "LOGIN_REQUIRED",
            Self::Browser => "BROWSER_OPEN_FAILED",
            Self::Request => "CODEX_REQUEST_FAILED",
        })
    }
}
impl std::error::Error for Error {}
impl From<JobError> for Error {
    fn from(error: JobError) -> Self {
        match error {
            JobError::Canceled => Self::Canceled,
            JobError::TimedOut => Self::Timeout,
            JobError::OutputLimit => Self::Protocol,
            _ => Self::Unavailable,
        }
    }
}

struct Message(Value);
impl Drop for Message {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

pub struct CodexRpc {
    child: LineSession,
    request_id: u32,
    login_event: Option<(String, bool)>,
}

impl CodexRpc {
    pub fn launch(
        pin: &ExecutablePin,
        home: &Path,
        canceled: &impl Fn() -> bool,
    ) -> Result<Self, Error> {
        if canceled() {
            return Err(Error::Canceled);
        }
        let mut args: Vec<OsString> = ["app-server", "--listen", "stdio://"]
            .into_iter()
            .map(Into::into)
            .collect();
        for arg in CONFIG {
            args.extend([OsString::from("-c"), OsString::from(arg)]);
        }
        let mut env: BTreeMap<_, _> = [
            "SystemRoot",
            "WINDIR",
            "PATH",
            "TEMP",
            "TMP",
            "LOCALAPPDATA",
            "APPDATA",
            "USERPROFILE",
            "HOMEDRIVE",
            "HOMEPATH",
        ]
        .into_iter()
        .filter_map(|name| std::env::var_os(name).map(|value| (OsString::from(name), value)))
        .collect();
        env.insert("CODEX_HOME".into(), home.as_os_str().to_owned());
        env.insert("RUST_LOG".into(), "off".into());
        let child = JobProcess::start_lines(
            pin,
            StartOptions {
                cwd: home,
                arguments: &args,
                environment: &env,
            },
        )?;
        let mut rpc = Self {
            child,
            request_id: 0,
            login_event: None,
        };
        rpc.call("initialize", json!({
            "clientInfo":{"name":"agent_usage_quota","title":"Agent Usage Quota","version":"0.1.0"},
            "capabilities":{"experimentalApi":false}
        }), canceled)?;
        rpc.send(&json!({"method":"initialized"}))?;
        let response = rpc.call("config/read", json!({"includeLayers":false}), canceled)?;
        if response.0["config"]["cli_auth_credentials_store"] != "keyring" {
            return Err(Error::Keyring);
        }
        Ok(rpc)
    }

    fn send(&mut self, request: &Value) -> Result<(), Error> {
        let mut line =
            zeroize::Zeroizing::new(serde_json::to_vec(request).map_err(|_| Error::Protocol)?);
        line.push(b'\n');
        self.child.send(&line).map_err(Into::into)
    }

    fn receive(
        &mut self,
        deadline: Instant,
        canceled: &impl Fn() -> bool,
    ) -> Result<Message, Error> {
        let line = self.child.next_line(deadline, canceled)?;
        let message = serde_json::from_slice::<Value>(&line).map_err(|_| Error::Protocol)?;
        message
            .is_object()
            .then_some(Message(message))
            .ok_or(Error::Protocol)
    }

    fn dispatch(&mut self, message: &Value) -> Result<(), Error> {
        if let Some(method) = message["method"].as_str() {
            if let Some(id) = message.get("id") {
                self.send(
                    &json!({"id":id,"error":{"code":-32601,"message":"Method not supported"}}),
                )?;
            } else if method == "account/login/completed" {
                let event = &message["params"];
                if let Some(id) = event["loginId"]
                    .as_str()
                    .filter(|id| (1..=128).contains(&id.len()))
                {
                    self.login_event = Some((id.to_owned(), event["success"] == true));
                }
            }
        }
        Ok(())
    }

    fn call(
        &mut self,
        method: &'static str,
        params: Value,
        canceled: &impl Fn() -> bool,
    ) -> Result<Message, Error> {
        if canceled() {
            return Err(Error::Canceled);
        }
        self.request_id += 1;
        let id = self.request_id;
        let mut request = json!({"id":id,"method":method});
        if !params.is_null() {
            request["params"] = params;
        }
        self.send(&request)?;
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let mut reply = self.receive(deadline, canceled)?;
            if reply.0.get("method").is_none() && reply.0["id"] == id {
                if reply.0.get("error").is_some() {
                    return Err(Error::Request);
                }
                return reply
                    .0
                    .get_mut("result")
                    .map(|value| Message(value.take()))
                    .ok_or(Error::Protocol);
            }
            self.dispatch(&reply.0)?;
        }
    }

    pub fn login(
        &mut self,
        canceled: &impl Fn() -> bool,
        open: impl FnOnce(Url) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let result = self.call("account/login/start", json!({"type":"chatgpt"}), canceled)?;
        let login_id = result.0["loginId"]
            .as_str()
            .filter(|value| (1..=128).contains(&value.len()))
            .ok_or(Error::Protocol)?;
        let url = login_url(&result.0["authUrl"])?;
        if canceled() {
            return Err(Error::Canceled);
        }
        open(url)?;
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            if let Some((id, success)) = self.login_event.take() {
                if id == login_id {
                    return if success {
                        Ok(())
                    } else {
                        Err(Error::AuthRequired)
                    };
                }
            }
            match self.receive(deadline, canceled) {
                Ok(message) => self.dispatch(&message.0)?,
                Err(Error::Canceled | Error::Timeout) => {
                    self.request_id += 1;
                    let _ = self.send(&json!({"id":self.request_id,"method":"account/login/cancel","params":{"loginId":login_id}}));
                    return if canceled() {
                        Err(Error::Canceled)
                    } else {
                        Err(Error::Timeout)
                    };
                }
                Err(error) => return Err(error),
            }
        }
    }

    pub fn refresh(&mut self, canceled: &impl Fn() -> bool) -> Result<Value, Error> {
        let observed = self.call("account/read", json!({"refreshToken":false}), canceled)?;
        let account = &observed.0["account"];
        if account["type"] != "chatgpt" {
            return Err(Error::AuthRequired);
        }
        let rates = self.call("account/rateLimits/read", Value::Null, canceled)?;
        codex_resources::from_codex(
            &rates.0,
            &json!(iso_from_ms(now_ms())),
            &account["planType"],
        )
        .map_err(|_| Error::Protocol)
    }

    pub fn logout(&mut self, canceled: &impl Fn() -> bool) -> Result<(), Error> {
        self.call("account/logout", Value::Null, canceled)
            .map(|_| ())
    }
}

fn login_url(value: &Value) -> Result<Url, Error> {
    let url = value
        .as_str()
        .filter(|value| value.len() <= 16_384)
        .and_then(|value| Url::parse(value).ok())
        .ok_or(Error::Protocol)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(
            (url.host_str(), url.path()),
            (Some("auth.openai.com"), "/oauth/authorize") | (Some("chatgpt.com"), _)
        )
    {
        return Err(Error::Protocol);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn login_origin_is_pinned() {
        assert!(login_url(&json!(
            "https://auth.openai.com/oauth/authorize?state=fixture"
        ))
        .is_ok());
        assert!(login_url(&json!(
            "https://auth.openai.com.example.org/oauth/authorize"
        ))
        .is_err());
        assert!(login_url(&json!("https://auth.openai.com/other")).is_err());
        assert!(login_url(&json!("https://name@chatgpt.com/")).is_err());
    }
}
