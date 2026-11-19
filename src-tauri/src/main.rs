#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod desktop_io;
#[cfg(windows)]
mod quota_host;
mod reader;
#[cfg(windows)]
mod tray_card;
mod window_shell;

#[cfg(windows)]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> std::process::ExitCode {
    match reader::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("{code}");
            std::process::ExitCode::FAILURE
        }
    }
}
