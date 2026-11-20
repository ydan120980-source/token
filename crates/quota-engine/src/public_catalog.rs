use reqwest::{redirect::Policy, Client};
use std::time::Duration;
use usage_engine::runtime_catalog;

const LIMIT: usize = 16 * 1024 * 1024;

/// A fixed public request. It accepts no paths, credentials, or caller URL.
pub async fn price_catalog_bytes() -> Result<Vec<u8>, String> {
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .retry(reqwest::retry::never())
        .https_only(true)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
    let mut response = client
        .get(runtime_catalog::URL)
        .header("Accept", "application/json")
        .header("User-Agent", "AgentUsage-prices/1")
        .send()
        .await
        .map_err(|_| "PRICE_DOWNLOAD_FAILED")?;
    if response.status() != reqwest::StatusCode::OK {
        return Err("PRICE_DOWNLOAD_FAILED".to_owned());
    }
    let mut body = Vec::new();
    while let Some(bytes) = response
        .chunk()
        .await
        .map_err(|_| "PRICE_DOWNLOAD_FAILED")?
    {
        if body.len() + bytes.len() > LIMIT {
            return Err("PRICE_DOWNLOAD_FAILED".to_owned());
        }
        body.extend_from_slice(&bytes);
    }
    Ok(body)
}
