use crate::{
    provider_adapters::{from_provider, AdapterError, AdapterOptions},
    provider_context as context,
    provider_http::{ProviderHttp, ProviderHttpError, ReadOptions},
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fmt};
use tokio::sync::watch;
use usage_engine::{
    js_json::stringify,
    normalize::truthy,
    time::{iso_from_ms, now_ms},
};

const MAX_PACKAGE_PAGES: u8 = 10;
const MAX_PAGE_PACKAGES: usize = 100;
const MAX_PACKAGE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservationError {
    Http(ProviderHttpError),
    Adapter(AdapterError),
    OrganizationRequired,
    ClientUnsupported,
}

impl fmt::Display for ObservationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(error) => error.fmt(formatter),
            Self::Adapter(error) => error.fmt(formatter),
            Self::OrganizationRequired => formatter.write_str("PROVIDER_ORGANIZATION_REQUIRED"),
            Self::ClientUnsupported => formatter.write_str("PROVIDER_CLIENT_UNSUPPORTED"),
        }
    }
}

impl std::error::Error for ObservationError {}
impl From<ProviderHttpError> for ObservationError {
    fn from(error: ProviderHttpError) -> Self {
        Self::Http(error)
    }
}
impl From<AdapterError> for ObservationError {
    fn from(error: AdapterError) -> Self {
        Self::Adapter(error)
    }
}

/// Internal outcome. Only the resources belong in IPC or the quota cache.
pub struct Observation {
    pub resources: Value,
    pub identity_context: Option<Value>,
}

trait Transport {
    async fn read(
        &self,
        adapter: &str,
        credential: &str,
        options: ReadOptions<'_>,
        cancellation: &mut watch::Receiver<bool>,
    ) -> Result<Value, ProviderHttpError>;
}

impl Transport for ProviderHttp {
    async fn read(
        &self,
        adapter: &str,
        credential: &str,
        options: ReadOptions<'_>,
        cancellation: &mut watch::Receiver<bool>,
    ) -> Result<Value, ProviderHttpError> {
        self.read(adapter, credential, options, cancellation).await
    }
}

pub async fn observe_provider(
    http: &ProviderHttp,
    adapter: &str,
    credential: &str,
    project: Option<&Value>,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<Observation, ObservationError> {
    observe(http, adapter, credential, project, cancellation, now_ms).await
}

async fn observe(
    transport: &impl Transport,
    adapter: &str,
    credential: &str,
    project: Option<&Value>,
    cancellation: &mut watch::Receiver<bool>,
    clock: impl Fn() -> i64,
) -> Result<Observation, ObservationError> {
    let mut identity_context = None;
    let mut complete_packages = false;
    let raw = match adapter {
        "claude-web" | "opencode-web" => {
            let choices = transport
                .read(
                    adapter,
                    credential,
                    ReadOptions {
                        project,
                        ..Default::default()
                    },
                    cancellation,
                )
                .await?;
            let option = if adapter == "claude-web" {
                "organization"
            } else {
                "workspace"
            };
            let selected = select_scope(
                adapter,
                &choices,
                project.and_then(|project| project.get(option)),
            )?;
            let scope = if adapter == "claude-web" {
                json!({"organization":selected})
            } else {
                json!({"workspace":selected})
            };
            let options = if adapter == "claude-web" {
                ReadOptions {
                    organization: Some(selected),
                    ..Default::default()
                }
            } else {
                ReadOptions {
                    part: Some("usage"),
                    project: Some(&scope),
                    ..Default::default()
                }
            };
            let raw = transport
                .read(adapter, credential, options, cancellation)
                .await?;
            identity_context = Some(scope);
            raw
        }
        "gemini-code-assist" => {
            let needs_discovery = project.is_some_and(|project| project["discover"] == true);
            let bootstrap = if needs_discovery {
                transport
                    .read(
                        adapter,
                        credential,
                        ReadOptions {
                            part: Some("bootstrap"),
                            ..Default::default()
                        },
                        cancellation,
                    )
                    .await?
            } else {
                Value::Null
            };
            if bootstrap["isClientUnsupported"] == true {
                return Err(ObservationError::ClientUnsupported);
            }
            let selected = &bootstrap["cloudaicompanionProject"];
            let resolved = if selected.is_string() {
                Some(selected)
            } else {
                selected.get("id").filter(|id| id.is_string())
            };
            let project = resolved.or(project);
            let raw = transport
                .read(
                    adapter,
                    credential,
                    ReadOptions {
                        project,
                        ..Default::default()
                    },
                    cancellation,
                )
                .await?;
            identity_context = project.filter(|project| project.is_string()).cloned();
            raw
        }
        "mimo-web" => {
            let balance = transport
                .read(
                    adapter,
                    credential,
                    ReadOptions {
                        project,
                        ..Default::default()
                    },
                    cancellation,
                )
                .await?;
            let mut raw = json!({"balance":balance, "plan":null, "usage":null});
            for part in ["plan", "usage"] {
                match transport
                    .read(
                        adapter,
                        credential,
                        ReadOptions {
                            part: Some(part),
                            ..Default::default()
                        },
                        cancellation,
                    )
                    .await
                {
                    Ok(value) => raw[part] = value,
                    Err(error)
                        if canceled(cancellation)
                            || matches!(
                                error,
                                ProviderHttpError::Canceled
                                    | ProviderHttpError::AuthRequired
                                    | ProviderHttpError::AccessDenied
                                    | ProviderHttpError::RateLimited
                                    | ProviderHttpError::RedirectRejected
                            ) =>
                    {
                        return Err(error.into())
                    }
                    Err(_) => {}
                }
            }
            raw
        }
        "workbuddy-desktop" => {
            let (raw, complete) =
                read_packages(transport, credential, project, cancellation, clock()).await?;
            complete_packages = complete;
            raw
        }
        _ => {
            transport
                .read(
                    adapter,
                    credential,
                    ReadOptions {
                        project,
                        ..Default::default()
                    },
                    cancellation,
                )
                .await?
        }
    };
    let resources = from_provider(
        adapter,
        &raw,
        &json!(iso_from_ms(clock())),
        AdapterOptions { complete_packages },
    )?;
    Ok(Observation {
        resources,
        identity_context,
    })
}

fn select_scope<'a>(
    adapter: &str,
    choices: &'a Value,
    requested: Option<&Value>,
) -> Result<&'a str, ObservationError> {
    let rows = choices
        .as_array()
        .filter(|rows| rows.len() <= 100)
        .ok_or(AdapterError::InvalidResponse)?;
    let mut valid = rows.iter().filter_map(|row| {
        if adapter == "claude-web" {
            context::organization(&row["uuid"])
        } else {
            context::workspace(&row["id"])
        }
    });
    let selected = match requested.filter(|value| truthy(value)) {
        Some(requested) => valid.find(|candidate| requested.as_str() == Some(*candidate)),
        None => valid.next().filter(|_| valid.next().is_none()),
    };
    selected.ok_or(ObservationError::OrganizationRequired)
}

fn canceled(cancellation: &watch::Receiver<bool>) -> bool {
    *cancellation.borrow() || cancellation.has_changed().is_err()
}

async fn read_packages(
    transport: &impl Transport,
    credential: &str,
    project: Option<&Value>,
    cancellation: &mut watch::Receiver<bool>,
    at: i64,
) -> Result<(Value, bool), ObservationError> {
    let mut first = None;
    let mut accounts = Vec::new();
    let mut seen = HashSet::new();
    let mut bytes = 0;
    let mut total = None;
    let mut complete = false;
    for page in 1..=MAX_PACKAGE_PAGES {
        if canceled(cancellation) {
            return Err(ProviderHttpError::Canceled.into());
        }
        let raw = transport
            .read(
                "workbuddy-desktop",
                credential,
                ReadOptions {
                    project,
                    page_number: Some(page),
                    workbuddy_at: Some(at),
                    ..Default::default()
                },
                cancellation,
            )
            .await?;
        if canceled(cancellation) {
            return Err(ProviderHttpError::Canceled.into());
        }
        let response = &raw["data"]["Response"];
        match raw["code"].as_f64() {
            Some(0.0) if !truthy(&response["Error"]) => {}
            Some(401.0) => return Err(AdapterError::AuthRequired.into()),
            Some(403.0) => return Err(AdapterError::AccessDenied.into()),
            _ => return Err(AdapterError::InvalidResponse.into()),
        }
        bytes += stringify(&raw).len();
        if bytes > MAX_PACKAGE_BYTES {
            return Err(ProviderHttpError::OutputLimit.into());
        }
        let data = &response["Data"];
        let items = data["Accounts"]
            .as_array()
            .filter(|items| items.len() <= MAX_PAGE_PACKAGES)
            .ok_or(AdapterError::InvalidResponse)?;
        let hashes = items
            .iter()
            .map(package_key)
            .collect::<Result<Vec<_>, _>>()?;
        if page > 1 && hashes.iter().any(|hash| seen.contains(hash)) {
            break;
        }
        seen.extend(hashes);
        let remaining = accounts.len() + items.len();
        if let Some(count) = data.get("TotalCount") {
            let count = count
                .as_f64()
                .filter(|count| {
                    *count >= 0.0 && count.fract() == 0.0 && *count <= 9_007_199_254_740_991.0
                })
                .ok_or(AdapterError::InvalidResponse)? as u64;
            if total.is_some_and(|total| total != count) {
                return Err(AdapterError::InvalidResponse.into());
            }
            total = Some(count);
        }
        if total.is_some_and(|total| {
            remaining as u64 > total || (items.is_empty() && remaining as u64 != total)
        }) {
            return Err(AdapterError::InvalidResponse.into());
        }
        complete = items.is_empty();
        let mut raw = raw;
        let items = raw["data"]["Response"]["Data"]["Accounts"].take();
        if let Value::Array(items) = items {
            accounts.extend(items);
        }
        if first.is_none() {
            first = Some(raw);
        }
        if complete {
            break;
        }
    }
    let mut raw = first.ok_or(AdapterError::InvalidResponse)?;
    raw["data"]["Response"]["Data"]["Accounts"] = Value::Array(accounts);
    Ok((raw, complete))
}

fn sort_entries(object: &Map<String, Value>) -> Vec<(&str, &Value)> {
    let mut entries: Vec<_> = object
        .iter()
        .map(|(key, value)| (key.as_str(), value))
        .collect();
    entries.sort_unstable_by(|(left, _), (right, _)| left.encode_utf16().cmp(right.encode_utf16()));
    entries
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            sort_entries(object)
                .into_iter()
                .map(|(key, value)| (key.to_owned(), canonical(value)))
                .collect(),
        ),
        Value::Array(array) => Value::Array(array.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

fn package_key(value: &Value) -> Result<[u8; 32], AdapterError> {
    let object = value.as_object().ok_or(AdapterError::InvalidResponse)?;
    let stable = Value::Object(
        sort_entries(object)
            .into_iter()
            .filter(|(key, _)| {
                let key = key.to_ascii_lowercase();
                !["remain", "used", "frozen", "balance"]
                    .iter()
                    .any(|part| key.contains(part))
            })
            .map(|(key, value)| (key.to_owned(), canonical(value)))
            .collect(),
    );
    Ok(Sha256::digest(stringify(&stable)).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::VecDeque};

    const AT: i64 = 1_792_380_000_000;
    const ID: &str = "11111111-2222-4333-8444-555555555555";

    type MockCall = (
        Option<String>,
        Option<Value>,
        Option<String>,
        Option<u8>,
        Option<i64>,
    );
    struct Fake {
        calls: RefCell<Vec<MockCall>>,
        replies: RefCell<VecDeque<Result<Value, ProviderHttpError>>>,
    }

    impl Fake {
        fn new(replies: impl IntoIterator<Item = Result<Value, ProviderHttpError>>) -> Self {
            Self {
                calls: RefCell::new(vec![]),
                replies: RefCell::new(replies.into_iter().collect()),
            }
        }
    }

    impl Transport for Fake {
        async fn read(
            &self,
            _adapter: &str,
            _credential: &str,
            options: ReadOptions<'_>,
            _cancellation: &mut watch::Receiver<bool>,
        ) -> Result<Value, ProviderHttpError> {
            self.calls.borrow_mut().push((
                options.part.map(str::to_owned),
                options.project.cloned(),
                options.organization.map(str::to_owned),
                options.page_number,
                options.workbuddy_at,
            ));
            self.replies
                .borrow_mut()
                .pop_front()
                .expect("fixture provides one response per read")
        }
    }

    #[tokio::test]
    async fn organization_and_project_are_selected_before_the_quota_request(
    ) -> Result<(), ObservationError> {
        let (_owner, mut cancel) = watch::channel(false);
        let choices = json!([{"uuid":ID},{"uuid":"aaaaaaaa-2222-4333-8444-555555555555"}]);
        let ambiguous = Fake::new([Ok(choices.clone())]);
        assert!(matches!(
            observe(
                &ambiguous,
                "claude-web",
                "synthetic",
                None,
                &mut cancel,
                || AT
            )
            .await,
            Err(ObservationError::OrganizationRequired)
        ));
        assert_eq!(ambiguous.calls.borrow().len(), 1);
        let web = Fake::new([Ok(choices), Ok(json!({"five_hour":{"utilization":25}}))]);
        let result = observe(
            &web,
            "claude-web",
            "synthetic",
            Some(&json!({"organization":ID})),
            &mut cancel,
            || AT,
        )
        .await?;
        assert_eq!(web.calls.borrow()[1].2.as_deref(), Some(ID));
        assert_eq!(result.identity_context, Some(json!({"organization":ID})));
        assert!(!stringify(&result.resources).contains(ID));

        let go = Fake::new([
            Ok(json!([{"id":"wrk_sample"}])),
            Ok(json!({
                "access":{"meters":{"week":{"usedMicroCents":"100","limitMicroCents":"500"}}}
            })),
        ]);
        let result = observe(&go, "opencode-web", "synthetic", None, &mut cancel, || AT).await?;
        assert_eq!(go.calls.borrow()[1].0.as_deref(), Some("usage"));
        assert_eq!(
            result.identity_context,
            Some(json!({"workspace":"wrk_sample"}))
        );

        let assisted = Fake::new([
            Ok(json!({"cloudaicompanionProject":{"id":"synthetic-project"}})),
            Ok(
                json!({"buckets":[{"modelId":"synthetic","tokenType":"REQUESTS","remainingFraction":0.5}]}),
            ),
        ]);
        let result = observe(
            &assisted,
            "gemini-code-assist",
            "synthetic",
            Some(&json!({"discover":true})),
            &mut cancel,
            || AT,
        )
        .await?;
        assert_eq!(assisted.calls.borrow()[0].0.as_deref(), Some("bootstrap"));
        assert_eq!(
            assisted.calls.borrow()[1].1,
            Some(json!("synthetic-project"))
        );
        assert_eq!(result.identity_context, Some(json!("synthetic-project")));
        Ok(())
    }

    #[tokio::test]
    async fn pages_require_a_nonconflicting_empty_page_and_optional_mimo_parts_keep_auth_errors(
    ) -> Result<(), ObservationError> {
        let (_owner, mut cancel) = watch::channel(false);
        let page = |items: Vec<Value>, count: i64| json!({"code":0,"data":{"Response":{"Data":{"Accounts":items,"TotalCount":count}}}});
        let account =
            |name, left| json!({"CapacityType":1,"PackageName":name,"CapacityRemain":left});
        let complete = Fake::new([
            Ok(page(vec![account("one", "42")], 2)),
            Ok(page(vec![account("two", "27")], 2)),
            Ok(page(vec![], 2)),
        ]);
        let result = observe(
            &complete,
            "workbuddy-desktop",
            "synthetic",
            None,
            &mut cancel,
            || AT,
        )
        .await?;
        assert_eq!(result.resources["incomplete"], false);
        assert_eq!(
            result.resources["pools"]
                .as_array()
                .expect("resource pools")
                .len(),
            2
        );
        assert_eq!(complete.calls.borrow()[2].3, Some(3));
        assert!(complete
            .calls
            .borrow()
            .iter()
            .all(|call| call.4 == Some(AT)));

        let overlap = Fake::new([
            Ok(page(vec![account("one", "42")], 2)),
            Ok(page(vec![account("one", "25")], 2)),
        ]);
        let result = observe(
            &overlap,
            "workbuddy-desktop",
            "synthetic",
            None,
            &mut cancel,
            || AT,
        )
        .await?;
        assert_eq!(result.resources["incomplete"], true);
        assert_eq!(
            result.resources["pools"][0]["balances"][0]["remaining"],
            "42"
        );
        let conflict = Fake::new([Ok(page(vec![account("one", "42")], 2)), Ok(page(vec![], 2))]);
        assert!(matches!(
            observe(
                &conflict,
                "workbuddy-desktop",
                "synthetic",
                None,
                &mut cancel,
                || AT
            )
            .await,
            Err(ObservationError::Adapter(AdapterError::InvalidResponse))
        ));

        let mimo = || json!({"code":0,"data":{"currency":"CNY","balance":"1.25"}});
        let unavailable = Fake::new([
            Ok(mimo()),
            Err(ProviderHttpError::Timeout),
            Err(ProviderHttpError::RequestFailed),
        ]);
        let result = observe(
            &unavailable,
            "mimo-web",
            "synthetic",
            None,
            &mut cancel,
            || AT,
        )
        .await?;
        assert_eq!(result.resources["incomplete"], true);
        assert_eq!(
            result.resources["pools"][0]["balances"][0]["remaining"],
            "1.25"
        );
        let unauthorized = Fake::new([Ok(mimo()), Err(ProviderHttpError::AuthRequired)]);
        assert!(matches!(
            observe(
                &unauthorized,
                "mimo-web",
                "synthetic",
                None,
                &mut cancel,
                || AT
            )
            .await,
            Err(ObservationError::Http(ProviderHttpError::AuthRequired))
        ));
        Ok(())
    }
}
