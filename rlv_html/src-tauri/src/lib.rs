// The desktop app is a native window that shows the same viewer page
// (rlv_html/dist/index.html) as the web version. No native commands are
// exposed to the page yet.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running RLV");
}
