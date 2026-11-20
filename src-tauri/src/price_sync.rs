use super::{blocking, main_window_app, Reader, MAIN};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{BufReader, Read},
    path::Path,
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::sync::{watch, Notify};
use usage_engine::{
    runtime_catalog,
    store::Store,
    time::{iso_from_ms, now_ms, parse_iso},
};

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const RETRY_MS: i64 = 60 * 60 * 1000;
type Outcome = Result<Value, String>;
type Reply = watch::Receiver<Option<Outcome>>;

#[derive(Default)]
struct State {
    flight: Option<Reply>,
    last_attempt: Option<String>,
    error: Option<String>,
    next_attempt: Option<i64>,
    closed: bool,
}

#[derive(Default)]
pub(super) struct PriceSync {
    state: Mutex<State>,
    shutdown: Notify,
    changed: Notify,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PriceSyncReply<'a> {
    pub enabled: bool,
    pub syncing: bool,
    pub last_attempt: Option<&'a str>,
    pub error: Option<&'a str>,
    pub last_success: Option<&'a str>,
    pub built_in_at: Option<&'a str>,
    pub model_count: usize,
}

fn catalog_time(store: &Store) -> Option<&str> {
    store.remote_catalog.as_ref()?.get("obtainedAt")?.as_str()
}

fn model_count(catalog: &Value) -> usize {
    catalog["models"]
        .as_object()
        .map_or(0, |models| models.len())
}

fn enabled(store: &Store) -> bool {
    store.billing["autoSync"] == true
}

fn status(state: &State, store: &Store) -> Value {
    let built_in_at = catalog_time(store);
    json!(PriceSyncReply {
        enabled: enabled(store),
        syncing: state.flight.is_some(),
        last_attempt: state.last_attempt.as_deref(),
        error: state.error.as_deref(),
        last_success: store.downloaded_catalog.then_some(built_in_at).flatten(),
        built_in_at,
        model_count: store.remote_catalog.as_ref().map_or(0, model_count),
    })
}

impl PriceSync {
    pub(super) fn status(&self, store: &Store) -> Result<Value, String> {
        self.state
            .lock()
            .map(|state| status(&state, store))
            .map_err(|_| "PRICE_DOWNLOAD_FAILED".to_owned())
    }

    pub(super) fn reschedule(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.next_attempt = None;
        }
        self.changed.notify_one();
    }
}

async fn wait_reply(mut reply: Reply) -> Outcome {
    loop {
        if let Some(value) = reply.borrow().as_ref().cloned() {
            return value;
        }
        reply.changed().await.map_err(|_| "PRICE_SYNC_CLOSED")?;
    }
}

async fn synchronize(app: AppHandle) -> Outcome {
    let reply = {
        let reader = app.state::<Reader>();
        if reader.probe {
            return Err("PRICE_SYNC_OFFLINE_FIXTURE".to_owned());
        }
        let mut state = reader
            .price_sync
            .state
            .lock()
            .map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
        if state.closed {
            return Err("PRICE_SYNC_CLOSED".to_owned());
        }
        if let Some(reply) = &state.flight {
            reply.clone()
        } else {
            let (complete, reply) = watch::channel(None);
            state.flight = Some(reply.clone());
            state.last_attempt = Some(iso_from_ms(now_ms()));
            state.error = None;
            let app = app.clone();
            tauri::async_runtime::spawn(async move { drive(app, complete).await });
            reply
        }
    };
    wait_reply(reply).await
}

fn install_candidate(store: &mut Store, catalog: &Value) -> Result<(), String> {
    if model_count(catalog) * 2 < store.remote_catalog.as_ref().map_or(0, model_count) {
        return Err("PRICE_DOWNLOAD_INCOMPLETE".to_owned());
    }
    store
        .install_catalog(catalog)
        .map_err(|_| "PRICE_DOWNLOAD_SCHEMA".to_owned())
}

async fn drive(app: AppHandle, complete: watch::Sender<Option<Outcome>>) {
    let _ = app.emit_to(MAIN, "usage:update", ());
    let reader = app.state::<Reader>();
    let bytes = tokio::select! {
        _ = reader.price_sync.shutdown.notified() => Err("PRICE_SYNC_CLOSED".to_owned()),
        result = quota_engine::public_catalog::price_catalog_bytes() => result,
    };
    let result = blocking(app.clone(), move |reader| {
        let bytes = bytes?;
        let text = std::str::from_utf8(&bytes).map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
        let catalog = runtime_catalog::parse(text, &iso_from_ms(now_ms()))?;
        // Use the same owner as open_main() so a concurrent window can only
        // load the catalog before or after the atomic write, never midway.
        let mut owner = reader.store.lock().map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
        let state = reader
            .price_sync
            .state
            .lock()
            .map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
        if state.closed {
            return Err("PRICE_SYNC_CLOSED".to_owned());
        }
        if let Some(store) = owner.as_mut() {
            install_candidate(store, &catalog)?;
            let mut reply = status(&state, store);
            reply["syncing"] = json!(false);
            return Ok(reply);
        }
        let mut reply = Store::install_catalog_in_directory(&reader.usage_dir, &catalog)?;
        reply["syncing"] = json!(false);
        reply["lastAttempt"] = json!(state.last_attempt);
        reply["error"] = Value::Null;
        Ok(reply)
    })
    .await;
    if let Ok(mut state) = reader.price_sync.state.lock() {
        state.error = result.as_ref().err().cloned();
        state.next_attempt = Some(now_ms() + if result.is_ok() { DAY_MS } else { RETRY_MS });
        let _ = complete.send(Some(result));
        state.flight = None;
    }
    let _ = app.emit_to(MAIN, "usage:update", ());
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    obtained_at: String,
}

fn disk_schedule(dir: &Path, now: i64) -> i64 {
    let enabled = File::open(dir.join("billing.json")).map_or_else(
        |error| error.kind() == std::io::ErrorKind::NotFound,
        |file| {
            serde_json::from_reader::<_, Value>(BufReader::new(file).take(1024 * 1024))
                .is_ok_and(|billing| billing["autoSync"] == true)
        },
    );
    if !enabled {
        return i64::MAX;
    }
    let stamp = File::open(dir.join("model-pricing.json"))
        .ok()
        .and_then(|file| {
            serde_json::from_reader::<_, Stamp>(BufReader::new(file).take(16 * 1024 * 1024)).ok()
        })
        .and_then(|stamp| parse_iso(&stamp.obtained_at));
    stamp.map_or(now, |stamp| stamp.saturating_add(DAY_MS))
}

fn next_attempt(reader: &Reader) -> Result<Option<i64>, String> {
    let store = reader.store.lock().map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
    let mut state = reader
        .price_sync
        .state
        .lock()
        .map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
    if state.closed {
        return Ok(None);
    }
    let next = *state.next_attempt.get_or_insert_with(|| {
        let now = now_ms();
        if let Some(store) = store.as_ref() {
            if !enabled(store) {
                return i64::MAX;
            }
            let stamp = if store.downloaded_catalog {
                catalog_time(store).and_then(parse_iso)
            } else {
                None
            };
            return stamp.map_or(now, |stamp| stamp.saturating_add(DAY_MS));
        }
        disk_schedule(&reader.usage_dir, now)
    });
    Ok(Some(next))
}

pub(super) fn start(app: &AppHandle) {
    if app.state::<Reader>().probe {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        loop {
            let reader = app.state::<Reader>();
            let wake = &reader.price_sync.changed;
            let Ok(Some(next)) = blocking(app.clone(), next_attempt).await else {
                break;
            };
            if next == i64::MAX {
                wake.notified().await;
            } else {
                let remaining = next.saturating_sub(now_ms()).min(DAY_MS);
                if remaining > 0 {
                    tokio::select! {
                        _ = wake.notified() => {},
                        _ = tokio::time::sleep(Duration::from_millis(remaining as u64)) => {},
                    }
                } else {
                    let _ = synchronize(app.clone()).await;
                }
            }
        }
    });
}

pub(super) async fn close(app: &AppHandle) {
    let reader = app.state::<Reader>();
    let reply = {
        let Ok(mut state) = reader.price_sync.state.lock() else {
            return;
        };
        state.closed = true;
        state.flight.clone()
    };
    reader.price_sync.shutdown.notify_one();
    reader.price_sync.changed.notify_one();
    if let Some(reply) = reply {
        let _ = wait_reply(reply).await;
    }
}

#[tauri::command]
pub(super) async fn usage_price_sync(window: WebviewWindow) -> Outcome {
    synchronize(main_window_app(&window)?).await
}

#[tauri::command]
pub(super) async fn usage_price_auto(window: WebviewWindow, enabled: bool) -> Outcome {
    let app = main_window_app(&window)?;
    let result = blocking(app.clone(), move |reader| {
        reader.with_store(|store| {
            let mut value = store.billing.clone();
            value["autoSync"] = json!(enabled);
            store.set_billing(&value)?;
            reader.price_sync.reschedule();
            reader.price_sync.status(store)
        })
    })
    .await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cold_tray_schedule_uses_only_price_files_and_honors_opt_out(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let fixture = tempfile::tempdir()?;
        let now = now_ms();
        assert_eq!(disk_schedule(fixture.path(), now), now);
        std::fs::write(
            fixture.path().join("statistics.json"),
            b"invalid ledger sentinel",
        )?;
        let catalog = runtime_catalog::embedded();
        let status = Store::install_catalog_in_directory(fixture.path(), catalog)?;
        assert!(status["modelCount"].as_u64().is_some_and(|count| count > 0));
        assert_eq!(
            std::fs::read(fixture.path().join("statistics.json"))?,
            b"invalid ledger sentinel"
        );
        std::fs::write(fixture.path().join("billing.json"), b"{\"autoSync\":false}")?;
        assert_eq!(disk_schedule(fixture.path(), now), i64::MAX);
        Ok(())
    }

    #[test]
    fn incomplete_price_catalog_preserves_last_good_state() -> Result<(), Box<dyn std::error::Error>>
    {
        let fixture = tempfile::tempdir()?;
        let mut store = Store::new(fixture.path().to_str().ok_or("fixture path")?, &json!({}))?;
        let before = PriceSync::default().status(&store)?;
        assert!(before["modelCount"].as_u64().is_some_and(|count| count > 0));
        assert_eq!(
            install_candidate(&mut store, &json!({"models":{}})).unwrap_err(),
            "PRICE_DOWNLOAD_INCOMPLETE"
        );
        assert_eq!(PriceSync::default().status(&store)?, before);
        assert!(!fixture.path().join("model-pricing.json").exists());
        Ok(())
    }
}
