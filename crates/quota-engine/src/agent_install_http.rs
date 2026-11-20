use reqwest::{header, redirect::Policy, Client, StatusCode, Url};
use sha2::{Digest, Sha256, Sha512};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Notify,
};
use usage_engine::config_health::{guard, guard_existing_parent};

pub(super) type Result<T> = std::result::Result<T, &'static str>;

pub(super) const CANCELED: &str = "INSTALL_CANCELED";
pub(super) const TIMEOUT: &str = "INSTALL_TIMEOUT";
pub(super) const DOWNLOAD: &str = "INSTALL_DOWNLOAD_FAILED";
const URL_REJECTED: &str = "INSTALL_URL_REJECTED";
const LIMIT: &str = "INSTALL_DOWNLOAD_LIMIT";
const PATH: &str = "INSTALL_PATH_REJECTED";
const WRITE: &str = "INSTALL_WRITE_FAILED";

#[derive(Default)]
pub struct Cancel {
    canceled: AtomicBool,
    event: Notify,
}

impl Cancel {
    pub fn stop(&self) {
        self.canceled.store(true, Ordering::Release);
        self.event.notify_one();
    }

    pub fn stopped(&self) -> bool {
        self.canceled.load(Ordering::Acquire)
    }

    pub(super) fn check(&self) -> Result<()> {
        if self.stopped() {
            Err(CANCELED)
        } else {
            Ok(())
        }
    }

    async fn wait(&self) {
        if !self.stopped() {
            self.event.notified().await;
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Algorithm {
    Sha256,
    Sha512,
}

enum Hash {
    Sha256(Sha256),
    Sha512(Sha512),
}
impl Hash {
    fn new(algorithm: Algorithm) -> Self {
        match algorithm {
            Algorithm::Sha256 => Self::Sha256(Sha256::new()),
            Algorithm::Sha512 => Self::Sha512(Sha512::new()),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::Sha256(state) => state.update(bytes),
            Self::Sha512(state) => state.update(bytes),
        }
    }

    fn finish(self) -> String {
        match self {
            Self::Sha256(state) => format!("{:x}", state.finalize()),
            Self::Sha512(state) => format!("{:x}", state.finalize()),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Scope {
    Registry,
    Node,
    Antigravity,
    WorkBuddy,
    Cursor,
    ZCode,
}
impl Scope {
    fn hosts(self) -> &'static [&'static str] {
        match self {
            Self::Registry => &["registry.npmjs.org"],
            Self::Node => &["nodejs.org"],
            Self::Antigravity => &[
                "antigravity-cli-auto-updater-974169037036.us-central1.run.app",
                "storage.googleapis.com",
            ],
            Self::WorkBuddy => &["www.workbuddy.cn", "download.codebuddy.cn"],
            Self::Cursor => &[
                "cursor.com",
                "api2.cursor.sh",
                "downloads.cursor.com",
                "downloads.cursor.sh",
            ],
            Self::ZCode => &["zcode.z.ai", "cdn-zcode.z.ai"],
        }
    }

    pub(super) fn allowed(self, raw: &str) -> Result<Url> {
        let url = Url::parse(raw).map_err(|_| URL_REJECTED)?;
        self.validate(url)
    }

    fn validate(self, url: Url) -> Result<Url> {
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some_and(|port| port != 443)
            || !url
                .host_str()
                .is_some_and(|host| self.hosts().contains(&host))
        {
            return Err(URL_REJECTED);
        }
        Ok(url)
    }
}

pub(super) struct Request<'a> {
    pub url: &'a str,
    pub scope: Scope,
    pub maximum: u64,
    pub file: Option<&'a Path>,
    pub resume: bool,
    pub algorithm: Algorithm,
}

pub(super) struct Response {
    pub bytes: Vec<u8>,
    pub digest: String,
}

pub(super) fn client() -> Result<Client> {
    Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| DOWNLOAD)
}

fn reqwest_error(error: reqwest::Error) -> &'static str {
    if error.is_timeout() {
        TIMEOUT
    } else {
        DOWNLOAD
    }
}

pub(super) async fn receive(
    client: &Client,
    request: Request<'_>,
    cancel: &Cancel,
    progress: impl Fn(u64, Option<u64>),
) -> Result<Response> {
    let deadline = Duration::from_secs(if request.file.is_some() { 300 } else { 20 });
    tokio::select! {
        biased;
        _=cancel.wait()=>Err(CANCELED),
        result=tokio::time::timeout(deadline,receive_inner(client,request,progress))=>result.unwrap_or(Err(TIMEOUT)),
    }
}

fn range(raw: &str, start: u64) -> Option<(u64, u64)> {
    let (slice, total) = raw.strip_prefix("bytes ")?.split_once('/')?;
    let (left, right) = slice.split_once('-')?;
    let total = total.parse().ok()?;
    let end = right.parse().ok()?;
    (left.parse::<u64>().ok()? == start && start <= end && end < total).then_some((end, total))
}

async fn receive_inner(
    client: &Client,
    request: Request<'_>,
    progress: impl Fn(u64, Option<u64>),
) -> Result<Response> {
    let mut url = request.scope.allowed(request.url)?;
    let mut offset = 0;
    let mut hash = Hash::new(request.algorithm);
    if let Some(file) = request.file {
        guard_existing_parent(file).map_err(|_| PATH)?;
        if request.resume {
            match std::fs::symlink_metadata(file) {
                Ok(meta) => {
                    guard(file).map_err(|_| PATH)?;
                    if !meta.is_file() {
                        return Err(PATH);
                    }
                    if meta.len() > request.maximum {
                        return Err(LIMIT);
                    }
                    let mut data = tokio::io::BufReader::new(
                        tokio::fs::File::open(file).await.map_err(|_| WRITE)?,
                    );
                    let mut chunk = [0; 64 * 1024];
                    loop {
                        let count = data.read(&mut chunk).await.map_err(|_| WRITE)?;
                        if count == 0 {
                            break;
                        }
                        offset += count as u64;
                        if offset > request.maximum {
                            return Err(LIMIT);
                        }
                        hash.update(&chunk[..count]);
                    }
                    if offset != meta.len() {
                        return Err(WRITE);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(PATH),
            }
        }
    }
    let existing = offset > 0;
    let mut redirects = 0;
    let mut response = loop {
        let mut outbound = client
            .get(url.clone())
            .header(header::USER_AGENT, "AgentUsage-Installer/1")
            .header(header::ACCEPT, "*/*");
        if offset > 0 {
            outbound = outbound.header(header::RANGE, format!("bytes={offset}-"));
        }
        let response = outbound.send().await.map_err(reqwest_error)?;
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            redirects += 1;
            if redirects > 5 {
                return Err(URL_REJECTED);
            }
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(URL_REJECTED)?;
            url = request
                .scope
                .validate(url.join(location).map_err(|_| URL_REJECTED)?)?;
        } else {
            break response;
        }
    };
    let code = response.status();
    if code == StatusCode::RANGE_NOT_SATISFIABLE && existing {
        let received = response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("bytes */"))
            .and_then(|value| value.parse::<u64>().ok());
        if received == Some(offset) {
            return Ok(Response {
                bytes: Vec::new(),
                digest: hash.finish(),
            });
        }
        return Err(DOWNLOAD);
    }
    let resumed = code == StatusCode::PARTIAL_CONTENT;
    let (total, expected) = if resumed {
        if !existing || request.file.is_none() {
            return Err(DOWNLOAD);
        }
        let (end, total) = response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| range(value, offset))
            .ok_or(DOWNLOAD)?;
        (Some(total), Some(end + 1))
    } else if code == StatusCode::OK {
        offset = 0;
        hash = Hash::new(request.algorithm);
        (response.content_length(), response.content_length())
    } else {
        return Err(DOWNLOAD);
    };
    if total.is_some_and(|total| total > request.maximum) {
        return Err(LIMIT);
    }
    let mut file = if let Some(path) = request.file {
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true);
        if resumed {
            guard(path).map_err(|_| PATH)?;
            options.append(true);
        } else if request.resume && std::fs::symlink_metadata(path).is_ok() {
            guard(path).map_err(|_| PATH)?;
            options.truncate(true);
        } else {
            options.create_new(true);
        }
        Some(options.open(path).await.map_err(|_| WRITE)?)
    } else {
        None
    };
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(reqwest_error)? {
        offset += chunk.len() as u64;
        if offset > request.maximum {
            return Err(LIMIT);
        }
        hash.update(&chunk);
        if let Some(file) = &mut file {
            file.write_all(&chunk).await.map_err(|_| WRITE)?;
        } else {
            bytes.extend_from_slice(&chunk);
        }
        progress(offset, total.filter(|value| *value > 0));
    }
    if expected.is_some_and(|expected| expected != offset)
        || total.is_some_and(|total| total != offset)
    {
        return Err(DOWNLOAD);
    }
    if let Some(file) = &mut file {
        file.sync_all().await.map_err(|_| WRITE)?;
    }
    Ok(Response {
        bytes,
        digest: hash.finish(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn official_scopes_match_electron_and_resume_range_is_bounded() {
        let cases = [
            (
                "registry",
                "https://registry.npmjs.org/@openai/codex/latest",
                Scope::Registry,
            ),
            (
                "registry",
                "https://registry.npmjs.org.example.invalid/",
                Scope::Registry,
            ),
            (
                "registry",
                "https://user:pwd@registry.npmjs.org/",
                Scope::Registry,
            ),
            (
                "registry",
                "https://registry.npmjs.org:444/",
                Scope::Registry,
            ),
            (
                "node",
                "http://nodejs.org/dist/latest-v24.x/SHASUMS256.txt",
                Scope::Node,
            ),
            (
                "node",
                "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt",
                Scope::Node,
            ),
            ("cursor", "https://download.codebuddy.cn/", Scope::Cursor),
            ("cursor", "https://downloads.cursor.com/", Scope::Cursor),
            (
                "antigravity",
                "https://storage.googleapis.com/fixture",
                Scope::Antigravity,
            ),
            ("zcode", "https://cdn-zcode.z.ai/fixture", Scope::ZCode),
        ];
        let data: Vec<_> = cases.iter().map(|(kind, url, _)| [kind, url]).collect();
        let actual: Vec<_> = cases
            .iter()
            .map(|(_, url, scope)| scope.allowed(url).is_ok())
            .collect();
        let script = r#"
            const {allowed}=require('../../src/quota/agent-install-http');
            const cases=JSON.parse(process.argv[1]);
            process.stdout.write(JSON.stringify(cases.map(([scope,url])=>allowed(url,scope))));
        "#;
        let reference = Command::new("node")
            .args([
                "-e",
                script,
                &serde_json::to_string(&data).expect("fixtures"),
            ])
            .output()
            .expect("Node oracle");
        assert!(reference.status.success());
        let reference: Vec<bool> = serde_json::from_slice(&reference.stdout).expect("oracle");
        assert_eq!(actual, reference);

        assert_eq!(range("bytes 10-99/100", 10), Some((99, 100)));
        assert_eq!(range("bytes 0-99/100", 10), None);
        assert_eq!(range("bytes 10-100/100", 10), None);
        assert_eq!(range("bytes 10-9/100", 10), None);
    }
}
