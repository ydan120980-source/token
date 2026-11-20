#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod codex_host;
mod desktop_io;
#[cfg(windows)]
mod desktop_shell;
#[cfg(windows)]
mod github_host;
#[cfg(windows)]
mod quota_host;
#[cfg(windows)]
mod quiet_refresh;
mod reader;
#[cfg(windows)]
mod tray_card;
#[cfg(windows)]
mod update_host;
#[cfg(windows)]
mod website_login;
mod webview_profile;
mod window_shell;

#[cfg(windows)]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    if let Some(result) = statusline() {
        return result;
    }
    match reader::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("{code}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(windows)]
fn statusline() -> Option<std::process::ExitCode> {
    let mut args = std::env::args_os().skip(1);
    if args.next()?.as_os_str() != "--statusline" {
        return None;
    }
    let result = (|| {
        let id = args.next()?;
        let id = id.to_str()?;
        if args.next().is_some() {
            return None;
        }
        let appdata = std::path::PathBuf::from(std::env::var_os("APPDATA")?);
        if !appdata.is_absolute() {
            return None;
        }
        let root = appdata.join("dev.quotadock.reader").join("quota");
        quota_engine::provider_passive::receive(&root, id, std::io::stdin().lock()).ok()?;
        Some(std::process::ExitCode::SUCCESS)
    })();
    Some(result.unwrap_or(std::process::ExitCode::FAILURE))
}
