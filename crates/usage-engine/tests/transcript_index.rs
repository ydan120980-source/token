use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};
use usage_engine::{
    js_json,
    transcript::{
        self, FindRequest, MarkdownRequest, PartField, PartRequest, ReaderError, TranscriptControl,
    },
};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("transcript-index-{:016x}", rand::random::<u64>()));
        fs::create_dir(&path).expect("isolated fixture");
        Self(path)
    }

    fn root(&self, name: &str) -> Vec<String> {
        vec![self
            .0
            .join(name)
            .to_str()
            .expect("UTF-8 fixture path")
            .to_owned()]
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn same(value: &Value, expected: &Value, context: &str) {
    let actual = js_json::stringify(value);
    let expected = js_json::stringify(expected);
    if actual != expected {
        let offset = actual
            .chars()
            .zip(expected.chars())
            .position(|(left, right)| left != right)
            .unwrap_or_else(|| actual.chars().count().min(expected.chars().count()));
        let excerpt = |value: &str| {
            value
                .chars()
                .skip(offset.saturating_sub(64))
                .take(170)
                .collect::<String>()
        };
        panic!(
            "{context}: mismatch at {offset}\nRust: {}\nJS:   {}",
            excerpt(&actual),
            excerpt(&expected)
        );
    }
}

fn source_bytes(directory: &Path) -> Vec<(PathBuf, [u8; 32])> {
    use sha2::{Digest, Sha256};
    let mut output = Vec::new();
    for entry in fs::read_dir(directory).expect("fixture directory") {
        let path = entry.expect("fixture entry").path();
        if path.is_dir() {
            output.extend(source_bytes(&path));
        } else {
            output.push((
                path.clone(),
                Sha256::digest(fs::read(path).expect("fixture bytes")).into(),
            ));
        }
    }
    output.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    output
}

#[test]
fn storage_formats_match_js_across_sqlite_json_and_legacy_layouts() {
    use usage_engine::transcript::sweep::{self, Entry};
    let fixture = Fixture::new();
    let generator =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/transcript-storage-gen.cjs");
    let output = Command::new("node")
        .arg(generator)
        .arg(&fixture.0)
        .output()
        .expect("run JS storage reference");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let cases: Vec<Value> = serde_json::from_slice(&output.stdout).expect("storage fixtures");
    assert_eq!(cases.len(), 18);
    let before = source_bytes(&fixture.0);
    let control = TranscriptControl::default();
    for case in cases {
        let name = case["name"].as_str().expect("fixture name");
        let agent = case["agent"].as_str().expect("agent");
        let id = case["id"].as_str().expect("id");
        let roots: Vec<String> = serde_json::from_value(case["roots"].clone()).expect("roots");
        let preview = transcript::preview(agent, id, &roots, None, &control)
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        same(&preview, &case["preview"], name);
        let stamp = preview["stamp"].as_str().expect("preview stamp").to_owned();
        assert_eq!(
            json!(transcript::stamp(agent, id, &roots, &control).expect("stamp")),
            case["stamp"],
            "{name}"
        );
        same(
            &transcript::facts(agent, id, &roots, &control).expect("facts"),
            &case["facts"],
            &format!("{name}: facts"),
        );
        let request = FindRequest {
            stamp: stamp.clone(),
            query: "needle".to_owned(),
        };
        same(
            &json!(transcript::find(agent, id, &roots, &request, &control).expect("find")),
            &case["find"],
            &format!("{name}: find"),
        );
        let request = MarkdownRequest {
            stamp,
            from: 0,
            to: preview["items"].as_array().expect("items").len() - 1,
            plain: false,
        };
        same(
            &json!(transcript::markdown(agent, id, &roots, &request, &control).expect("markdown")),
            &case["markdown"],
            &format!("{name}: markdown"),
        );
        for part in case["parts"].as_array().expect("parts") {
            let request: PartRequest =
                serde_json::from_value(part["request"].clone()).expect("part request");
            same(
                &transcript::part(agent, id, &roots, &request, &control).expect("part"),
                &part["value"],
                &format!("{name}: part"),
            );
        }
        let entries = [Entry {
            key: "a".repeat(64),
            agent: agent.to_owned(),
            id: id.to_owned(),
            cwd: Some("E:/Synthetic/project".to_owned()),
        }];
        let by_agent = json!({(agent): roots});
        for golden in case["sweeps"].as_array().expect("search fixtures") {
            let query = golden["query"].as_str().expect("query");
            let hit = sweep::search(&entries, &by_agent, query, sweep::DEFAULT_BUDGET, &control)
                .expect("sweep");
            same(
                &json!(hit),
                &golden["value"],
                &format!("{name}: sweep {query}"),
            );
        }
    }
    assert_eq!(
        source_bytes(&fixture.0),
        before,
        "no source writes or retained copy"
    );
}

#[test]
fn transcript_sqlite_reads_committed_wal_without_creating_or_changing_source_files() {
    let fixture = Fixture::new();
    let file = fixture.0.join("opencode.db");
    let database = rusqlite::Connection::open(&file).expect("synthetic DB");
    let mode: String = database
        .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
        .expect("WAL mode");
    assert_eq!(mode, "wal");
    database.execute_batch("CREATE TABLE message(id TEXT,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,data TEXT);")
        .expect("schema");
    database
        .execute(
            "INSERT INTO message VALUES (?1,?2,?3)",
            ["one", "wal-session", r#"{"role":"user"}"#],
        )
        .expect("message");
    database
        .execute(
            "INSERT INTO part VALUES (?1,?2,?3,?4)",
            [
                "part",
                "one",
                "wal-session",
                r#"{"type":"text","text":"committed in WAL"}"#,
            ],
        )
        .expect("committed part");
    assert!(fixture.0.join("opencode.db-wal").is_file());
    let before = source_bytes(&fixture.0);
    let control = TranscriptControl::default();
    let value = transcript::preview("opencode", "wal-session", &fixture.root(""), None, &control)
        .expect("read committed WAL");
    assert_eq!(value["items"][0]["text"], "committed in WAL");
    assert_eq!(source_bytes(&fixture.0), before);
    database
        .execute(
            "INSERT INTO part VALUES (?1,?2,?3,?4)",
            [
                "new",
                "one",
                "wal-session",
                r#"{"type":"text","text":"committed later"}"#,
            ],
        )
        .expect("additional commit");
    let request = PartRequest {
        stamp: value["stamp"].as_str().expect("stamp").to_owned(),
        index: 0,
        field: PartField::Text,
        offset: 0,
    };
    assert_eq!(
        transcript::part(
            "opencode",
            "wal-session",
            &fixture.root(""),
            &request,
            &control
        ),
        Err(ReaderError::Changed)
    );
}

#[test]
fn reader_recognizes_each_catalog_agent_and_unreadable_kimi_code_format() {
    use usage_engine::{agent_catalog::builtin_agents, store::Store};
    let fixture = Fixture::new();
    let app = fixture.0.join("usage");
    let mut store =
        Store::new(app.to_str().expect("app root"), &json!({})).expect("isolated store");
    let catalog = builtin_agents();
    let agents = catalog.as_object().expect("catalog");
    assert_eq!(agents.len(), 17);
    let key = "6".repeat(64);
    for agent in agents.keys() {
        store.state["sessions"][&key] = json!({"agent":agent,"id":"synthetic"});
        assert!(store.transcript_target(&key).is_ok(), "{agent}");
    }
    let file = fixture
        .0
        .join("project")
        .join("synthetic")
        .join("agents")
        .join("main")
        .join("wire.jsonl");
    fs::create_dir_all(file.parent().expect("Kimi source folder")).expect("fixture");
    fs::write(
        file,
        r#"{"type":"usage.record","usageScope":"turn","time":1,"usage":{"output":1}}"#,
    )
    .expect("usage-only wire");
    assert_eq!(
        transcript::preview(
            "kimi",
            "synthetic",
            &fixture.root(""),
            None,
            &TranscriptControl::default()
        ),
        Err(ReaderError::Unsupported)
    );
}

#[test]
fn indexed_source_sweeps_match_js_and_resume_without_double_counting() {
    use std::time::Duration;
    use usage_engine::transcript::sweep::{self, Entry, FileTarget};
    let fixture = Fixture::new();
    let generator =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/transcript-sweep-gen.cjs");
    let reference = Command::new("node")
        .arg(generator)
        .arg(&fixture.0)
        .output()
        .expect("run JS sweep reference");
    assert!(
        reference.status.success(),
        "{}",
        String::from_utf8_lossy(&reference.stderr)
    );
    let sample: Value = serde_json::from_slice(&reference.stdout).expect("reference JSON");
    let roots = &sample["roots"];
    let entries: Vec<Entry> = serde_json::from_value(sample["entries"].clone()).expect("entries");
    let before = source_bytes(&fixture.0);
    let control = TranscriptControl::default();
    for (index, case) in sample["tests"]
        .as_array()
        .expect("sweep cases")
        .iter()
        .enumerate()
    {
        let budget = case["budget"]
            .as_u64()
            .map(Duration::from_millis)
            .unwrap_or(sweep::DEFAULT_BUDGET);
        let actual = match case["action"].as_str().expect("sweep operation") {
            "search" => json!(sweep::search(
                &entries,
                roots,
                case["query"].as_str().expect("query"),
                budget,
                &control
            )
            .expect("search")),
            "history" => {
                let target: FileTarget =
                    serde_json::from_value(case["target"].clone()).expect("target");
                json!(
                    sweep::file_history(&entries, roots, &target, budget, &control)
                        .expect("history")
                )
            }
            "toolUse" => json!(sweep::tool_use(&entries, roots, budget, &control).expect("usage")),
            _ => panic!("unknown sweep operation"),
        };
        same(&actual, &case["expected"], &format!("sweep case {index}"));
    }
    let first = sweep::search(
        &entries,
        roots,
        "synthetic needle",
        Duration::ZERO,
        &control,
    )
    .expect("first batch");
    assert_eq!(first.scanned, 1);
    let rest = sweep::search(
        &entries[first.scanned..],
        roots,
        "synthetic needle",
        sweep::DEFAULT_BUDGET,
        &control,
    )
    .expect("rest");
    let all = sweep::search(
        &entries,
        roots,
        "synthetic needle",
        sweep::DEFAULT_BUDGET,
        &control,
    )
    .expect("unbounded equivalent");
    assert_eq!(first.scanned + rest.scanned, all.scanned);
    assert_eq!(
        json!(first
            .results
            .into_iter()
            .chain(rest.results)
            .collect::<Vec<_>>()),
        json!(all.results)
    );
    assert_eq!(
        source_bytes(&fixture.0),
        before,
        "a sweep is read-only and request-local"
    );
    check_store_sweeps(&fixture, &sample);
}

fn check_store_sweeps(fixture: &Fixture, sample: &Value) {
    use usage_engine::{store::Store, transcript_tasks::TranscriptTasks};
    let app = fixture.0.join("usage-rust");
    let mut store = Store::new(app.to_str().expect("app directory"), &sample["roots"])
        .expect("synthetic store");
    store.state["sessions"] = sample["sessions"].clone();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("reader runtime");
    let tasks = TranscriptTasks::default();
    let before = source_bytes(&fixture.0);
    runtime.block_on(async {
        for (index, case) in sample["storeTests"]
            .as_array()
            .expect("store cases")
            .iter()
            .enumerate()
        {
            let scan = match case["action"].as_str().expect("scan type") {
                "search" => store.transcript_search(
                    serde_json::from_value(case["request"].clone()).expect("request"),
                ),
                "history" => store.transcript_file_history(
                    serde_json::from_value(case["request"].clone()).expect("request"),
                ),
                "toolUse" => Ok(store.transcript_agent_use(0)),
                _ => panic!("unknown sweep operation"),
            }
            .expect("authorized scan");
            let actual = scan.read(&tasks).await.expect("scan results");
            same(
                &actual,
                &case["expected"],
                &format!("store sweep case {index}"),
            );
        }
        tasks.close().await;
    });
    assert_eq!(
        source_bytes(&fixture.0),
        before,
        "store scan leaves sources and app state untouched"
    );
}

#[test]
fn indexed_sources_match_js_preview_parts_find_facts_and_markdown() {
    let fixture = Fixture::new();
    let generator =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/transcript-index-gen.cjs");
    let reference = Command::new("node")
        .arg(generator)
        .arg(&fixture.0)
        .output()
        .expect("run JS reader reference");
    assert!(
        reference.status.success(),
        "{}",
        String::from_utf8_lossy(&reference.stderr)
    );
    let cases: Vec<Value> = serde_json::from_slice(&reference.stdout).expect("reference JSON");
    assert_eq!(cases.len(), 7);
    let before = source_bytes(&fixture.0);
    let control = TranscriptControl::default();
    for case in cases {
        let agent = case["agent"].as_str().expect("agent");
        let id = case["id"].as_str().expect("id");
        let directory = case["directory"].as_str().expect("fixture root");
        let roots = fixture.root(directory);
        if agent == "cursor" {
            assert_eq!(
                transcript::preview(agent, "unapproved", &roots, None, &control),
                Err(ReaderError::NotFound)
            );
        }
        let preview = transcript::preview(agent, id, &roots, None, &control).expect("preview");
        same(&preview, &case["preview"], directory);
        let stamp = transcript::stamp(agent, id, &roots, &control).expect("stamp");
        assert_eq!(preview["stamp"], stamp);
        for (position, case) in case["parts"]
            .as_array()
            .expect("part cases")
            .iter()
            .enumerate()
        {
            let request: PartRequest =
                serde_json::from_value(case["request"].clone()).expect("part request");
            let result = transcript::part(agent, id, &roots, &request, &control).expect("part");
            same(
                &result,
                &case["expected"],
                &format!("{directory} part {position}"),
            );
        }
        for case in case["finds"].as_array().expect("find cases") {
            let request: FindRequest =
                serde_json::from_value(case["request"].clone()).expect("find request");
            let result = transcript::find(agent, id, &roots, &request, &control).expect("find");
            same(
                &json!(result),
                &case["expected"],
                &format!("{directory} find {}", request.query),
            );
        }
        let facts = transcript::facts(agent, id, &roots, &control).expect("facts");
        same(&facts, &case["facts"], &format!("{directory} facts"));
        let request = MarkdownRequest {
            stamp,
            from: 0,
            to: preview["items"].as_array().expect("items").len() - 1,
            plain: false,
        };
        let markdown =
            transcript::markdown(agent, id, &roots, &request, &control).expect("markdown");
        same(
            &json!(markdown),
            &case["markdown"],
            &format!("{directory} markdown"),
        );
    }
    assert_eq!(
        source_bytes(&fixture.0),
        before,
        "read operations must not touch source bytes or create a cache"
    );
}

#[test]
fn indexed_reader_checks_stamp_and_does_not_treat_ids_as_paths() {
    let fixture = Fixture::new();
    for id in ["same", "other"] {
        let path = fixture.0.join(format!("{id}.jsonl"));
        fs::write(
            path,
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"question"}}"#,
        )
        .expect("write fixture");
    }
    let roots = fixture.root("");
    let control = TranscriptControl::default();
    let preview = transcript::preview(
        "codex",
        "same",
        &roots,
        Some(&json!({"count":0,"digests":[]})),
        &control,
    )
    .expect("initial delta");
    assert_eq!(preview["schemaVersion"], "TranscriptDeltaV1");
    let merged =
        usage_engine::transcript_continuation::merge(Value::Null, preview).expect("client merge");
    assert_eq!(merged["items"][0]["text"], "question");
    assert_eq!(
        transcript::preview("codex", "../other", &roots, None, &control),
        Err(ReaderError::NotFound)
    );
    assert_eq!(
        transcript::preview("other", "same", &roots, None, &control),
        Err(ReaderError::Unsupported)
    );
    assert_eq!(
        transcript::preview(
            "codex",
            "missing",
            &roots,
            Some(&json!({"count":1,"digests":[]})),
            &control
        ),
        Err(ReaderError::InvalidPart)
    );
    let mut request = PartRequest {
        stamp: merged["stamp"].as_str().expect("stamp").to_owned(),
        index: 0,
        field: PartField::Output,
        offset: 0,
    };
    assert_eq!(
        transcript::part("codex", "same", &roots, &request, &control),
        Err(ReaderError::InvalidPart)
    );
    request.field = PartField::Text;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(fixture.0.join("same.jsonl"))
        .expect("open fixture");
    file.write_all(b"\n").expect("append line break");
    file.write_all(
        br#"{"type":"event_msg","payload":{"type":"agent_message","message":"answer"}}"#,
    )
    .expect("append");
    drop(file);
    assert_eq!(
        transcript::part("codex", "same", &roots, &request, &control),
        Err(ReaderError::Changed)
    );
    let proof = json!(usage_engine::transcript_continuation::request(&merged));
    let new = transcript::preview("codex", "same", &roots, Some(&proof), &control).expect("follow");
    assert_eq!(new["offset"], 1);
    assert_eq!(new["transcript"]["items"][0]["text"], "answer");
}

#[test]
fn store_reader_uses_saved_identity_and_releases_store_before_task() {
    use usage_engine::{
        store::Store, transcript_store::TranscriptRequest, transcript_tasks::TranscriptTasks,
    };
    let fixture = Fixture::new();
    let app = fixture.0.join("usage");
    let source = fixture.0.join("allowed");
    let unapproved = fixture.0.join("unapproved");
    fs::create_dir(&source).expect("approved source");
    fs::create_dir(&unapproved).expect("unapproved source");
    let body =
        r#"{"type":"event_msg","payload":{"type":"user_message","message":"synthetic question"}}"#;
    fs::write(source.join("own.jsonl"), body).expect("approved record");
    fs::write(unapproved.join("stray.jsonl"), body).expect("unapproved record");
    let mut store = Store::new(
        app.to_str().expect("app directory"),
        &json!({"codex": [&source]}),
    )
    .expect("synthetic store");
    let key = "a".repeat(64);
    let stray = "b".repeat(64);
    let bad = "c".repeat(64);
    store.state["sessions"][&key] = json!({"id":"own","agent":"codex"});
    store.state["sessions"][&stray] = json!({"id":"stray","agent":"codex","cwd":unapproved});
    store.state["sessions"][&bad] = json!({"id":"../unapproved/stray","agent":"codex"});
    assert!(matches!(
        store.transcript_target("own"),
        Err(ReaderError::NotFound)
    ));
    assert!(matches!(
        store.transcript_target(&bad),
        Err(ReaderError::NotFound)
    ));
    let permitted = store
        .transcript_target(&key)
        .expect("resolve allowed identity");
    let denied = store
        .transcript_target(&stray)
        .expect("resolve saved but out of scope identity");
    drop(store);
    let before = source_bytes(&fixture.0);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("reader runtime");
    let tasks = TranscriptTasks::default();
    runtime.block_on(async {
        let actual = permitted
            .read(&tasks, TranscriptRequest::Preview { proof: None })
            .await
            .expect("approved preview");
        assert_eq!(actual["items"][0]["text"], "synthetic question");
        assert_eq!(
            denied.read(&tasks, TranscriptRequest::Facts).await,
            Err(ReaderError::NotFound)
        );
        tasks.close().await;
    });
    assert_eq!(source_bytes(&fixture.0), before);
}

#[test]
fn long_reply_pages_by_fragment_without_returning_the_hidden_tail_in_preview() {
    use std::io::BufWriter;
    let fixture = Fixture::new();
    let file = fixture.0.join("long.jsonl");
    let mut writer = BufWriter::new(fs::File::create(&file).expect("fixture source"));
    let chunk = "x".repeat(512 * 1024);
    for _ in 0..64 {
        writeln!(writer, "{{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{{\"text\":\"{chunk}\"}}]}}").expect("append fragment");
    }
    writeln!(writer, "{{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{{\"text\":\"hidden tail\"}}]}}").expect("append final fragment");
    writer.flush().expect("complete fixture");
    drop(writer);
    assert!(file.metadata().expect("fixture size").len() > 32 * 1024 * 1024);
    let roots = fixture.root("");
    let control = TranscriptControl::default();
    let preview = transcript::preview("codex", "long", &roots, None, &control).expect("preview");
    let items = preview["items"].as_array().expect("items");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["text"].as_str().expect("snippet").len(), 1200);
    let offset = 64 * (chunk.len() + 2);
    assert_eq!(items[0]["length"], offset + 11);
    let request = PartRequest {
        stamp: preview["stamp"].as_str().expect("stamp").to_owned(),
        index: 0,
        field: PartField::Text,
        offset,
    };
    let tail = transcript::part("codex", "long", &roots, &request, &control)
        .expect("seek to final indexed row");
    assert_eq!(
        tail,
        json!({"text":"hidden tail","offset":offset,"total":offset + 11,"next":null,"clipped":false})
    );
}
