mod commands;

use commands::history::{Db, init_db};
use commands::websocket::WsConnections;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws = WsConnections(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ws)
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&data_dir)
                .expect("failed to create data dir");
            let db_path = data_dir.join("flux.db");
            let conn = Connection::open(&db_path)
                .expect("failed to open SQLite");
            init_db(&conn).expect("failed to init DB");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::http::send_request,
            commands::history::save_history,
            commands::history::get_history,
            commands::history::clear_history,
            commands::history::save_session,
            commands::history::load_session,
            commands::history::clear_session,
            commands::ai::generate_tests,
            commands::ai::debug_assist,
            commands::ai::edit_content,
            commands::ai::fix_assertion,
            commands::ai::analyze_test_failures,
            commands::collections::load_collections,
            commands::collections::save_collection,
            commands::websocket::ws_connect,
            commands::websocket::ws_send,
            commands::websocket::ws_disconnect,
            commands::oauth::oauth_auth_code,
            commands::oauth::oauth_client_credentials,
            commands::oauth::start_oauth_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
