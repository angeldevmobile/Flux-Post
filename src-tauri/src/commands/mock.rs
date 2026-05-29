use axum::{Router, extract::State, response::Response, body::Body};
use http::Request;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;
use tokio::net::TcpListener;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockEndpoint {
    pub id: String,
    pub method: String,      // "GET" | "POST" | "*" etc.
    pub path: String,        // "/api/users" or "/api/users/*"
    pub status: u16,
    pub body: String,
    pub content_type: String,
    pub delay_ms: u64,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockStatus {
    pub running: bool,
    pub port: u16,
    pub endpoint_count: usize,
}

type SharedEndpoints = Arc<RwLock<Vec<MockEndpoint>>>;

pub struct MockServerState {
    pub endpoints: SharedEndpoints,
    pub abort: Mutex<Option<tokio::task::AbortHandle>>,
    pub port: Mutex<u16>,
    pub running: Mutex<bool>,
}

impl MockServerState {
    pub fn new() -> Self {
        Self {
            endpoints: Arc::new(RwLock::new(Vec::new())),
            abort: Mutex::new(None),
            port: Mutex::new(3001),
            running: Mutex::new(false),
        }
    }
}

fn path_matches(pattern: &str, path: &str) -> bool {
    if pattern == "*" || pattern == "/*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix("/*") {
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    pattern == path
}

async fn mock_handler(
    State(endpoints): State<SharedEndpoints>,
    req: Request<Body>,
) -> Response<Body> {
    let method = req.method().as_str().to_uppercase();
    let path = req.uri().path().to_string();

    let eps = endpoints.read().await;
    let matched = eps.iter().find(|e| {
        e.enabled
            && (e.method == "*" || e.method.to_uppercase() == method)
            && path_matches(&e.path, &path)
    });

    match matched {
        Some(ep) => {
            let status = ep.status;
            let body_str = ep.body.clone();
            let ct = ep.content_type.clone();
            let delay = ep.delay_ms;
            drop(eps);

            if delay > 0 {
                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
            }

            Response::builder()
                .status(status)
                .header("Content-Type", ct)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "*")
                .header("Access-Control-Allow-Headers", "*")
                .body(Body::from(body_str))
                .unwrap_or_else(|_| Response::new(Body::empty()))
        }
        None => {
            drop(eps);
            let payload = format!(
                r#"{{"error":"No matching mock endpoint","path":"{}","method":"{}"}}"#,
                path, method
            );
            Response::builder()
                .status(404)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(payload))
                .unwrap_or_else(|_| Response::new(Body::empty()))
        }
    }
}

#[tauri::command]
pub async fn start_mock_server(
    state: tauri::State<'_, MockServerState>,
    port: u16,
) -> Result<(), String> {
    let already = *state.running.lock().unwrap();
    if already {
        return Err("Mock server is already running. Stop it first.".into());
    }

    let endpoints = state.endpoints.clone();
    let app = Router::new()
        .fallback(mock_handler)
        .with_state(endpoints);

    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| format!("Cannot bind to port {port}: {e}"))?;

    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    *state.abort.lock().unwrap() = Some(handle.abort_handle());
    *state.port.lock().unwrap() = port;
    *state.running.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
pub fn stop_mock_server(state: tauri::State<'_, MockServerState>) -> Result<(), String> {
    let mut running = state.running.lock().unwrap();
    if !*running {
        return Err("Mock server is not running.".into());
    }
    if let Some(abort) = state.abort.lock().unwrap().take() {
        abort.abort();
    }
    *running = false;
    Ok(())
}

#[tauri::command]
pub async fn set_mock_endpoints(
    state: tauri::State<'_, MockServerState>,
    endpoints: Vec<MockEndpoint>,
) -> Result<(), String> {
    *state.endpoints.write().await = endpoints;
    Ok(())
}

#[tauri::command]
pub async fn get_mock_endpoints(
    state: tauri::State<'_, MockServerState>,
) -> Result<Vec<MockEndpoint>, String> {
    Ok(state.endpoints.read().await.clone())
}

#[tauri::command]
pub async fn get_mock_status(state: tauri::State<'_, MockServerState>) -> Result<MockStatus, String> {
    let running = *state.running.lock().unwrap();
    let port = *state.port.lock().unwrap();
    let endpoint_count = state.endpoints.read().await.len();
    Ok(MockStatus { running, port, endpoint_count })
}
