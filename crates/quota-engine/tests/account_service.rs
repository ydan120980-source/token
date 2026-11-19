#![cfg(windows)]

use quota_engine::{
    account_service::{AccountError, AccountService, ManualConnect, ReadResult},
    provider_adapters::{from_provider, AdapterOptions},
    provider_http::ProviderHttpError,
    provider_observation::{Observation, ObservationError},
};
use serde_json::{json, Value};
use std::{fs, future::pending, sync::Arc, time::Duration};
use tokio::sync::oneshot;
use usage_engine::time::{iso_from_ms, now_ms};

fn manual(remember: bool) -> ManualConnect {
    serde_json::from_value(
        json!({"adapter":"deepseek-api","alias":"Synthetic","credential":"synthetic-key",
        "remember":remember}),
    )
    .expect("synthetic request")
}

fn observation() -> Result<ReadResult, ObservationError> {
    let resources = from_provider(
        "deepseek-api",
        &json!({"is_available":true,"balance_infos":[
        {"currency":"USD","total_balance":"9007199254740993.125"}]}),
        &json!(iso_from_ms(now_ms())),
        AdapterOptions::default(),
    )?;
    Ok(ReadResult {
        observation: Observation {
            resources,
            identity_context: None,
        },
        renewed: None,
    })
}

#[tokio::test]
async fn persisted_credentials_and_cached_observations_survive_restart_without_a_read(
) -> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let service = AccountService::open(root.path())?;
    service
        .connect(manual(true), |_| async { observation() })
        .await?;
    service
        .connect(manual(false), |_| async { observation() })
        .await?;
    let state = service.provider_state(now_ms())?;
    assert_eq!(state["accounts"][0]["status"], "ready");
    assert_eq!(state["accounts"][0]["duplicateKnown"], true);
    assert_eq!(state["accounts"][1]["remembered"], false);
    assert!(!state.to_string().contains("synthetic-key"));
    let bytes = fs::read(root.path().join("quota-accounts.json"))?;
    assert!(!String::from_utf8_lossy(&bytes).contains("synthetic-key"));
    service.close().await?;
    let service = AccountService::open(root.path())?;
    let state = service.provider_state(now_ms())?;
    assert_eq!(state["accounts"][0]["status"], "cached");
    assert_eq!(state["accounts"][0]["credentialReady"], true);
    assert_eq!(state["accounts"][0]["duplicateKnown"], false);
    assert_eq!(state["accounts"][1]["credentialReady"], false);
    assert_eq!(
        state["accounts"][0]["quota"]["pools"][0]["balances"][0]["remaining"],
        "9007199254740993.125"
    );
    assert_eq!(service.refreshable()?.len(), 1);
    Ok(())
}

#[tokio::test]
async fn failed_and_late_observations_cannot_overwrite_persisted_state(
) -> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let service = Arc::new(AccountService::open(root.path())?);
    assert!(service
        .connect(manual(true), |_| async {
            Err(ProviderHttpError::RequestFailed.into())
        })
        .await
        .is_err());
    assert_eq!(service.provider_state(now_ms())?["accounts"], json!([]));
    service
        .connect(manual(true), |_| async { observation() })
        .await?;
    let initial = service.provider_state(now_ms())?;
    let id = initial["accounts"][0]["id"]
        .as_str()
        .expect("account ID")
        .to_owned();
    service
        .refresh(&id, |_| async {
            Err(ProviderHttpError::RateLimited.into())
        })
        .await?;
    let rate_limited = service.provider_state(now_ms())?;
    assert_eq!(
        rate_limited["accounts"][0]["errorCode"],
        "PROVIDER_RATE_LIMITED"
    );
    assert_eq!(
        rate_limited["accounts"][0]["quota"]["fetchedAt"],
        initial["accounts"][0]["quota"]["fetchedAt"]
    );
    service
        .supply(&id, manual(true), |_| async { observation() })
        .await?;
    let (started, active) = oneshot::channel();
    let worker = tokio::spawn({
        let service = Arc::clone(&service);
        let id = id.clone();
        async move {
            service
                .refresh(&id, |_| async {
                    let _ = started.send(());
                    pending().await
                })
                .await
        }
    });
    active.await?;
    service.remove(&id)?;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), worker).await??,
        Err(AccountError::Canceled)
    ));
    assert_eq!(service.provider_state(now_ms())?["accounts"], json!([]));
    service.close().await?;
    assert_eq!(
        AccountService::open(root.path())?.provider_state(now_ms())?["accounts"],
        json!([])
    );
    Ok(())
}

#[test]
fn import_deduplicates_by_id_and_preserves_the_old_bytes() -> Result<(), Box<dyn std::error::Error>>
{
    let old = tempfile::tempdir()?;
    let destination = tempfile::tempdir()?;
    let account_dir = old.path().join("provider-quotas");
    fs::create_dir(&account_dir)?;
    let input = json!({"schemaVersion":"ProviderQuotaCacheV1","connections":[
        {"id":"11111111-2222-4333-8444-555555555555","adapter":"deepseek-api","alias":"Legacy","quota":null}]});
    let original = serde_json::to_vec(&input)?;
    fs::write(account_dir.join("connections.json"), &original)?;
    let service = AccountService::open(destination.path())?;
    let result = service.import(old.path(), now_ms())?;
    assert_eq!(
        (
            result.imported,
            result.credentials_restored,
            result.login_required
        ),
        (1, 0, 1)
    );
    let next = service.import(old.path(), now_ms())?;
    assert_eq!((next.imported, next.skipped), (0, 1));
    assert_eq!(fs::read(account_dir.join("connections.json"))?, original);
    let state: Value = service.provider_state(now_ms())?;
    assert_eq!(state["accounts"][0]["status"], "login-required");
    assert_eq!(state["accounts"][0]["quota"], Value::Null);
    Ok(())
}
