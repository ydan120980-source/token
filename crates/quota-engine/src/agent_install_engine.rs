use crate::{
    agent_install_archive::{self as archive, EXPANDED_LIMIT},
    agent_install_http::{self as http, Algorithm, Request, Scope, CANCELED, DOWNLOAD, TIMEOUT},
    agent_install_plans::{compare, plan, version, Route},
    agent_install_windows as native,
    agent_runtime::{discover, discover_antigravity, Environment},
    windows_job::{ExecutablePin, JobError, JobProcess, StartOptions},
};
use base64::Engine as _;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashSet},
    env,
    ffi::OsString,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tempfile::TempDir;
use usage_engine::{
    config_health::{guard, guard_existing_parent},
    store_io,
};

pub use http::Cancel;
const METADATA: &str = "INSTALL_METADATA_INVALID";
const PATH: &str = "INSTALL_PATH_REJECTED";
const WRITE: &str = "INSTALL_WRITE_FAILED";
const LAYOUT: &str = "INSTALL_LAYOUT_UNSUPPORTED";
const CHECKSUM: &str = "INSTALL_CHECKSUM_FAILED";
const PROCESS: &str = "INSTALL_PROCESS_FAILED";
const VERSION: &str = "INSTALL_VERSION_UNVERIFIED";
const DEPENDENCY: &str = "INSTALL_DEPENDENCY_FAILED";
const MAINTENANCE: &str = "INSTALL_LOCAL_MAINTENANCE_REQUIRED";

type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: &'static str,
    pub attempt: Option<usize>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

pub struct Engine {
    root: PathBuf,
    system: PathBuf,
    environment: Environment,
    client: Client,
    cancel: Arc<Cancel>,
    notify: Arc<dyn Fn(Progress) + Send + Sync>,
    arch: &'static str,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub agent: String,
    pub version: String,
    pub executable: PathBuf,
    pub executable_hash: String,
    pub js: bool,
    pub entry: Option<PathBuf>,
    pub entry_hash: Option<String>,
    pub bin_directory: Option<PathBuf>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    pub executable: PathBuf,
    pub hash: String,
    pub npm: PathBuf,
    pub npm_hash: String,
}

struct Remote {
    version: Option<String>,
    url: Option<String>,
    hash: Option<String>,
    algorithm: Algorithm,
    scope: Scope,
}

struct Package {
    name: String,
    version: String,
    url: String,
    hash: String,
}

pub enum Outcome {
    Installed(Runtime),
    Desktop { version: String },
    Inspected(Value),
}

fn confine(root: &Path, file: &Path) -> Result<()> {
    let relative = file.strip_prefix(root).map_err(|_| PATH)?;
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PATH);
    }
    guard_existing_parent(file).map_err(|_| PATH)
}

fn child(root: &Path, path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = root.join(path);
    confine(root, &path)?;
    Ok(path)
}

fn metadata_json<T: serde::de::DeserializeOwned>(file: &Path) -> Result<T> {
    let bytes = usage_engine::config_health::management_read(file, 1024 * 1024)
        .map_err(|_| METADATA)?
        .ok_or(METADATA)?;
    serde_json::from_slice(&bytes).map_err(|_| METADATA)
}

fn save(path: &Path, value: &impl Serialize) -> Result<()> {
    let value = serde_json::to_value(value).map_err(|_| WRITE)?;
    store_io::atomic(path, &value, false).map_err(|_| WRITE)
}

fn sha(path: &Path) -> Result<String> {
    guard(path).map_err(|_| PATH)?;
    let mut file = File::open(path).map_err(|_| METADATA)?;
    let size = file.metadata().map_err(|_| METADATA)?.len();
    if size > 1024 * 1024 * 1024 {
        return Err(METADATA);
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0;
    loop {
        let count = file.read(&mut buffer).map_err(|_| METADATA)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > size {
            return Err(METADATA);
        }
        hash.update(&buffer[..count]);
    }
    if total != size {
        return Err(METADATA);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn hex(value: &str, digits: usize) -> bool {
    value.len() == digits && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn normalized(value: &Value) -> Option<String> {
    value.as_str().and_then(version).map(str::to_owned)
}

fn job_error(error: JobError) -> &'static str {
    match error {
        JobError::BinaryChanged => CHECKSUM,
        JobError::CleanupUnconfirmed => "INSTALL_CLEANUP_UNCONFIRMED",
        JobError::Canceled => CANCELED,
        JobError::TimedOut => TIMEOUT,
        JobError::OutputLimit => "INSTALL_OUTPUT_LIMIT",
        _ => PROCESS,
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| PROCESS)?
}

impl Engine {
    pub fn new(
        root: PathBuf,
        environment: Environment,
        cancel: Arc<Cancel>,
        notify: impl Fn(Progress) + Send + Sync + 'static,
    ) -> Result<Arc<Self>> {
        let system = env::var_os("SystemRoot")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && guard(path).is_ok())
            .ok_or(PROCESS)?;
        let arch = match env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            _ => return Err("INSTALL_PLATFORM_UNSUPPORTED"),
        };
        guard_existing_parent(&root).map_err(|_| PATH)?;
        fs::create_dir_all(&root).map_err(|_| WRITE)?;
        guard(&root).map_err(|_| PATH)?;
        Ok(Arc::new(Self {
            root,
            system,
            environment,
            client: http::client()?,
            cancel,
            notify: Arc::new(notify),
            arch,
        }))
    }

    fn progress(
        &self,
        stage: &'static str,
        attempt: Option<usize>,
        downloaded: Option<u64>,
        total: Option<u64>,
    ) {
        (self.notify)(Progress {
            stage,
            attempt,
            downloaded_bytes: downloaded,
            total_bytes: total,
        });
    }

    fn stage(&self, stage: &'static str) {
        self.progress(stage, None, None, None);
    }

    fn local_maintenance(&self, agent: &str) -> bool {
        agent == "claude"
            && ["governance-required.json", "governed.json"]
                .into_iter()
                .any(|name| {
                    child(&self.root, Path::new("claude").join(name))
                        .is_ok_and(|path| path.exists())
                })
    }

    fn work(&self, dir: impl AsRef<Path>, prefix: &str) -> Result<TempDir> {
        let dir = child(&self.root, dir)?;
        fs::create_dir_all(&dir).map_err(|_| WRITE)?;
        guard(&dir).map_err(|_| PATH)?;
        tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(dir)
            .map_err(|_| WRITE)
    }

    fn private_env(&self, cwd: &Path, program: &Path) -> Result<BTreeMap<OsString, OsString>> {
        let private = child(&self.root, "runtime-home")?;
        let app = private.join("AppData/Roaming");
        let local = private.join("AppData/Local");
        for directory in [&private, &app, &local] {
            guard_existing_parent(directory).map_err(|_| PATH)?;
            fs::create_dir_all(directory).map_err(|_| WRITE)?;
            guard(directory).map_err(|_| PATH)?;
        }
        let system = self.system.join("System32");
        let path =
            env::join_paths([program.parent().ok_or(PATH)?, system.as_path()]).map_err(|_| PATH)?;
        let directory = |path: &Path| path.as_os_str().to_owned();
        Ok([
            ("SystemRoot", directory(&self.system)),
            ("WINDIR", directory(&self.system)),
            ("TMP", directory(cwd)),
            ("TEMP", directory(cwd)),
            ("HOME", directory(&private)),
            ("USERPROFILE", directory(&private)),
            ("APPDATA", directory(&app)),
            ("LOCALAPPDATA", directory(&local)),
            ("PATH", path),
        ]
        .into_iter()
        .map(|(key, value)| (OsString::from(key), value))
        .collect())
    }

    fn execute(
        &self,
        executable: &Path,
        hash: &str,
        args: &[OsString],
        cwd: &Path,
        limit: u64,
        extra: bool,
    ) -> Result<String> {
        self.cancel.check()?;
        let pin = ExecutablePin::from_sha256(executable, hash).map_err(job_error)?;
        let mut environment = self.private_env(cwd, executable)?;
        if extra {
            let cache = child(&self.root, "npm-cache")?;
            environment.insert(OsString::from("npm_config_cache"), cache.into_os_string());
            environment.insert(
                OsString::from("npm_config_update_notifier"),
                OsString::from("false"),
            );
        }
        let output = JobProcess::run(
            &pin,
            StartOptions {
                cwd,
                arguments: args,
                environment: &environment,
            },
            Duration::from_secs(limit),
            524288,
            || self.cancel.stopped(),
        )
        .map_err(job_error)?;
        if output.code != 0 {
            return Err(PROCESS);
        }
        String::from_utf8(output.stdout).map_err(|_| PROCESS)
    }

    fn active(&self, agent: &str) -> Option<Runtime> {
        active_runtime(&self.root, agent)
    }

    fn probe(&self, runtime: &Runtime, cwd: &Path) -> Result<()> {
        let mut arguments = Vec::new();
        let _script = if let Some(entry) = &runtime.entry {
            let lease = execution_script(entry, runtime.entry_hash.as_deref().ok_or(CHECKSUM)?)?;
            arguments.push(entry.as_os_str().to_owned());
            Some(lease)
        } else {
            None
        };
        arguments.push(OsString::from("--version"));
        let output = self.execute(
            &runtime.executable,
            &runtime.executable_hash,
            &arguments,
            cwd,
            10,
            false,
        )?;
        let pattern =
            Regex::new(r"\b\d{1,4}\.\d{1,9}\.\d{1,9}(?:\.\d{1,9})?(?:-[a-zA-Z0-9.-]+)?\b")
                .map_err(|_| VERSION)?;
        if output.len() > 4096
            || !pattern.find_iter(&output).any(|candidate| {
                compare(candidate.as_str(), &runtime.version) == Some(Ordering::Equal)
            })
        {
            return Err(VERSION);
        }
        Ok(())
    }

    async fn small(&self, url: &str, scope: Scope) -> Result<Vec<u8>> {
        http::receive(
            &self.client,
            Request {
                url,
                scope,
                maximum: 2 * 1024 * 1024,
                file: None,
                resume: false,
                algorithm: Algorithm::Sha256,
            },
            &self.cancel,
            |_, _| {},
        )
        .await
        .map(|value| value.bytes)
    }

    async fn json(&self, url: &str, scope: Scope) -> Result<Value> {
        serde_json::from_slice(&self.small(url, scope).await?).map_err(|_| METADATA)
    }

    async fn metadata(&self, agent: &str, route: &Route) -> Result<Remote> {
        if self.local_maintenance(agent) {
            return Err(MAINTENANCE);
        }
        if let Some(package) = route.package() {
            let raw = self
                .json(
                    &format!("https://registry.npmjs.org/{package}/latest"),
                    Scope::Registry,
                )
                .await?;
            if raw["name"] != package {
                return Err(METADATA);
            }
            return Ok(Remote {
                version: Some(normalized(&raw["version"]).ok_or(METADATA)?),
                url: None,
                hash: None,
                algorithm: Algorithm::Sha512,
                scope: Scope::Registry,
            });
        }
        let (url,scope,hash_key,algorithm)=match agent {
            "antigravity"=>(format!("https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_{}.json",if self.arch=="arm64" {"arm64"} else {"amd64"}),Scope::Antigravity,"sha512",Algorithm::Sha512),
            "workbuddy"=>("https://www.workbuddy.cn/v2/update?platform=workbuddy-win32-x64-user".to_owned(),Scope::WorkBuddy,"sha256hash",Algorithm::Sha256),
            "cursor"=>(format!("https://api2.cursor.sh/updates/api/update/win32-{}-user/cursor/0.0.0",self.arch),Scope::Cursor,"sha256hash",Algorithm::Sha256),
            "zcode"=>{
                let bytes=self.small("https://zcode.z.ai",Scope::ZCode).await?;
                let text=std::str::from_utf8(&bytes).map_err(|_|METADATA)?.replace("\\/","/");
                let expression=Regex::new(&format!(r"https://cdn-zcode\.z\.ai/zcode/electron/releases/(\d+\.\d+\.\d+)/windows-{0}/ZCode-[0-9.]+-win-{0}\.exe",self.arch)).map_err(|_|METADATA)?;
                let matched=expression.captures(&text).ok_or(METADATA)?;
                let version=matched.get(1).and_then(|value|version(value.as_str())).ok_or(METADATA)?;
                let url=matched.get(0).ok_or(METADATA)?.as_str();
                Scope::ZCode.allowed(url)?;
                return Ok(Remote {version:Some(version.to_owned()),url:Some(url.to_owned()),hash:None,algorithm:Algorithm::Sha256,scope:Scope::ZCode});
            }
            _=>return Err(METADATA),
        };
        let row = self.json(&url, scope).await?;
        let version = normalized(
            row.get("productVersion")
                .filter(|value| value.is_string())
                .unwrap_or(&row["version"]),
        )
        .ok_or(METADATA)?;
        let url = row["url"].as_str().ok_or(METADATA)?;
        scope.allowed(url)?;
        let width = match algorithm {
            Algorithm::Sha512 => 128,
            Algorithm::Sha256 => 64,
        };
        let hash = row[hash_key]
            .as_str()
            .filter(|value| hex(value, width))
            .map(str::to_ascii_lowercase);
        if agent != "cursor" && hash.is_none() {
            return Err(METADATA);
        }
        Ok(Remote {
            version: Some(version),
            url: Some(url.to_owned()),
            hash,
            algorithm,
            scope,
        })
    }

    async fn platform_package(
        &self,
        agent: &str,
        platform: &str,
        version: &str,
    ) -> Result<Package> {
        let (name, target) = if agent == "codex" {
            (
                platform.to_owned(),
                format!("{version}-win32-{}", self.arch),
            )
        } else {
            (format!("{platform}{}", self.arch), version.to_owned())
        };
        let raw = self
            .json(
                &format!("https://registry.npmjs.org/{name}/{target}"),
                Scope::Registry,
            )
            .await?;
        let contains = |key: &str, expected: &str| {
            raw[key]
                .as_array()
                .is_some_and(|values| values.iter().any(|value| value == expected))
        };
        if raw["name"] != name
            || raw["version"] != target
            || !contains("os", "win32")
            || !contains("cpu", self.arch)
        {
            return Err(METADATA);
        }
        let integrity = raw["dist"]["integrity"]
            .as_str()
            .and_then(|value| value.strip_prefix("sha512-"))
            .ok_or(METADATA)?;
        let sum = base64::engine::general_purpose::STANDARD
            .decode(integrity)
            .ok()
            .filter(|decoded| decoded.len() == 64)
            .ok_or(METADATA)?;
        let url = raw["dist"]["tarball"].as_str().ok_or(METADATA)?;
        Scope::Registry.allowed(url)?;
        Ok(Package {
            name,
            version: target,
            url: url.to_owned(),
            hash: sum.iter().map(|byte| format!("{byte:02x}")).collect(),
        })
    }
}

impl Engine {
    async fn retrieve(
        &self,
        remote: &Remote,
        file: &Path,
        maximum: u64,
        stage: &'static str,
    ) -> Result<String> {
        let url = remote.url.as_deref().ok_or(METADATA)?;
        let output = http::receive(
            &self.client,
            Request {
                url,
                scope: remote.scope,
                maximum,
                file: Some(file),
                resume: false,
                algorithm: remote.algorithm,
            },
            &self.cancel,
            |bytes, total| self.progress(stage, None, Some(bytes), total),
        )
        .await?;
        if remote
            .hash
            .as_ref()
            .is_some_and(|hash| *hash != output.digest)
        {
            return Err(CHECKSUM);
        }
        Ok(output.digest)
    }

    async fn install_native(
        self: &Arc<Self>,
        agent: &str,
        platform: &str,
        binary: &str,
        alternate: Option<&str>,
        version: &str,
        work: &Path,
        generation: &Path,
    ) -> Result<Runtime> {
        let package = self.platform_package(agent, platform, version).await?;
        let archive = child(work, "platform.tgz")?;
        let mut attempt = 1;
        let output = loop {
            self.cancel.check()?;
            self.progress("downloading", Some(attempt), None, None);
            let result = http::receive(
                &self.client,
                Request {
                    url: &package.url,
                    scope: Scope::Registry,
                    maximum: 768 * 1024 * 1024,
                    file: Some(&archive),
                    resume: true,
                    algorithm: Algorithm::Sha512,
                },
                &self.cancel,
                |downloaded, total| {
                    self.progress("downloading", Some(attempt), Some(downloaded), total)
                },
            )
            .await;
            match result {
                Ok(value) => break value,
                Err(TIMEOUT | DOWNLOAD) if attempt < 3 && !self.cancel.stopped() => attempt += 1,
                Err(error) => return Err(error),
            }
        };
        self.stage("verifying");
        if output.digest != package.hash {
            return Err(CHECKSUM);
        }
        let destination = child(generation, "package")?;
        self.stage("extracting");
        let owner = Arc::clone(self);
        let names = std::iter::once(binary.to_owned())
            .chain(alternate.map(str::to_owned))
            .collect::<Vec<_>>();
        let agent = agent.to_owned();
        let version = version.to_owned();
        blocking(move || {
            archive::tar_gzip(&archive, &destination, EXPANDED_LIMIT, || {
                owner.cancel.stopped()
            })?;
            verify_package(&destination, &package.name, &package.version)?;
            let executable = find_binary(&destination, &names)?;
            runtime(agent, version, executable, None, None)
        })
        .await
    }

    async fn node(self: &Arc<Self>, work: &Path) -> Result<Node> {
        let manifest = child(&self.root, "node/active.json")?;
        let verify = manifest.clone();
        let owner = Arc::clone(self);
        let existing = blocking(move || {
            Ok(metadata_json::<Node>(&verify).ok().filter(|saved| {
                [
                    (&saved.executable, &saved.hash),
                    (&saved.npm, &saved.npm_hash),
                ]
                .into_iter()
                .all(|(file, hash)| {
                    confine(&owner.root, file).is_ok() && sha(file).ok().as_ref() == Some(hash)
                })
            }))
        })
        .await?;
        if let Some(saved) = existing {
            return Ok(saved);
        }

        self.stage("dependency");
        let sums = self
            .small(
                "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt",
                Scope::Node,
            )
            .await?;
        let sums = std::str::from_utf8(&sums).map_err(|_| DEPENDENCY)?;
        let pattern = Regex::new(&format!(
            r"(?m)^([a-f0-9]{{64}})\s+(node-v24\.[0-9.]+-win-{}\.zip)[\r ]*$",
            self.arch
        ))
        .map_err(|_| DEPENDENCY)?;
        let found = pattern.captures(sums).ok_or(DEPENDENCY)?;
        let expected = found.get(1).ok_or(DEPENDENCY)?.as_str();
        let asset = found.get(2).ok_or(DEPENDENCY)?.as_str();
        let archive = child(work, "node.zip")?;
        let url = format!("https://nodejs.org/dist/latest-v24.x/{asset}");
        let source = Remote {
            version: None,
            url: Some(url),
            hash: Some(expected.to_owned()),
            algorithm: Algorithm::Sha256,
            scope: Scope::Node,
        };
        self.retrieve(&source, &archive, 150 * 1024 * 1024, "dependency")
            .await?;
        let owner = Arc::clone(self);
        let name = asset.strip_suffix(".zip").ok_or(DEPENDENCY)?.to_owned();
        let work = work.to_owned();
        blocking(move || {
            let staged = owner.work("node", ".generation-")?;
            let expanded = child(staged.path(), "distribution")?;
            archive::zip(&archive, &expanded, EXPANDED_LIMIT, || {
                owner.cancel.stopped()
            })?;
            let base = child(&expanded, name)?;
            let executable = child(&base, "node.exe")?;
            let npm = child(&base, "node_modules/npm/bin/npm-cli.js")?;
            let hash = sha(&executable)?;
            let npm_hash = sha(&npm)?;
            let output =
                owner.execute(&executable, &hash, &["--version".into()], &work, 10, false)?;
            if !output
                .trim()
                .strip_prefix('v')
                .and_then(version)
                .is_some_and(|version| version.starts_with("24."))
            {
                return Err(DEPENDENCY);
            }
            let node = Node {
                executable,
                hash,
                npm,
                npm_hash,
            };
            owner.cancel.check()?;
            save(&manifest, &node)?;
            let _published = staged.keep();
            Ok(node)
        })
        .await
    }

    async fn npm(
        self: &Arc<Self>,
        agent: &str,
        route: &Route,
        version: &str,
        work: &Path,
        generation: &Path,
    ) -> Result<Runtime> {
        let node = self.node(work).await?;
        let owner = Arc::clone(self);
        let work = work.to_owned();
        let prefix = child(generation, "prefix")?;
        let agent = agent.to_owned();
        let version = version.to_owned();
        let (package, entry, binaries) = match route {
            Route::Node { package, entry } => (package.to_string(), Some(*entry), Vec::new()),
            Route::Native {
                platform,
                binary,
                alternate,
                ..
            } => (
                format!("{platform}{}", self.arch),
                None,
                std::iter::once(binary.to_string())
                    .chain(alternate.map(str::to_owned))
                    .collect(),
            ),
            _ => return Err(DEPENDENCY),
        };
        blocking(move || {
            let config = child(&work, "empty-user.npmrc")?;
            let global = child(&work, "empty-global.npmrc")?;
            for path in [&config, &global] {
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)
                    .map_err(|_| WRITE)?;
            }
            let args = [
                node.npm.as_os_str().to_owned(),
                "install".into(),
                "--global".into(),
                "--prefix".into(),
                prefix.as_os_str().to_owned(),
                "--registry=https://registry.npmjs.org".into(),
                format!("--userconfig={}", config.display()).into(),
                format!("--globalconfig={}", global.display()).into(),
                "--ignore-scripts".into(),
                "--include=optional".into(),
                "--no-audit".into(),
                "--no-fund".into(),
                "--no-progress".into(),
                format!("{package}@{version}").into(),
            ];
            let _npm = execution_script(&node.npm, &node.npm_hash)?;
            owner.stage("installing");
            owner.execute(&node.executable, &node.hash, &args, &work, 600, true)?;
            let folder = child(&prefix, Path::new("node_modules").join(&package))?;
            verify_package(&folder, &package, &version)?;
            if let Some(entry) = entry {
                let entry = child(&folder, entry)?;
                runtime(agent, version, node.executable, Some(entry), Some(prefix))
            } else {
                let executable = find_binary(&folder, &binaries)?;
                runtime(agent, version, executable, None, None)
            }
        })
        .await
    }

    pub async fn install(self: &Arc<Self>, agent: &str) -> Result<Outcome> {
        let route = plan(agent).ok_or("INSTALL_AGENT_REJECTED")?;
        self.stage("resolving");
        let remote = match self.metadata(agent, &route).await {
            Ok(value) => value,
            Err(_) if agent == "cursor" && !self.cancel.stopped() => Remote {
                version: None,
                url: Some(format!(
                    "https://cursor.com/api/download?platform=win32-{}&releaseTrack=stable",
                    self.arch
                )),
                hash: None,
                algorithm: Algorithm::Sha256,
                scope: Scope::Cursor,
            },
            Err(error) => return Err(error),
        };
        self.cancel.check()?;
        let work = self.work("tasks", ".install-")?;
        let candidate = self.work(agent, ".generation-")?;
        // Desktop setup remains user-interactive and owned by the task's Job.
        // Completion records a pending version check and never claims installed.
        if let Route::Desktop { publisher, .. } = &route {
            let file = child(candidate.path(), "installer.exe")?;
            self.stage("downloading");
            let digest = self
                .retrieve(&remote, &file, 1024 * 1024 * 1024, "downloading")
                .await?;
            self.stage("verifying");
            let official_version = remote.version;
            let owner = Arc::clone(self);
            let cwd = work.path().to_owned();
            let publisher = *publisher;
            return blocking(move || {
                let (pin, signed_version) = native::verify(&file, publisher)?;
                let expected = official_version.or(signed_version).ok_or(VERSION)?;
                if pin.sha256() != digest {
                    return Err(CHECKSUM);
                }
                owner.stage("awaiting-installer");
                owner.execute(&file, &digest, &[], &cwd, 900, false)?;
                Ok(Outcome::Desktop { version: expected })
            })
            .await;
        }
        let expected = remote.version.as_deref().ok_or(VERSION)?;
        let saved = match &route {
            Route::Native {
                platform,
                binary,
                alternate,
                ..
            } if matches!(agent, "codex" | "claude") => {
                self.install_native(
                    agent,
                    platform,
                    binary,
                    *alternate,
                    expected,
                    work.path(),
                    candidate.path(),
                )
                .await?
            }
            Route::Binary { binary } => {
                self.stage("downloading");
                let file = child(candidate.path(), binary)?;
                self.retrieve(&remote, &file, 1024 * 1024 * 1024, "downloading")
                    .await?;
                self.stage("verifying");
                let agent = agent.to_owned();
                let version = expected.to_owned();
                blocking(move || runtime(agent, version, file, None, None)).await?
            }
            _ => {
                self.npm(agent, &route, expected, work.path(), candidate.path())
                    .await?
            }
        };
        self.stage("postcheck");
        let owner = Arc::clone(self);
        let cwd = work.path().to_owned();
        let active = child(&self.root, Path::new(agent).join("active.json"))?;
        blocking(move || {
            owner.probe(&saved, &cwd)?;
            owner.cancel.check()?;
            save(&active, &saved)?;
            let _published = candidate.keep();
            Ok(Outcome::Installed(saved))
        })
        .await
    }

    fn inspect_local(&self, agent: &str) -> Result<Value> {
        let route = plan(agent).ok_or("INSTALL_AGENT_REJECTED")?;
        self.cancel.check()?;
        if self.local_maintenance(agent) {
            return Ok(
                json!({"state":"unverified","version":null,"managed":false,"runnable":null,"localMaintenanceRequired":true,"latest":null,"checkError":MAINTENANCE}),
            );
        }
        if let Some(managed) = self.active(agent) {
            let working = self.work("tasks", ".check-")?;
            if let Err(error) = self.probe(&managed, working.path()) {
                if matches!(error, CANCELED | "INSTALL_CLEANUP_UNCONFIRMED") {
                    return Err(error);
                }
                return Ok(
                    json!({"state":"broken","version":managed.version,"managed":true,"runnable":false}),
                );
            }
            let launch = launch_command(&managed);
            let path = managed.entry.as_ref().unwrap_or(&managed.executable);
            let bin = managed
                .bin_directory
                .as_deref()
                .or_else(|| managed.executable.parent());
            return Ok(
                json!({"state":"installed","version":managed.version,"managed":true,"runnable":true,"path":path,"searchDirectory":bin,"launchCommand":launch}),
            );
        }
        if child(&self.root, Path::new(agent).join("active.json"))?.exists() {
            return Ok(json!({"state":"broken","version":null,"managed":true,"runnable":false}));
        }
        let (files, complete, found) = if agent == "antigravity" {
            let rows = discover_antigravity(&self.environment);
            let candidates = rows["candidates"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|row| row["executable"].as_str())
                .map(PathBuf::from)
                .collect::<Vec<_>>();
            let found = !candidates.is_empty()
                || rows["launchers"]
                    .as_array()
                    .is_some_and(|rows| !rows.is_empty());
            (candidates, rows["coverage"]["complete"] == true, found)
        } else {
            let result = discover(agent, &self.environment)?;
            let found = !result.entries.is_empty();
            let files = result
                .entries
                .into_iter()
                .filter(|entry| entry.kind == "executable")
                .map(|entry| PathBuf::from(entry.path))
                .collect();
            (files, result.coverage.complete, found)
        };
        let extra = match route {
            Route::Desktop { executable, .. } => native::app_paths(executable),
            _ => Vec::new(),
        };
        let mut visited = HashSet::new();
        let mut versions = Vec::new();
        for file in files
            .into_iter()
            .chain(extra)
            .filter(|file| visited.insert(file.to_string_lossy().to_lowercase()))
        {
            self.cancel.check()?;
            if let Some(version) = native::product_version(&file) {
                versions.push((file, version));
            }
        }
        if let Some(package) = route.package() {
            if let Ok(folder) = child(
                Path::new(&self.environment.app_data),
                Path::new("npm/node_modules").join(package),
            ) {
                if let Ok(metadata) = metadata_json::<Value>(&folder.join("package.json")) {
                    if metadata["name"] == package {
                        if let Some(version) = normalized(&metadata["version"]) {
                            versions.push((folder, version));
                        }
                    }
                }
            }
        }
        Ok(match &versions[..] {
            [(path, version)] => {
                json!({"state":"installed","version":version,"path":path,"managed":false,"runnable":null})
            }
            [] => {
                json!({"state":if !complete {"incomplete"} else if found {"unverified"} else {"missing"},"version":null,"managed":false,"runnable":null})
            }
            _ => json!({"state":"multiple","version":null,"managed":false,"runnable":null}),
        })
    }

    pub async fn inspect(self: &Arc<Self>, agent: &str) -> Result<Outcome> {
        let owner = Arc::clone(self);
        let current = agent.to_owned();
        let mut local = blocking(move || owner.inspect_local(&current)).await?;
        if local["localMaintenanceRequired"] != true {
            self.stage("checking");
            let route = plan(agent).ok_or("INSTALL_AGENT_REJECTED")?;
            match self.metadata(agent, &route).await {
                Ok(remote) => {
                    local["latest"] = json!(remote.version);
                    local["checkError"] = Value::Null;
                }
                Err(CANCELED) => return Err(CANCELED),
                Err(error) => {
                    local["latest"] = Value::Null;
                    local["checkError"] = json!(error);
                }
            }
        }
        Ok(Outcome::Inspected(local))
    }
}

pub(crate) fn active_runtime(root: &Path, agent: &str) -> Option<Runtime> {
    let path = child(root, Path::new(agent).join("active.json")).ok()?;
    let saved: Runtime = metadata_json(&path).ok()?;
    if saved.agent != agent
        || version(&saved.version).is_none()
        || !hex(&saved.executable_hash, 64)
        || confine(root, &saved.executable).is_err()
        || sha(&saved.executable).ok().as_deref() != Some(&saved.executable_hash)
    {
        return None;
    }
    if let Some(entry) = &saved.entry {
        if confine(root, entry).is_err() || sha(entry).ok().as_ref() != saved.entry_hash.as_ref() {
            return None;
        }
    }
    if saved.js != saved.entry.is_some() {
        return None;
    }
    if saved
        .bin_directory
        .as_ref()
        .is_some_and(|dir| confine(root, dir).is_err())
    {
        return None;
    }
    Some(saved)
}

fn execution_script(path: &Path, expected: &str) -> Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    guard(path).map_err(|_| PATH)?;
    let lease = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x0020_0000)
        .open(path)
        .map_err(|_| PROCESS)?;
    if sha(path)? != expected {
        return Err(CHECKSUM);
    }
    Ok(lease)
}

fn verify_package(root: &Path, name: &str, version: &str) -> Result<()> {
    let metadata: Value = metadata_json(&child(root, "package.json")?)?;
    if metadata["name"] != name || metadata["version"] != version {
        return Err(METADATA);
    }
    Ok(())
}

fn find_binary(root: &Path, names: &[String]) -> Result<PathBuf> {
    let mut todo = vec![root.to_owned()];
    let mut total = 0;
    while let Some(directory) = todo.pop() {
        guard(&directory).map_err(|_| LAYOUT)?;
        for entry in fs::read_dir(directory).map_err(|_| LAYOUT)? {
            total += 1;
            if total > 5000 {
                return Err(LAYOUT);
            }
            let entry = entry.map_err(|_| LAYOUT)?;
            let file = entry.path();
            let kind = entry.file_type().map_err(|_| LAYOUT)?;
            if kind.is_dir() && guard(&file).is_ok() {
                todo.push(file);
            } else if kind.is_file()
                && names
                    .iter()
                    .any(|name| entry.file_name().eq_ignore_ascii_case(name))
            {
                confine(root, &file)?;
                return Ok(file);
            }
        }
    }
    Err(LAYOUT)
}

fn runtime(
    agent: String,
    version: String,
    executable: PathBuf,
    entry: Option<PathBuf>,
    search: Option<PathBuf>,
) -> Result<Runtime> {
    let executable_hash = sha(&executable)?;
    let entry_hash = entry.as_deref().map(sha).transpose()?;
    let bin_directory = search.or_else(|| executable.parent().map(Path::to_owned));
    Ok(Runtime {
        agent,
        version,
        executable,
        executable_hash,
        js: entry.is_some(),
        entry,
        entry_hash,
        bin_directory,
    })
}

pub fn launch_command(runtime: &Runtime) -> String {
    let quote = |file: &Path| format!("'{}'", file.to_string_lossy().replace('\'', "''"));
    let mut command = format!("& {}", quote(&runtime.executable));
    if let Some(file) = &runtime.entry {
        command.push(' ');
        command.push_str(&quote(file));
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_child_runner_pins_executable_and_uses_private_profile() -> Result<()> {
        let work = tempfile::tempdir().map_err(|_| WRITE)?;
        let root = work.path().join("agent-tools");
        let engine = Engine::new(
            root.clone(),
            Environment::default(),
            Arc::new(Cancel::default()),
            |_| {},
        )?;
        let executable = env::current_exe().map_err(|_| PROCESS)?;
        let hash = ExecutablePin::new(&executable).map_err(job_error)?.sha256();
        let args = [
            "--exact",
            "agent_install_engine::tests::probe_fixture",
            "--nocapture",
        ]
        .map(OsString::from);
        let wrong = "00".repeat(32);
        assert_eq!(
            engine.execute(&executable, &wrong, &args, work.path(), 3, false),
            Err(CHECKSUM)
        );
        let output = engine.execute(&executable, &hash, &args, work.path(), 5, false)?;
        assert!(output.contains("SYNTHETIC_VERSION_1.2.3"));
        assert!(root.join("runtime-home/AppData/Local").is_dir());
        engine.cancel.stop();
        assert_eq!(
            engine.execute(&executable, &hash, &args, work.path(), 3, false),
            Err(CANCELED)
        );
        Ok(())
    }

    #[test]
    fn probe_fixture() {
        if std::env::var_os("HOME")
            .is_some_and(|home| Path::new(&home).ends_with("agent-tools/runtime-home"))
        {
            assert!(std::env::var_os("CODEX_HOME").is_none());
            assert!(std::env::var_os("HTTP_PROXY").is_none());
            println!("SYNTHETIC_VERSION_1.2.3");
        }
    }
}
