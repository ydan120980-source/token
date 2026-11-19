use crate::{
    agent_catalog::builtin_agents,
    cost_table::{self, text, GroupBy},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{error::Error, fmt};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub by: GroupBy,
    pub from: Option<String>,
    pub to: Option<String>,
    pub previous_from: Option<String>,
    pub previous_to: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub csv: String,
    pub rows: usize,
    pub file_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExportRejected;

impl fmt::Display for ExportRejected {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("EXPORT_REJECTED")
    }
}

impl Error for ExportRejected {}

#[derive(Clone, Copy)]
struct Window<'a> {
    from: &'a str,
    to: &'a str,
}

fn date_shape(date: &str) -> bool {
    date.len() == 10
        && date.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

fn window<'a>(
    from: Option<&'a str>,
    to: Option<&'a str>,
) -> Result<Option<Window<'a>>, ExportRejected> {
    match (from, to) {
        (None, None) => Ok(None),
        (Some(from), Some(to)) if from <= to && date_shape(from) && date_shape(to) => {
            Ok(Some(Window { from, to }))
        }
        _ => Err(ExportRejected),
    }
}

/// Rebuild the CSV exclusively from the main process's snapshot; request data selects windows only.
///
/// # Errors
/// Returns `EXPORT_REJECTED` for an unsupported grouping or invalid date window.
pub fn cost_export(snapshot: &Value, request: &Value) -> Result<ExportResult, ExportRejected> {
    if !request.is_object() {
        return Err(ExportRejected);
    }
    let request = ExportRequest::deserialize(request).map_err(|_| ExportRejected)?;
    let range = window(request.from.as_deref(), request.to.as_deref())?;
    let previous = window(
        request.previous_from.as_deref(),
        request.previous_to.as_deref(),
    )?;
    let daily = snapshot["daily"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let inside = |row: &Value, span: Option<Window<'_>>| {
        span.is_none_or(|span| {
            let date = text(&row["date"]);
            date >= span.from && date <= span.to
        })
    };
    let items = cost_table::table_from_rows(
        daily.iter().filter(|row| inside(row, range)),
        request.by,
        previous.map(|span| daily.iter().filter(move |row| inside(row, Some(span)))),
    );
    let (label, suffix) = match range {
        Some(span) => (
            if span.from == span.to {
                span.from.to_owned()
            } else {
                format!("{} 至 {}", span.from, span.to)
            },
            format!("{}_{}", span.from, span.to),
        ),
        None => ("累计".to_owned(), "all".to_owned()),
    };
    let agents = builtin_agents();
    let csv = cost_table::csv(
        &items,
        request.by,
        &label,
        |id| {
            [
                text(&snapshot["sourceCatalog"][id]["name"]),
                text(&agents[id]["name"]),
                id,
            ]
            .into_iter()
            .find(|name| !name.is_empty())
            .unwrap_or_default()
            .to_owned()
        },
        |model| {
            if model == "unknown" {
                "模型未记录".to_owned()
            } else {
                model.to_owned()
            }
        },
    );
    Ok(ExportResult {
        csv,
        rows: items.len(),
        file_name: format!("AgentUsage-cost-{suffix}.csv"),
    })
}
