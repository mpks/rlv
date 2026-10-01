// The desktop app is a native window that shows the same viewer page
// (rlv_html/dist/index.html) as the web version. The page's
// src/platform/desktop.js uses the pieces below to replace browser
// features that work poorly in the Linux web engine (file chooser,
// drag-and-drop, page zoom).

/// Read a file chosen in the native dialog or dropped on the window and
/// return its raw bytes (arrives in JavaScript as an ArrayBuffer).
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running RLV");
}
