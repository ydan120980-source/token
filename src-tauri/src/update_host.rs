use crate::reader;
use reqwest::{redirect::Policy, ClientBuilder, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{Read, Seek},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_updater::{Error, Update, Updater, UpdaterExt};
use tokio::{
    io::AsyncWriteExt,
    sync::{watch, Notify},
    time::Instant,
};
use usage_engine::time::{iso_from_ms, now_ms};

const FEED: &str =
    "https://github.com/ydan120980-source/token/releases/latest/download/latest-tauri.json";
const RELEASES: &str = "https://github.com/ydan120980-source/token/releases/tag/v";
const ASSET_PATH: &str = "/ydan120980-source/token/releases/download/";
const EVENT: &str = "update:state";
const MAX_PACKAGE: u64 = 32 * 1024 * 1024;
const NOT_CONFIGURED: &str = "UPDATE_NOT_CONFIGURED";
const NOT_READY: &str = "UPDATE_NOT_READY";
const BUSY: &str = "UPDATE_BUSY";
const FAILED: &str = "UPDATE_REQUEST_FAILED";
const INSTALL_FAILED: &str = "UPDATE_INSTALL_FAILED";
const VERIFY_FAILED: &str = "UPDATE_VERIFY_FAILED";
const CANCELLED: &str = "UPDATE_CANCELLED";
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Status {
    Unconfigured,
    Idle,
    Checking,
    Latest,
    Available,
    Downloading,
    Downloaded,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Latest {
    pub version: String,
    pub url: String,
    pub published_at: Option<String>,
}

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    pub percent: f64,
    pub transferred: u64,
    pub total: u64,
    pub bytes_per_second: u64,
}

impl Progress {
    fn read(transferred: u64, total: u64, elapsed: Duration) -> Self {
        Self {
            transferred,
            total,
            percent: if total == 0 {
                0.0
            } else {
                (100.0 * transferred as f64 / total as f64).min(100.0)
            },
            bytes_per_second: if elapsed.is_zero() {
                0
            } else {
                (transferred as f64 / elapsed.as_secs_f64()) as u64
            },
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct View {
    pub supported: bool,
    pub status: Status,
    pub current: String,
    pub latest: Option<Latest>,
    pub progress: Option<Progress>,
    pub downloaded_at: Option<String>,
    pub checked_at: Option<String>,
    pub error: Option<&'static str>,
}

struct Ready {
    update: Update,
    file: File,
}

struct Inner {
    view: View,
    stop: Option<watch::Sender<bool>>,
    ready: Option<Ready>,
    installing: bool,
    closed: bool,
}

pub(crate) struct UpdateHost {
    updater: Option<Updater>,
    state: Mutex<Inner>,
    settled: Notify,
}

fn error_code(error: Error) -> &'static str {
    match error {
        Error::Reqwest(error) if error.is_connect() || error.is_timeout() => "UPDATE_OFFLINE",
        Error::Network(_) => "UPDATE_OFFLINE",
        Error::ReleaseNotFound => "UPDATE_NOT_PUBLISHED",
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => VERIFY_FAILED,
        _ => FAILED,
    }
}

fn secure_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn installer_url(url: &Url) -> bool {
    secure_url(url)
        && url.host_str() == Some("github.com")
        && url.path().starts_with(ASSET_PATH)
        && url.path().ends_with("-setup.exe")
}

fn client(builder: ClientBuilder) -> ClientBuilder {
    builder
        .no_proxy()
        .https_only(true)
        .redirect(Policy::custom(|attempt| {
            let url = attempt.url();
            let valid = secure_url(url)
                && match url.host_str() {
                    Some("github.com") => {
                        url.path().starts_with("/ydan120980-source/token/releases/")
                    }
                    Some(
                        "release-assets.githubusercontent.com" | "objects.githubusercontent.com",
                    ) => true,
                    _ => false,
                };
            if valid && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.error("Update redirect rejected")
            }
        }))
}

fn make_updater(app: &AppHandle) -> Option<Updater> {
    if !app.config().bundle.active || reader::is_probe(app) {
        return None;
    }
    let key = option_env!("QUOTADOCK_UPDATER_PUBLIC_KEY")?.trim();
    if key.is_empty() {
        return None;
    }
    let endpoint = Url::parse(FEED).ok()?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .ok()?
        .pubkey(key)
        .timeout(Duration::from_secs(20))
        .configure_client(client)
        .build()
        .ok()
}

fn publish(app: &AppHandle) {
    let _ = app.emit_to("main", EVENT, ());
}

impl UpdateHost {
    pub(crate) fn open(app: &AppHandle) -> Self {
        let updater = make_updater(app);
        let supported = updater.is_some();
        Self {
            updater,
            settled: Notify::new(),
            state: Mutex::new(Inner {
                view: View {
                    supported,
                    status: if supported {
                        Status::Idle
                    } else {
                        Status::Unconfigured
                    },
                    current: app.package_info().version.to_string(),
                    latest: None,
                    progress: None,
                    downloaded_at: None,
                    checked_at: None,
                    error: None,
                },
                stop: None,
                ready: None,
                installing: false,
                closed: false,
            }),
        }
    }

    fn change<T>(&self, change: impl FnOnce(&mut Inner) -> T) -> T {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        change(&mut state)
    }

    fn view(&self) -> View {
        self.change(|state| state.view.clone())
    }

    fn begin(&self) -> Result<Option<watch::Receiver<bool>>> {
        self.change(|state| {
            if state.closed || !state.view.supported {
                return Err(NOT_CONFIGURED);
            }
            if state.installing || state.stop.is_some() {
                return Err(BUSY);
            }
            if state.ready.is_some() {
                return Ok(None);
            }
            let (stop, wait) = watch::channel(false);
            state.stop = Some(stop);
            state.view.status = Status::Checking;
            state.view.error = None;
            state.view.progress = None;
            Ok(Some(wait))
        })
    }

    fn cancel(&self) -> Result<View> {
        self.change(|state| {
            if !state.view.supported || state.closed {
                return Err(NOT_CONFIGURED);
            }
            if state.view.status != Status::Downloading {
                return Err(NOT_READY);
            }
            let stop = state.stop.as_ref().ok_or(NOT_READY)?;
            let _ = stop.send(true);
            state.view.status = Status::Available;
            state.view.progress = None;
            state.view.error = None;
            Ok(state.view.clone())
        })
    }

    async fn transfer(&self, update: Update, app: &AppHandle) -> Result<Ready> {
        let request = client(reqwest::Client::builder())
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| FAILED)?;
        let mut response = request
            .get(update.download_url.clone())
            .header(reqwest::header::ACCEPT, "application/octet-stream")
            .send()
            .await
            .map_err(|_| "UPDATE_OFFLINE")?
            .error_for_status()
            .map_err(|_| FAILED)?;
        let total = response.content_length().unwrap_or(0);
        if total > MAX_PACKAGE || !secure_url(response.url()) {
            return Err(VERIFY_FAILED);
        }
        let file = tempfile::tempfile().map_err(|_| FAILED)?;
        let mut file = tokio::fs::File::from_std(file);
        let start = Instant::now();
        let mut changed_at = start;
        let mut transferred = 0;
        while let Some(bytes) = response.chunk().await.map_err(|_| "UPDATE_OFFLINE")? {
            transferred += bytes.len() as u64;
            if transferred > MAX_PACKAGE {
                return Err(VERIFY_FAILED);
            }
            file.write_all(&bytes).await.map_err(|_| FAILED)?;
            if changed_at.elapsed() >= Duration::from_millis(150) {
                self.change(|state| {
                    if state.view.status == Status::Downloading {
                        state.view.progress =
                            Some(Progress::read(transferred, total, start.elapsed()));
                    }
                });
                publish(app);
                changed_at = Instant::now();
            }
        }
        file.flush().await.map_err(|_| FAILED)?;
        let file = file.into_std().await;
        Ok(Ready { update, file })
    }

    async fn check_and_download(&self, app: &AppHandle) -> Result<Option<Ready>> {
        let Some(update) = self
            .updater
            .as_ref()
            .ok_or(NOT_CONFIGURED)?
            .check()
            .await
            .map_err(error_code)?
        else {
            return Ok(None);
        };
        if !installer_url(&update.download_url) || update.signature.is_empty() {
            return Err(VERIFY_FAILED);
        }
        self.change(|state| {
            state.view.status = Status::Downloading;
            state.view.checked_at = Some(iso_from_ms(now_ms()));
            state.view.latest = Some(Latest {
                version: update.version.clone(),
                url: format!("{RELEASES}{}", update.version),
                published_at: update.date.map(|date| {
                    iso_from_ms(date.unix_timestamp_nanos().div_euclid(1_000_000) as i64)
                }),
            });
            state.view.progress = Some(Progress::default());
        });
        publish(app);
        self.transfer(update, app).await.map(Some)
    }

    async fn transfer_task(&self, mut stop: watch::Receiver<bool>, app: &AppHandle) {
        let result = tokio::select! {
            biased;
            _ = stop.wait_for(|stop| *stop) => Err(CANCELLED),
            result = self.check_and_download(app) => result,
        };
        // Keep ownership until verification exits as well. A running
        // spawn_blocking check cannot be detached by a cancellation.
        let result = match result {
            Ok(Some(ready)) => tauri::async_runtime::spawn_blocking(move || {
                verified_bytes(&ready)?;
                Ok(Some(ready))
            })
            .await
            .unwrap_or(Err(FAILED)),
            other => other,
        };
        self.change(|state| {
            let canceled = state.closed || *stop.borrow();
            state.stop = None;
            if canceled || matches!(result, Err(CANCELLED)) {
                return;
            }
            let now = iso_from_ms(now_ms());
            match result {
                Ok(Some(ready)) => {
                    let length = ready.file.metadata().ok().map_or(0, |meta| meta.len());
                    let bytes_per_second = state
                        .view
                        .progress
                        .map_or(0, |progress| progress.bytes_per_second);
                    state.view.progress = Some(Progress {
                        percent: 100.0,
                        transferred: length,
                        total: length,
                        bytes_per_second,
                    });
                    state.view.downloaded_at = Some(now);
                    state.view.status = Status::Downloaded;
                    state.ready = Some(ready);
                }
                Ok(None) => {
                    state.view.status = Status::Latest;
                    state.view.latest = None;
                    state.view.checked_at = Some(now);
                }
                Err(error) => {
                    state.view.error = Some(error);
                    state.view.status = Status::Error;
                    state.view.progress = None;
                }
            }
        });
        self.settled.notify_waiters();
        publish(app);
    }

    pub(crate) async fn close(&self) {
        loop {
            let settled = self.settled.notified();
            let active = self.change(|state| {
                state.closed = true;
                state.ready = None;
                if let Some(stop) = &state.stop {
                    let _ = stop.send(true);
                    true
                } else {
                    false
                }
            });
            if !active {
                break;
            }
            settled.await;
        }
    }

    async fn wait_for_canceled_transfer(&self) {
        loop {
            let settled = self.settled.notified();
            if !self.change(|state| state.stop.as_ref().is_some_and(|stop| *stop.borrow())) {
                return;
            }
            settled.await;
        }
    }
}

fn verified_bytes(ready: &Ready) -> Result<Vec<u8>> {
    let mut file = ready.file.try_clone().map_err(|_| FAILED)?;
    file.rewind().map_err(|_| FAILED)?;
    let mut bytes = Vec::new();
    file.take(MAX_PACKAGE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| FAILED)?;
    if bytes.len() as u64 > MAX_PACKAGE || !bytes.starts_with(b"MZ") {
        return Err(VERIFY_FAILED);
    }
    ready.update.verify(&bytes).map_err(error_code)?;
    Ok(bytes)
}

fn begin(app: &AppHandle) -> Result<View> {
    let owner = app.state::<UpdateHost>();
    if let Some(stop) = owner.begin()? {
        publish(app);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            app.state::<UpdateHost>().transfer_task(stop, &app).await;
        });
    }
    Ok(owner.view())
}

pub(crate) fn start(app: &AppHandle) {
    if !app.state::<UpdateHost>().view().supported {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let owner = app.state::<UpdateHost>();
            if owner.change(|state| state.closed) {
                break;
            }
            if matches!(
                owner.view().status,
                Status::Idle | Status::Latest | Status::Error
            ) {
                let _ = begin(&app);
            }
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}

fn install(app: &AppHandle) -> Result<View> {
    let owner = app.state::<UpdateHost>();
    let ready = owner.change(|state| {
        if !state.view.supported || state.closed {
            return Err(NOT_CONFIGURED);
        }
        if state.installing {
            return Err(BUSY);
        }
        let ready = state.ready.take().ok_or(NOT_READY)?;
        state.installing = true;
        Ok(ready)
    })?;
    let result = (|| {
        let bytes = verified_bytes(&ready)?;
        reader::prepare_shutdown(app, false).map_err(|_| INSTALL_FAILED)?;
        if ready.update.install(bytes).is_err() {
            reader::allow_exit_retry(app);
            return Err(INSTALL_FAILED);
        }
        Ok(())
    })();
    owner.change(|state| {
        state.installing = false;
        if let Err(error) = result {
            state.view.error = Some(error);
            if error == VERIFY_FAILED {
                state.view.status = Status::Error;
                state.view.progress = None;
            } else {
                state.ready = Some(ready);
            }
        }
    });
    publish(app);
    result.map(|()| owner.view())
}

fn guard(window: &WebviewWindow) -> std::result::Result<AppHandle, String> {
    if window.label() != "main" {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    Ok(window.app_handle().clone())
}

fn reply(app: &AppHandle, result: Result<View>) -> Value {
    match result {
        Ok(state) => json!({"ok": true, "state": state}),
        Err(error) => {
            json!({"ok": false, "state": app.state::<UpdateHost>().view(), "error": error})
        }
    }
}

#[tauri::command]
pub(crate) fn update_get(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    Ok(reply(&app, Ok(app.state::<UpdateHost>().view())))
}

#[tauri::command]
pub(crate) async fn update_check(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    app.state::<UpdateHost>().wait_for_canceled_transfer().await;
    Ok(reply(&app, begin(&app)))
}

#[tauri::command]
pub(crate) fn update_cancel(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    let result = app.state::<UpdateHost>().cancel();
    if result.is_ok() {
        publish(&app);
    }
    Ok(reply(&app, result))
}

#[tauri::command]
pub(crate) async fn update_install(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    tauri::async_runtime::spawn_blocking(move || reply(&app, install(&app)))
        .await
        .map_err(|_| INSTALL_FAILED.to_owned())
}

#[tauri::command]
pub(crate) fn update_open(window: WebviewWindow, url: String) -> std::result::Result<bool, String> {
    let app = guard(&window)?;
    let latest = app.state::<UpdateHost>().view().latest;
    if reader::is_probe(&app) || !latest.is_some_and(|latest| latest.url == url) {
        return Ok(false);
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map(|_| true)
        .map_err(|_| FAILED.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_package_matches_the_announced_version_and_rejects_changed_bytes(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        use std::{io::Write, process::Command};
        let fixture = Command::new("node").args(["-e", r#"
const { generateKeyPairSync, sign } = require('node:crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const id = Buffer.alloc(8, 42);
const key = Buffer.concat([Buffer.from('Ed'), id, publicKey.export({format:'der',type:'spki'}).subarray(-32)]);
const comment = 'timestamp:42\tfile:fixture.exe\tversion:99.1.0';
const signed = sign(null, Buffer.from('MZsynthetic quota update'), privateKey);
const packed = Buffer.concat([Buffer.from('Ed'), id, signed]);
const global = sign(null, Buffer.concat([signed, Buffer.from(comment)]), privateKey);
const pubkey = Buffer.from('untrusted comment: synthetic\n' + key.toString('base64')).toString('base64');
const signature = Buffer.from(['untrusted comment: synthetic', packed.toString('base64'), 'trusted comment: ' + comment, global.toString('base64')].join('\n')).toString('base64');
process.stdout.write(JSON.stringify({pubkey, signature}));
"#]).output()?;
        assert!(fixture.status.success());
        let fixture: Value = serde_json::from_slice(&fixture.stdout)?;
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "pubkey": fixture["pubkey"],
                "requireSignedVersion": true
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)?;
        let updater = app
            .updater_builder()
            .endpoints(vec![Url::parse(FEED)?])?
            .pubkey(fixture["pubkey"].as_str().ok_or(VERIFY_FAILED)?)
            .build()?;
        let manifest = |version| {
            json!({
                "version": version, "signature": fixture["signature"],
                "url": "https://github.com/ydan120980-source/token/releases/download/v99.1.0/QuotaDock-setup.exe"
            })
        };
        let update = updater
            .restore_update(manifest("99.1.0"))?
            .ok_or(NOT_READY)?;
        let mut ready = Ready {
            update,
            file: tempfile::tempfile()?,
        };
        ready.file.write_all(b"MZsynthetic quota update")?;
        assert_eq!(verified_bytes(&ready)?, b"MZsynthetic quota update");
        ready.update = updater
            .restore_update(manifest("99.1.1"))?
            .ok_or(NOT_READY)?;
        assert_eq!(verified_bytes(&ready), Err(VERIFY_FAILED));
        ready.update = updater
            .restore_update(manifest("99.1.0"))?
            .ok_or(NOT_READY)?;
        ready.file.rewind()?;
        ready.file.write_all(b"MZsynthetic changed data")?;
        assert_eq!(verified_bytes(&ready), Err(VERIFY_FAILED));
        Ok(())
    }

    #[test]
    fn downloads_only_nsis_assets_from_our_release_repository(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        assert!(installer_url(&Url::parse("https://github.com/ydan120980-source/token/releases/download/v0.2.0/QuotaDock-setup.exe")?));
        for value in [
            "http://github.com/ydan120980-source/token/releases/download/v1/fake-setup.exe",
            "https://github.com/ydan120980-source/other/releases/download/v1/fake-setup.exe",
            "https://github.com/ydan120980-source/token/releases/download/v1/fake.msi",
            "https://user@github.com/ydan120980-source/token/releases/download/v1/fake-setup.exe",
        ] {
            assert!(!installer_url(&Url::parse(value)?));
        }
        Ok(())
    }

    #[test]
    fn cancellation_keeps_the_slot_until_the_download_task_finishes() -> Result<()> {
        let host = UpdateHost {
            updater: None,
            settled: Notify::new(),
            state: Mutex::new(Inner {
                view: View {
                    supported: true,
                    current: "0.1.8".into(),
                    status: Status::Idle,
                    latest: None,
                    progress: None,
                    checked_at: None,
                    downloaded_at: None,
                    error: None,
                },
                stop: None,
                ready: None,
                installing: false,
                closed: false,
            }),
        };
        let stop = host.begin()?.ok_or(NOT_READY)?;
        host.change(|state| state.view.status = Status::Downloading);
        assert!(host.cancel()?.status == Status::Available);
        assert!(*stop.borrow());
        assert!(matches!(host.begin(), Err(BUSY)));
        Ok(())
    }
}
