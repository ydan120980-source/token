use crate::{agent_catalog::is_builtin, local_snapshot::date_shape};
use serde::Serialize;
use serde_json::{Number, Value};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncPayload<'a> {
    pub schema_version: &'static str,
    pub device: &'a str,
    pub synced_at: &'a str,
    pub timezone: Option<&'a str>,
    pub days: Vec<Day<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day<'a> {
    pub date: &'a str,
    pub agent: &'a str,
    pub model: String,
    pub total_tokens: Option<&'a Number>,
    pub input_uncached: Option<&'a Number>,
    pub output: Option<&'a Number>,
    pub cache_read: Option<&'a Number>,
    pub cache_write: Option<&'a Number>,
    pub reasoning: Option<&'a Number>,
    pub records: Option<&'a Number>,
    pub estimated_cost_usd: Option<&'a Number>,
    pub estimated_cost_upper_usd: Option<&'a Number>,
}

fn known(value: &Value) -> Option<&Number> {
    value
        .as_number()
        .filter(|number| number.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0))
}

fn truncate_model(model: &str) -> String {
    let mut units = 0;
    model
        .chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= 200
        })
        .collect()
}

/// Projects only the fields that may leave the machine when the user requests a sync.
pub fn payload<'a>(
    snapshot: &'a Value,
    device: &'a str,
    synced_at: &'a str,
) -> Result<GithubSyncPayload<'a>, &'static str> {
    let daily = snapshot["daily"]
        .as_array()
        .ok_or("GITHUB_SYNC_SNAPSHOT_INVALID")?;
    let catalog = &snapshot["sourceCatalog"];
    let days = daily
        .iter()
        .filter_map(|row| {
            let day = row.get("date");
            let agent = row["agent"].as_str()?;
            if !date_shape(day) || !is_builtin(agent) || catalog[agent]["custom"] == true {
                return None;
            }
            Some(Day {
                date: day?.as_str()?,
                agent,
                model: truncate_model(row["model"].as_str().unwrap_or("模型未记录")),
                total_tokens: known(&row["totalTokens"]),
                input_uncached: known(&row["inputUncached"]),
                output: known(&row["output"]),
                cache_read: known(&row["cacheRead"]),
                cache_write: known(&row["cacheWrite"]),
                reasoning: known(&row["reasoning"]),
                records: known(&row["records"]),
                estimated_cost_usd: known(&row["estimatedCostUsd"]),
                estimated_cost_upper_usd: known(&row["estimatedCostUpperUsd"]),
            })
        })
        .collect();
    Ok(GithubSyncPayload {
        schema_version: "AgentUsageSyncV1",
        device,
        synced_at,
        timezone: snapshot["timezone"].as_str(),
        days,
    })
}
