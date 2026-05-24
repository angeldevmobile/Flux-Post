mod commands;

use commands::history::{Db, init_db};
use rusqlite::Connection;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Connection::open_in_memory().expect("failed to open SQLite");
    init_db(&conn).expect("failed to init DB");
    let db = Db(Mutex::new(conn));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            commands::http::send_request,
            commands::history::save_history,
            commands::history::get_history,
            commands::history::clear_history,
            commands::ai::generate_tests,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
