use crate::connection_state::{project_connections, Inputs};
use serde_json::{json, Value};
use usage_engine::normalize::truthy;

const STATES: [&str; 4] = ["fresh", "stale", "cached", "missing"];

pub fn project_resource_connections(input: Inputs<'_>) -> Value {
    let mut view = project_connections(input);
    view["schemaVersion"] = json!("SourceConnectionsV2");
    let (Some(rows), Some(accounts)) = (
        view["rows"].as_array_mut(),
        input.quota["accounts"].as_array(),
    ) else {
        return view;
    };
    for row in rows {
        if row["quota"]["capability"] != "supported" {
            continue;
        }
        let mut freshness = [0; 4];
        let mut resources = [0.0; 4];
        let mut partial = 0;
        for account in accounts
            .iter()
            .filter(|account| account["provider"] == row["agent"])
            .take(20)
        {
            let quota = &account["quota"];
            let coverage = &quota["coverage"];
            if truthy(&quota["partial"]) {
                partial += 1;
            }
            if !truthy(coverage) {
                freshness[3] += 1;
                continue;
            }
            for (index, key) in STATES.iter().enumerate() {
                resources[index] += coverage[*key].as_f64().unwrap_or(f64::NAN);
            }
            let bucket = if !truthy(&quota["hasMeasurements"]) {
                3
            } else if truthy(&coverage["stale"]) {
                1
            } else if truthy(&coverage["cached"]) {
                2
            } else if truthy(&coverage["missing"]) || !truthy(&coverage["fresh"]) {
                3
            } else {
                0
            };
            freshness[bucket] += 1;
        }
        row["quota"]["freshness"] = json!({"fresh":freshness[0],"stale":freshness[1],
            "cached":freshness[2],"missing":freshness[3]});
        row["quota"]["resourceCoverage"] = json!({"fresh":resources[0],"stale":resources[1],
            "cached":resources[2],"missing":resources[3]});
        row["quota"]["partialConnections"] = json!(partial);
    }
    view
}
