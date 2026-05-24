mod commands;

use commands::history::{Db, init_db};
use commands::websocket::WsConnections;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = Connection::open_in_memory().expect("failed to open SQLite");
    init_db(&conn).expect("failed to init DB");
    let db = Db(Mutex::new(conn));
    let ws = WsConnections(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .manage(ws)
        .invoke_handler(tauri::generate_handler![
            commands::http::send_request,
            commands::history::save_history,
            commands::history::get_history,
            commands::history::clear_history,
            commands::ai::generate_tests,
            commands::ai::debug_assist,
            commands::collections::load_collections,
            commands::collections::save_collection,
            commands::websocket::ws_connect,
            commands::websocket::ws_send,
            commands::websocket::ws_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
