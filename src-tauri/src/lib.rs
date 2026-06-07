mod commands;

use commands::grpc::GrpcProtos;
use commands::history::{Db, init_db};
use commands::mock::MockServerState;
use commands::sse::SseConnections;
use commands::websocket::WsConnections;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws = WsConnections(Mutex::new(HashMap::new()));
    let sse = SseConnections(Mutex::new(HashMap::new()));
    let mock = MockServerState::new();
    let grpc_protos = GrpcProtos(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ws)
        .manage(sse)
        .manage(mock)
        .manage(grpc_protos)
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
            commands::cookies::get_all_cookies,
            commands::cookies::delete_cookie,
            commands::cookies::clear_cookies,
            commands::history::save_history,
            commands::history::get_history,
            commands::history::clear_history,
            commands::history::restore_history,
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
            commands::sse::sse_connect,
            commands::sse::sse_disconnect,
            commands::oauth::oauth_auth_code,
            commands::oauth::oauth_client_credentials,
            commands::oauth::start_oauth_callback,
            commands::cli::install_cli,
            commands::cli::get_cli_status,
            commands::cli::uninstall_cli,
            commands::loadtest::run_load_test,
            commands::mock::start_mock_server,
            commands::mock::stop_mock_server,
            commands::mock::set_mock_endpoints,
            commands::mock::get_mock_endpoints,
            commands::mock::get_mock_status,
            commands::grpc::grpc_import_proto,
            commands::grpc::grpc_reflect,
            commands::grpc::grpc_invoke,
            commands::grpc::grpc_load_protos,
            commands::grpc::grpc_save_proto,
            commands::grpc::grpc_delete_proto,
            commands::grpc::grpc_rename_proto,
            commands::grpc::grpc_load_proto_by_id,
            commands::github::github_list_yaml_files,
            commands::github::github_write_yaml_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

