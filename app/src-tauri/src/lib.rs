// The desktop app is a native window that shows the same viewer page
// (app/dist/index.html) as the web version. The page's
// src/platform/desktop.js uses the pieces below to replace browser
// features that work poorly in the Linux web engine (file chooser,
// drag-and-drop, page zoom), and add opening files over SSH (remote.rs).
// cli.rs reads the command line (rlv FILE.expt FILE.refl, --help, --version).

mod cli;
mod remote;

/// Read a file chosen in the native dialog or dropped on the window and
/// return its raw bytes (arrives in JavaScript as an ArrayBuffer).
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

/// True if `path` is an existing file. Used to find the partner of a
/// chosen file (indexed.expt -> indexed.refl) without reading it.
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// The (expt, refl) pairs given on the command line, to open at start.
#[tauri::command]
fn startup_files(files: tauri::State<cli::StartupFiles>) -> Vec<(String, String)> {
    files.0.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any window: --help / --version / mistakes print and exit here.
    let startup = cli::parse();

    tauri::Builder::default()
        .manage(startup)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            file_exists,
            startup_files,
            remote::remote_hosts,
            remote::remote_list,
            remote::remote_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RLV");
}
