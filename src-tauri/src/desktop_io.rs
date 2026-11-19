use serde_json::{json, Value};
use std::{io::Write, path::Path, time::Duration};
use tauri::{AppHandle, Url, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

pub async fn clipboard(app: AppHandle, text: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clipboard = app.clipboard();
        for attempt in 0..3 {
            if clipboard.write_text(text.as_str()).is_ok()
                && clipboard.read_text().is_ok_and(|result| result == text)
            {
                return Ok(json!({"copied": true}));
            }
            if attempt < 2 {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        Err("CLIPBOARD_WRITE_FAILED".to_owned())
    })
    .await
    .map_err(|_| "CLIPBOARD_WRITE_FAILED".to_owned())?
}

fn write_export(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

pub async fn save(
    window: WebviewWindow,
    title: &'static str,
    name: String,
    label: &'static str,
    extension: &'static str,
    content: String,
    rows: Option<usize>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !window.is_visible().unwrap_or(false) {
            return Err("READER_WINDOW_CLOSED".to_owned());
        }
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title)
            .set_file_name(name)
            .add_filter(label, &[extension])
            .blocking_save_file();
        let Some(chosen) = chosen else {
            return Ok(json!({"canceled": true}));
        };
        let path = chosen.into_path().map_err(|_| "EXPORT_PATH_INVALID")?;
        write_export(&path, content.as_bytes()).map_err(|_| "EXPORT_WRITE_FAILED")?;
        Ok(match rows {
            Some(rows) => json!({"saved": true, "rows": rows}),
            None => json!({"saved": true}),
        })
    })
    .await
    .map_err(|_| "EXPORT_WRITE_FAILED".to_owned())?
}

pub async fn choose_source(
    window: WebviewWindow,
    cursor: bool,
) -> Result<Option<std::path::PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !window.is_visible().unwrap_or(false) {
            return Err("READER_WINDOW_CLOSED".to_owned());
        }
        let chooser = window.dialog().file().set_parent(&window);
        let selected = if cursor {
            chooser
                .set_title("选择 Cursor SDK index.db、runs.ndjson 或用量 CSV")
                .add_filter("Cursor 用量记录", &["db", "csv", "ndjson"])
                .blocking_pick_file()
        } else {
            chooser.set_title("选择本地用量目录").blocking_pick_folder()
        };
        selected
            .map(|path| {
                path.into_path()
                    .map_err(|_| "SOURCE_PATH_REJECTED".to_owned())
            })
            .transpose()
    })
    .await
    .map_err(|_| "SOURCE_DIALOG_FAILED".to_owned())?
}

pub fn transcript_name(name: Option<&str>) -> String {
    let replaced: String = name
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if matches!(
                c,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\u{0}'..='\u{1f}'
            ) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut units = 0;
    let stem: String = words
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 60
        })
        .collect();
    format!(
        "{}.md",
        if stem.is_empty() {
            "AgentUsage-session"
        } else {
            &stem
        }
    )
}

pub fn link(value: &str) -> Result<Url, String> {
    let rejected = || "LINK_REJECTED".to_owned();
    if value.encode_utf16().count() > 2048 {
        return Err(rejected());
    }
    let url = Url::parse(value).map_err(|_| rejected())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(rejected());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::{link, transcript_name, write_export};

    #[test]
    fn exported_names_and_external_links_keep_the_desktop_boundaries() {
        assert_eq!(transcript_name(Some("  foo/:bar  ")), "foo bar.md");
        assert_eq!(transcript_name(Some("\\:*?")), "AgentUsage-session.md");
        assert_eq!(
            transcript_name(Some(&"😀".repeat(40)))
                .encode_utf16()
                .count(),
            63
        );
        assert!(link("https://example.invalid/read").is_ok());
        for value in [
            "https://user:pass@example.invalid/read",
            "file:///C:/secret",
            "javascript:alert(1)",
        ] {
            assert_eq!(link(value).err().as_deref(), Some("LINK_REJECTED"));
        }
    }

    #[test]
    fn export_content_replaces_only_the_dialog_selected_file() -> std::io::Result<()> {
        let folder = tempfile::tempdir()?;
        let path = folder.path().join("export.csv");
        write_export(&path, b"one")?;
        write_export(&path, b"two")?;
        assert_eq!(std::fs::read(&path)?, b"two");
        assert_eq!(std::fs::read_dir(folder.path())?.count(), 1);
        Ok(())
    }
}
