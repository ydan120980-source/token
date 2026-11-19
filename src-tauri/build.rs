fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().window_icon_path("../assets/icon.ico"),
    ))
    .unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
}
