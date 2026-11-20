use crate::{
    agent_runtime::{definition, Definition},
    provider_catalog::capabilities,
};
use serde_json::{json, Value};

pub const AGY_COMMAND: &str = "irm https://antigravity.google/cli/install.ps1 | iex";

const RECOVERY: &[(&str, &str)] = &[
    (
        "SOURCE_BUSY",
        "来源文件正在写入，等待写入结束后在来源页重新检查；已有统计保留。",
    ),
    (
        "SOURCE_UNREADABLE",
        "检查读取位置是否存在及当前用户权限；不自动提权或更改原文件权限。",
    ),
    (
        "SOURCE_TIMEOUT",
        "读取达到时间限制，检查来源范围后手动重试，保留历史。",
    ),
    (
        "SOURCE_PARSE_FAILED",
        "检查来源版本及文件格式；自定义来源检查解析规则，保留原始数据。",
    ),
    (
        "SOURCE_USAGE_CONFLICT",
        "计量分类存在冲突，不累加副本、不补零；检查重复来源，未解决记录保持未定价。",
    ),
    (
        "SOURCE_USAGE_REGRESSION",
        "较旧快照未覆盖已保存用量，确认读取位置和文件版本。",
    ),
    (
        "USAGE_UNREPORTED",
        "来源没有报告部分用量，保留未知；安装或登录不能补造缺失字段。",
    ),
    (
        "CURSOR_CSV_SCHEMA",
        "选择包含逐请求时间、模型、输入输出和缓存分类的 CSV；汇总图表导出不适用。",
    ),
    (
        "CURSOR_SOURCE_MODE_CONFLICT",
        "SDK 与 CSV 无法确认重复范围，请沿用一种来源模式，历史统计保留。",
    ),
    (
        "DEEPSEEK_FORMAT_UNSUPPORTED",
        "当前适配器仅核对 v2–v4；等待适配器更新，不改写会话或降级原数据。",
    ),
    (
        "DEEPSEEK_LOG_INCOMPLETE",
        "会话序列尚不完整，等待写入完成后重新检查，历史保留。",
    ),
    (
        "ANTIGRAVITY_MODEL_UNPAIRED",
        "模型记录尚未与调用数配对，用量保留、模型和费用保持未知。",
    ),
    (
        "SOURCE_ALIAS_REJECTED",
        "部分链接目标位于允许范围之外，确认来源位置，不自动跟随链接。",
    ),
    (
        "SOURCE_SYMLINK_REJECTED",
        "读取位置为链接，选择受支持的实际来源目录，不扩大扫描范围。",
    ),
];

pub fn usage_recovery(enabled: bool, status: &Value, custom: bool) -> Value {
    let (state, first) = if !enabled {
        (
            "paused",
            "来源读取已停用；到Agent 管理确认后启用，已有统计不变。",
        )
    } else if let Some(state) = status["status"]
        .as_str()
        .filter(|state| matches!(*state, "error" | "partial"))
    {
        (
            state,
            "本次读取未完全成功，已有历史保留；先检查来源页的读取位置和诊断。",
        )
    } else if status["observedRecords"]
        .as_u64()
        .is_some_and(|count| count > 0)
        || status["lastSuccess"]
            .as_str()
            .is_some_and(|stamp| !stamp.is_empty())
    {
        (
            "available",
            "已有本地用量观测，程序入口扫描结果不覆盖历史统计。",
        )
    } else {
        (
            "not-read",
            "尚无可确认的读取结果；安装后须有兼容用量记录，缺少记录不等于未安装或额度为零。",
        )
    };
    let mut issues = Vec::new();
    let mut steps = vec![first];
    for code in status["errors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if issues.contains(&code) {
            continue;
        }
        if let Some((_, message)) = RECOVERY.iter().find(|(key, _)| *key == code) {
            issues.push(code);
            steps.push(message);
        }
    }
    if custom {
        steps.push("个人来源无需安装插件；在“编辑规则”中核对选定的 JSONL/NDJSON 路径、格式与字段映射。不会自动寻找或读取未知目录。");
    }
    json!({"state":state,"steps":steps,"issues":issues})
}

fn quota_note(agent: &str) -> String {
    capabilities()
        .ok()
        .and_then(|rows| {
            rows.into_iter()
                .find(|row| row.provider == agent && !row.adapters.is_empty())
        })
        .map_or_else(
            || "个人来源只提供用量，不接入账号额度。".to_owned(),
            |row| format!("额度页已提供独立连接；{}", row.reason),
        )
}

pub fn agent_view(
    agent: &str,
    name: &str,
    usage: &Value,
    revision: u64,
    runtime: Option<&Value>,
) -> Option<Value> {
    let spec = definition(agent);
    let custom = usage_engine::agent_catalog::custom_id(agent);
    if !custom && spec.is_none() {
        return None;
    }
    if agent == "antigravity" {
        let mut state = antigravity_view(revision, runtime);
        state["schemaVersion"] = json!("AgentSetupV1");
        state["agent"] = json!(agent);
        state["name"] = json!(name);
        state["usage"] = usage.clone();
        state["providerNote"] = json!(spec?.note);
        state["quotaDescription"] = json!(quota_note(agent));
        return Some(state);
    }
    let (reason, title) = if custom {
        ("custom-source", "核对个人来源规则")
    } else if let Some(runtime) = runtime {
        if runtime["coverage"]["complete"] != true {
            ("scan-incomplete", "部分位置未能检查")
        } else if runtime["entries"]
            .as_array()
            .is_some_and(|rows| !rows.is_empty())
        {
            ("entry-found", "发现程序入口，尚未核验版本与账号")
        } else {
            ("entry-not-found", "已扫描位置未发现程序入口")
        }
    } else {
        ("scan-required", "检查程序入口与读取状态")
    };
    let command = spec
        .as_ref()
        .and_then(|spec| spec.command)
        .filter(|_| reason == "entry-not-found" && usage["state"] == "not-read");
    let (note, actions) = if let Some(Definition { note, desktop, .. }) = spec {
        let mut actions = vec![
            json!({"id":"installation-guide","label":if desktop {"打开官方安装 / 下载指南"} else {"打开官方安装指南"}}),
        ];
        if command.is_some() {
            actions.push(json!({"id":"copy-install-command","label":"复制 PowerShell 安装命令"}));
        }
        actions.extend([
            json!({"id":"troubleshooting-guide","label":"打开官方排查说明"}),
            json!({"id":"rescan","label":"重新扫描程序入口"}),
        ]);
        (note, actions)
    } else {
        ("自定义来源只接入本地用量，不接入账号额度。", Vec::new())
    };
    let steps: &[&str] = if custom {
        &[]
    } else {
        &[
            "按官方指南安装或更新；登录与账号权限在官方应用内核对。",
            "安装后重新打开本应用以更新 PATH，再手动重新扫描；默认位置也会检查。",
            "路径扫描不会执行 CLI、核对版本、登录或请求额度，也不会重试模型调用。",
        ]
    };
    let quota = if agent == "codex" {
        "Codex 额度在额度页独立连接与刷新；此引导不会登录或刷新账号。".to_owned()
    } else {
        format!(
            "{} 本地 token、估算费用、积分及会员有效期不能相互替代。",
            quota_note(agent)
        )
    };
    Some(json!({
        "schemaVersion":"AgentSetupV1","agent":agent,"name":name.chars().take(80).collect::<String>(),
        "revision":revision,"reason":reason,"title":title,"usage":usage,"providerNote":note,
        "steps":steps,"checkedAt":runtime.and_then(|runtime|runtime["checkedAt"].as_str()),"runtime":runtime,
        "installation":{"mode":"guided","command":command,"shell":command.map(|_|"PowerShell"),"executed":false},
        "actions":actions,"quotaDescription":quota,"notice":"打开指南、复制命令或发现文件不表示安装、登录或额度读取成功。"
    }))
}

pub fn antigravity_view(revision: u64, discovery: Option<&Value>) -> Value {
    let (reason,title,steps,install)=match discovery {
        None=>("scan-required","先检查 CLI 是否可用",vec!["扫描官方安装位置和 PATH，无需手工填写路径。"],false),
        Some(row) if row["coverage"]["issues"].as_array().is_some_and(|issues|issues.iter().any(|issue|issue=="PLATFORM_UNSUPPORTED"))=>
            ("platform-unsupported","当前只支持 Windows CLI 发现",vec!["此入口不扫描 WSL；在受支持的 Windows 环境中检查。"],false),
        Some(row) if row["coverage"]["complete"]!=true || row["selection"]["state"]=="incomplete"=>
            ("scan-incomplete","CLI 扫描尚不完整",vec!["部分路径不可访问或扫描达到限制；检查权限、PATH 和网络盘条目后重新扫描，不要据此重复安装。"],false),
        Some(row) if row["selection"]["state"]=="ambiguous"=>
            ("multiple-candidates","发现多个 CLI，尚未选择",vec!["在终端检查官方安装位置和 PATH 中的重复版本；应用不会猜测账号或自动删除文件。"],false),
        Some(row) if row["selection"]["state"]=="single-candidate"=>
            ("verification-required","已发现 CLI，仍需核验",vec!["需要核验程序文件、版本及 /usage 协议；当前已复核版本范围 1.1.11–1.4.2。"],false),
        Some(row) if matches!(row["status"].as_str(),Some("not-found"|"desktop-only"))=>{
            let desktop=row["status"]=="desktop-only";
            (if desktop {"desktop-only"} else {"cli-missing"},if desktop {"已发现桌面版，还缺少 CLI"} else {"未在已扫描位置发现 CLI"},vec![
                "打开官方指南，在 PowerShell 中自行执行官方安装命令。",
                "安装后重新打开应用以更新 PATH，再点击重新扫描；默认目录也会自动扫描。",
                "终端中的 agy --version 可帮助确认安装；登录由用户在官方 CLI 中完成，应用不读取认证文件。",
                "官方安装器安装当前版本；若高于已复核上限 1.4.2，仍需等待适配器更新。",
            ],true)
        }
        Some(row) if row["status"]=="launcher-only"=>
            ("launcher-only","只发现启动脚本",vec!["当前读取器需要官方 agy.exe；检查官方安装目录与 PATH 后重新扫描，应用不会执行 .cmd 或 .ps1 启动脚本。"],false),
        Some(_)=>("candidate-rejected","发现的路径不满足核验条件",vec!["检查官方安装及链接目标；应用不会执行被拒绝的文件，也不会自动覆盖或删除它。"],false),
    };
    let mut actions = Vec::new();
    if install {
        actions.extend([json!({"id":"installation-guide","label":"打开官方安装指南","effect":"open-official-guide"}),
            json!({"id":"copy-install-command","label":"复制 PowerShell 安装命令","effect":"copy-command"})]);
    }
    actions.extend([json!({"id":"troubleshooting-guide","label":"打开官方排查指南","effect":"open-official-guide"}),
        json!({"id":"rescan","label":"重新扫描 CLI","effect":"metadata-scan"})]);
    json!({
        "schemaVersion":"AntigravitySetupV1","provider":"antigravity","revision":revision,"reason":reason,"title":title,"steps":steps,
        "checkedAt":discovery.and_then(|result|result["checkedAt"].as_str()),"lastDiscovery":discovery,
        "cliVersion":null,"supportedVersions":{"minimum":"1.1.11","maximumReviewed":"1.4.2"},
        "installation":{"mode":"guided","command":install.then_some(AGY_COMMAND),"shell":install.then_some("PowerShell"),"defaultDirectory":"%LOCALAPPDATA%\\agy\\bin","executed":false},
        "actions":actions,"quota":{"liveEnabled":false,"ready":false,"verificationRequired":true},
        "notice":"打开指南或复制命令不表示安装、登录或额度读取成功。重新扫描只检查路径，不执行 CLI。"
    })
}
