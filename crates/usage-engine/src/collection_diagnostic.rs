use serde::Serialize;
use serde_json::Value;

const STAGES: &[&str] = &[
    "source-watch",
    "source-stamp",
    "source-refresh",
    "source-scan",
    "native-verification",
    "custom-source",
    "discovery",
    "worker",
    "collection",
    "ingest",
    "maintenance",
];
const OS: &[&str] = &[
    "EACCES",
    "EPERM",
    "ENOENT",
    "ENOSPC",
    "EMFILE",
    "ENFILE",
    "EIO",
    "EBUSY",
    "EROFS",
    "ENOTDIR",
    "EISDIR",
    "EINVAL",
    "ETIMEDOUT",
];
const NATIVE: &[&str] = &[
    "NATIVE_UNAVAILABLE",
    "NATIVE_BINARY_MISMATCH",
    "NATIVE_TIMEOUT",
    "NATIVE_OUTPUT_LIMIT",
    "NATIVE_FAILED",
    "NATIVE_SCHEMA_MISMATCH",
    "NATIVE_TOTAL_MISMATCH",
];
const CONTRACT: &[&str] = &[
    "CONTROLLED_ERROR",
    "COLLECTION_TIMEOUT",
    "COLLECTION_WORKER_FAILED",
];
const ERRORS: &[&str] = &[
    "COLLECTION_FAILED",
    "COLLECTION_TIMEOUT",
    "COLLECTION_WORKER_FAILED",
    "DISCOVERY_FAILED",
    "DISCOVERY_TIMEOUT",
    "MAINTENANCE_BUSY",
    "MAINTENANCE_INCOMPLETE",
    "MAINTENANCE_STALE",
    "LOCAL_STORAGE_INVALID",
    "SOURCE_PARSE_FAILED",
    "SOURCE_UNREADABLE",
    "SOURCE_LIMIT",
    "SOURCE_TIMEOUT",
    "SOURCE_BUSY",
    "SOURCE_SIZE_OR_LINK",
    "SOURCE_PATH_REJECTED",
    "SOURCE_SYMLINK_REJECTED",
    "SOURCE_ALIAS_REJECTED",
    "SOURCE_PRODUCT_OVERLAP",
    "CUSTOM_CONFIG_INVALID",
    "CUSTOM_FIELD_INVALID",
    "CUSTOM_COUNTER_UNSUPPORTED",
    "CUSTOM_LINE_LIMIT",
    "CUSTOM_INCOMPLETE_LINE",
    "CUSTOM_ROOT_REQUIRED",
    "CUSTOM_SOURCE_OVERLAP",
    "DATABASE_SCHEMA_UNSUPPORTED",
    "CURSOR_CSV_INVALID",
    "CURSOR_CSV_SCHEMA",
    "SOURCE_COMPRESSION_UNSUPPORTED",
    "SOURCE_COMPRESSION_INVALID",
    "INCOMPLETE_FRAME",
    "INVALID_FRAME",
    "DEEPSEEK_FORMAT_UNSUPPORTED",
    "DEEPSEEK_SEED_INVALID",
];

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDiagnostic {
    pub stage: &'static str,
    pub category: &'static str,
    pub reason: &'static str,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionFailure {
    pub error: &'static str,
    pub diagnostic: CollectionDiagnostic,
}

fn allowed(table: &'static [&str], value: Option<&str>) -> Option<&'static str> {
    let value = value?;
    table.iter().copied().find(|entry| *entry == value)
}

fn error_code(message: Option<&str>) -> Option<&'static str> {
    allowed(ERRORS, message)
        .or_else(|| allowed(OS, message))
        .or_else(|| allowed(NATIVE, message))
}

pub fn classify(error: &Value, stage: &str) -> CollectionDiagnostic {
    let stage = allowed(STAGES, Some(stage)).unwrap_or("collection");
    let message = error["message"].as_str();
    let os_reason = [
        error["code"].as_str(),
        error["cause"]["code"].as_str(),
        message,
    ]
    .into_iter()
    .find_map(|value| allowed(OS, value));
    let (category, reason) = if let Some(reason) = os_reason {
        ("os", reason)
    } else if let Some(reason) = allowed(NATIVE, message) {
        ("native", reason)
    } else if error_code(message).is_some() {
        (
            "contract",
            allowed(CONTRACT, message).unwrap_or("CONTROLLED_ERROR"),
        )
    } else {
        ("unknown", "UNKNOWN")
    };
    CollectionDiagnostic {
        stage,
        category,
        reason,
    }
}

pub fn sanitize(value: &Value) -> Option<CollectionDiagnostic> {
    let stage = allowed(STAGES, value["stage"].as_str())?;
    let (category, reasons) = match value["category"].as_str()? {
        "os" => ("os", OS),
        "native" => ("native", NATIVE),
        "contract" => ("contract", CONTRACT),
        "unknown" => ("unknown", &["UNKNOWN"][..]),
        _ => return None,
    };
    let reason = allowed(reasons, value["reason"].as_str())?;
    Some(CollectionDiagnostic {
        stage,
        category,
        reason,
    })
}

pub fn failure(error: &Value, stage: &str, fallback: &'static str) -> CollectionFailure {
    CollectionFailure {
        error: error_code(error["message"].as_str()).unwrap_or(fallback),
        diagnostic: classify(error, stage),
    }
}

pub fn from_message(value: &Value, stage: &str, fallback: &'static str) -> CollectionFailure {
    let error = error_code(value["error"].as_str()).unwrap_or(fallback);
    let diagnostic = sanitize(&value["diagnostic"])
        .unwrap_or_else(|| classify(&serde_json::json!({"message": error}), stage));
    CollectionFailure { error, diagnostic }
}
