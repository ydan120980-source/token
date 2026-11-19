use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fmt, sync::OnceLock};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginContract {
    pub mode: String,
    pub label: String,
    pub note: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCapability {
    pub id: String,
    pub name: String,
    pub experimental: bool,
    pub website_login: bool,
    pub client_login: bool,
    pub client_only: bool,
    pub client_mode: Option<String>,
    pub kind: String,
    pub provenance: String,
    pub note: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapability {
    pub provider: String,
    pub name: String,
    pub mode: String,
    pub adapters: Vec<AdapterCapability>,
    pub login: LoginContract,
    pub reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    routes: Map<String, Value>,
    login_contracts: std::collections::HashMap<String, LoginContract>,
    gaps: std::collections::HashMap<String, String>,
    planned: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidCatalog;

impl fmt::Display for InvalidCatalog {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PROVIDER_CATALOG_INVALID")
    }
}

impl std::error::Error for InvalidCatalog {}

fn data() -> Result<&'static Data, InvalidCatalog> {
    static CATALOG: OnceLock<Result<Data, InvalidCatalog>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            serde_json::from_str(include_str!("../data/provider-catalog.json"))
                .map_err(|_| InvalidCatalog)
        })
        .as_ref()
        .map_err(|_| InvalidCatalog)
}

pub fn routes() -> Result<&'static Map<String, Value>, InvalidCatalog> {
    Ok(&data()?.routes)
}

pub fn experimental(route: &Value) -> bool {
    route["provenance"] == "undocumented-api"
        || route["websiteLogin"] == true
        || route["kind"] == "google-internal"
        || route["name"]
            .as_str()
            .is_some_and(|name| name.contains("试验"))
}

fn field<'a>(route: &'a Value, name: &str) -> Result<&'a str, InvalidCatalog> {
    route[name].as_str().ok_or(InvalidCatalog)
}

fn adapter(id: &str, route: &Value) -> Result<AdapterCapability, InvalidCatalog> {
    let name = field(route, "name")?;
    let experimental = experimental(route);
    let name = if experimental && !name.contains("试验") {
        format!("{}（试验）", name.strip_suffix("（推荐）").unwrap_or(name))
    } else {
        name.to_owned()
    };
    Ok(AdapterCapability {
        id: id.to_owned(),
        name,
        experimental,
        website_login: route["websiteLogin"] == true,
        client_login: route["clientLogin"] == true,
        client_only: route["clientOnly"] == true,
        client_mode: matches!(id, "opencode-go" | "deepseek-api" | "zai-cn" | "zai-global")
            .then(|| "key".to_owned()),
        kind: route["kind"].as_str().unwrap_or("http").to_owned(),
        provenance: field(route, "provenance")?.to_owned(),
        note: field(route, "note")?.to_owned(),
    })
}

pub fn capabilities() -> Result<Vec<ProviderCapability>, InvalidCatalog> {
    let catalog = usage_engine::agent_catalog::builtin_agents();
    let data = data()?;
    catalog.as_object().ok_or(InvalidCatalog)?.iter().filter_map(|(id, meta)| {
        let planned = data.planned.contains(id);
        (meta["usageOnly"] != true || planned).then_some((id, meta, planned))
    }).map(|(id, meta, planned)| {
        let mut adapters = data.routes.iter()
            .filter(|(_, route)| route["provider"] == id.as_str())
            .map(|(id, route)| adapter(id, route))
            .collect::<Result<Vec<_>, _>>()?;
        adapters.sort_by_key(|adapter| !adapter.client_login);
        let mode = if id == "codex" { "official-cli" }
            else if adapters.is_empty() { if planned { "planned" } else { "not-connected" } }
            else if adapters.iter().any(|adapter| adapter.kind == "passive") { "passive" }
            else { "explicit-token" };
        let login = data.login_contracts.get(id).cloned().unwrap_or_else(|| LoginContract {
            mode: "api-key".to_owned(),
            label: "复用配置／API key 连接".to_owned(),
            note: "优先复用已配置的 key。没有 key 时可打开官方页面获取，输入一次后以 Windows 系统加密保存。服务商需要自行创建 key 时会明确提示。".to_owned(),
        });
        let reason = data.gaps.get(id).map(String::as_str).unwrap_or(
            if id == "codex" { "通过官方 CLI 独立授权连接。" }
            else { "验证额度后加密保持连接；服务商未支持的授权方式不伪装为 OAuth。" }
        );
        Ok(ProviderCapability {
            provider: id.to_owned(), name: field(meta, "name")?.to_owned(), mode: mode.to_owned(),
            adapters, login, reason: reason.to_owned(),
        })
    }).collect()
}
