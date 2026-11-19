use serde_json::Value;
use std::{path::Path, process::Command};
use usage_engine::session_list_codec;
use usage_engine::{js_json, session_list};

fn compare(section: &str, mut run: impl FnMut(&[Value]) -> Result<Value, String>) {
    let script =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-reader-gen.cjs");
    let output = Command::new("node")
        .arg(script)
        .arg(section)
        .output()
        .expect("run JS fixture generator");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let cases: Vec<Value> = serde_json::from_slice(&output.stdout).expect("decode fixtures");
    assert!(!cases.is_empty(), "missing {section} fixtures");
    for (index, case) in cases.iter().enumerate() {
        let args = case["args"].as_array().expect("arguments");
        let actual = run(args);
        if let Some(error) = case["error"].as_str() {
            assert_eq!(
                actual.as_ref().map_err(String::as_str),
                Err(error),
                "{section} #{index}"
            );
        } else {
            let actual = js_json::stringify(&actual.expect("successful Rust result"));
            let expected = case["expected"].as_str().expect("expected JS JSON");
            if actual != expected {
                let offset = actual
                    .chars()
                    .zip(expected.chars())
                    .position(|(left, right)| left != right)
                    .unwrap_or_else(|| actual.chars().count().min(expected.chars().count()));
                let context = |value: &str| {
                    value
                        .chars()
                        .skip(offset.saturating_sub(60))
                        .take(160)
                        .collect::<String>()
                };
                panic!(
                    "{section} #{index} mismatch at {offset}\nRust: {}\nJS:   {}",
                    context(&actual),
                    context(expected)
                );
            }
        }
    }
}

struct TempDirectory(std::path::PathBuf);

impl TempDirectory {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "session-reader-parity-{:016x}",
            rand::random::<u64>()
        ));
        std::fs::create_dir(&dir).expect("isolated synthetic directory");
        Self(dir)
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn labels_match_js_persistence_and_rejections() {
    use usage_engine::session_labels::{SessionLabels, FILE};
    let directory = TempDirectory::new();
    let file = directory.0.join(FILE);
    let mut labels = SessionLabels::open(&directory.0);
    compare("labels", |args| {
        match args[0].as_str().expect("operation") {
            "init" => {
                std::fs::write(&file, args[1].as_str().expect("legacy contents"))
                    .expect("write legacy file");
                labels = SessionLabels::open(&directory.0);
            }
            "set" => {
                let previous = std::fs::read(&file).expect("saved state");
                if let Err(error) = labels.set(args[1].as_str().expect("key"), &args[2]) {
                    assert_eq!(std::fs::read(&file).expect("saved state"), previous);
                    return Err(error.to_string());
                }
            }
            "restart" => labels = SessionLabels::open(&directory.0),
            "bytes" => {
                return Ok(Value::String(
                    std::fs::read_to_string(&file).expect("persisted JSON"),
                ))
            }
            operation => panic!("unknown label operation: {operation}"),
        }
        Ok(Value::Object(labels.all().to_owned()))
    });
}

#[test]
fn session_list_whitelist_matches_js() {
    compare("list", |args| {
        let list = session_list::select_sessions(&args[0], Some(&args[1]))
            .map_err(|error| error.to_string())?;
        serde_json::to_value(list).map_err(|error| error.to_string())
    });
}

#[test]
fn packed_session_lists_match_js_wire_and_validation() {
    compare("pack", |args| {
        let wire = session_list_codec::pack(&args[0], Some(&args[1]))
            .map_err(|error| error.to_string())?;
        let iterable = session_list_codec::pack_iterable(
            &args[0],
            args[0]["sessions"].as_array().expect("session rows").iter(),
            Some(&args[1]),
        )
        .map_err(|error| error.to_string())?;
        assert_eq!(wire, iterable);
        String::from_utf8(wire.session_bytes)
            .map(Value::String)
            .map_err(|error| error.to_string())
    });
    compare("unpack", |args| {
        let selected = session_list_codec::unpack(
            "SessionListBytesV1",
            args[0].as_str().expect("wire bytes").as_bytes(),
        )
        .map_err(|error| error.to_string())?;
        serde_json::to_value(selected).map_err(|error| error.to_string())
    });
}

#[test]
fn jsonl_lines_match_js_and_seek_directly_to_indexed_rows() {
    use std::ops::ControlFlow;
    use usage_engine::transcript_lines::JsonlReader;
    let dir = TempDirectory::new();
    let file = dir.0.join("own.jsonl");
    compare("lines", |args| {
        std::fs::write(&file, args[0].as_str().expect("source text"))
            .expect("write synthetic JSONL");
        let mut reader =
            JsonlReader::open(&file, 1024 * 1024).map_err(|error| error.to_string())?;
        let (mut rows, mut lines, mut index) = (vec![], vec![], vec![]);
        reader
            .visit(|span, line, decoded| {
                lines.push(line.to_owned());
                if let Some(decoded) = decoded {
                    rows.push(decoded);
                    index.push(span);
                }
                ControlFlow::Continue(())
            })
            .map_err(|error| error.to_string())?;
        for (span, row) in index.into_iter().zip(&rows).rev() {
            assert_eq!(
                reader
                    .read_at(span)
                    .map_err(|error| error.to_string())?
                    .as_ref(),
                Some(row)
            );
        }
        Ok(serde_json::json!({"rows": rows, "lines": lines}))
    });
}

#[test]
fn jsonl_rejects_replaced_and_changed_files_even_on_early_exit() {
    use std::{io::Write, ops::ControlFlow};
    use usage_engine::transcript_lines::{JsonlReader, LineError};
    let dir = TempDirectory::new();
    let file = dir.0.join("own.jsonl");
    std::fs::write(&file, "{\"one\":1}\n{\"two\":2}\n").expect("write synthetic JSONL");
    assert!(matches!(
        JsonlReader::open(&file, 2),
        Err(LineError::SizeOrLink)
    ));
    assert!(matches!(
        JsonlReader::open(&dir.0, 1024),
        Err(LineError::SizeOrLink)
    ));
    let mut reader = JsonlReader::open(&file, 1024).expect("opened source");
    let result = reader.visit(|_, _, value| {
        assert_eq!(value.expect("first row")["one"], 1);
        let mut writable = std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .expect("synthetic append");
        writeln!(writable, "{{\"three\":3}}").expect("append data");
        ControlFlow::Break(())
    });
    assert!(matches!(result, Err(LineError::Busy)));
    drop(reader);
    let reader = JsonlReader::open(&file, 1024).expect("reopen source");
    let copy = dir.0.join("closed.jsonl");
    std::fs::copy(&file, &copy).expect("identical copy, different identity");
    let original = dir.0.join("original.jsonl");
    std::fs::rename(&file, &original).expect("move opened source");
    std::fs::rename(&copy, &file).expect("replace path");
    assert!(matches!(reader.verify(), Err(LineError::Busy)));
}

#[test]
fn recorded_file_changes_match_js() {
    use usage_engine::transcript_changes;
    compare("changes", |args| {
        let text = |index: usize| args[index].as_str().expect("fixture text");
        let actual = match text(0) {
            "diffLines" => serde_json::to_value(transcript_changes::diff_lines(text(1), text(2))),
            "change" => serde_json::to_value(transcript_changes::change(text(1), &args[2])),
            "antigravity" => serde_json::to_value(transcript_changes::from_antigravity(
                text(1),
                &serde_json::from_value(args[2].clone()).expect("file text"),
            )),
            _ => panic!("unknown fixture operation"),
        };
        actual.map_err(|error| error.to_string())
    });
}

#[test]
fn transcript_prefix_checkpoints_match_js() {
    use usage_engine::transcript_continuation as delta;
    compare("prefix", |args| {
        let actual = match args[0].as_str().expect("operation") {
            "request" => serde_json::to_value(delta::request(&args[1])),
            "validate" => {
                serde_json::to_value(delta::validate(&args[1]).map_err(|error| error.to_string())?)
            }
            "make" => serde_json::to_value(
                delta::make(args[1].clone(), args[2].as_str().expect("id"), &args[3])
                    .map_err(|error| error.to_string())?,
            ),
            "merge" => {
                return delta::merge(args[1].clone(), args[2].clone())
                    .map_err(|error| error.to_string())
            }
            _ => panic!("unknown fixture operation"),
        };
        actual.map_err(|error| error.to_string())
    });
}

#[test]
fn transcript_marks_match_js() {
    use usage_engine::transcript_marks;
    compare("marks", |args| {
        let text = args[1].as_str().unwrap_or_default();
        let actual = match args[0].as_str().expect("operation") {
            "classify" => serde_json::to_value(transcript_marks::classify(text)),
            "slash" => serde_json::to_value(transcript_marks::slash(text)),
            "citations" => serde_json::to_value(transcript_marks::citations(text)),
            "codeMode" => serde_json::to_value(transcript_marks::code_mode(text)),
            _ => panic!("unknown fixture operation"),
        };
        actual.map_err(|error| error.to_string())
    });
}

#[test]
fn saved_session_projection_and_packed_bytes_match_js() {
    let directory = TempDirectory::new();
    let mut store = usage_engine::store::Store::new(
        directory.0.to_str().expect("fixture path"),
        &serde_json::json!({}),
    )
    .expect("synthetic store");
    compare("projection", |args| {
        for field in ["records", "duplicateIds", "sessions", "sequence"] {
            store.state[field] = args[0][field].clone();
        }
        let list = store.session_list(&args[1])?;
        let wire = store.session_list_packed(&args[1])?;
        let decoded = session_list_codec::unpack(wire.schema_version, &wire.session_bytes)
            .map_err(|error| error.to_string())?;
        let list = serde_json::to_value(list).expect("list DTO");
        let decoded = serde_json::to_value(decoded).expect("decoded DTO");
        assert_eq!(js_json::stringify(&decoded), js_json::stringify(&list));
        let packed = String::from_utf8(wire.session_bytes).expect("UTF-8 wire");
        Ok(serde_json::json!({"list": list, "packed": packed}))
    });
}

#[test]
fn transcript_lane_retains_ownership_after_timeout_and_drains_on_close() {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::Duration,
    };
    use usage_engine::transcript_tasks::{TranscriptTasks, TranscriptUnreadable};
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("test runtime");
    runtime.block_on(async {
        let tasks = Arc::new(TranscriptTasks::new(Duration::from_millis(150)));
        let released = Arc::new(AtomicBool::new(false));
        let (release, await_release) = std::sync::mpsc::channel();
        let (entered, await_entered) = tokio::sync::oneshot::channel();
        let first = tokio::spawn({
            let tasks = tasks.clone();
            let released = released.clone();
            async move {
                tasks
                    .run(move |_| {
                        entered.send(()).expect("confirm start");
                        await_release
                            .recv_timeout(Duration::from_secs(5))
                            .expect("release first operation");
                        released.store(true, Ordering::Release);
                        Ok::<_, TranscriptUnreadable>(1)
                    })
                    .await
            }
        });
        tokio::time::timeout(Duration::from_secs(5), await_entered)
            .await
            .expect("admission")
            .expect("started");
        assert_eq!(first.await.expect("join first"), Err(TranscriptUnreadable));
        let second = tokio::spawn({
            let tasks = tasks.clone();
            let released = released.clone();
            async move {
                tasks
                    .run(move |_| {
                        assert!(released.load(Ordering::Acquire));
                        Ok::<_, TranscriptUnreadable>(2)
                    })
                    .await
            }
        });
        release.send(()).expect("release first operation");
        assert_eq!(second.await.expect("join second"), Ok(2));

        let tasks = Arc::new(TranscriptTasks::default());
        let (entered, await_entered) = tokio::sync::oneshot::channel();
        let active = tokio::spawn({
            let tasks = tasks.clone();
            async move {
                tasks
                    .run(move |budget| {
                        entered.send(()).expect("confirm start");
                        while budget.check().is_ok() {
                            std::thread::sleep(Duration::from_millis(1));
                        }
                        Ok::<_, TranscriptUnreadable>(3)
                    })
                    .await
            }
        });
        await_entered.await.expect("started");
        let pending = tokio::spawn({
            let tasks = tasks.clone();
            async move {
                tasks
                    .run(|_| -> Result<(), TranscriptUnreadable> {
                        panic!("closed lane ran queued work")
                    })
                    .await
            }
        });
        tokio::time::timeout(Duration::from_secs(5), tasks.close())
            .await
            .expect("drained");
        assert_eq!(
            active.await.expect("join active"),
            Err(TranscriptUnreadable)
        );
        assert_eq!(
            pending.await.expect("join pending"),
            Err(TranscriptUnreadable)
        );
        assert_eq!(
            tasks.run(|_| Ok::<_, TranscriptUnreadable>(())).await,
            Err(TranscriptUnreadable)
        );
    });
}
