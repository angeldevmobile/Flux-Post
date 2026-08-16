use futures_util::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;
use uuid::Uuid;

pub struct SseConnections(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SseEvent {
    pub connection_id: String,
    pub event: String,
    pub data: String,
    pub id: Option<String>,
}

#[tauri::command]
pub async fn sse_connect(
    url: String,
    headers: HashMap<String, String>,
    app: AppHandle,
    state: State<'_, SseConnections>,
) -> Result<String, String> {
    let conn_id = Uuid::new_v4().to_string();
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();

    state.0.lock().unwrap().insert(conn_id.clone(), cancel_tx);

    let conn_id_task = conn_id.clone();

    tokio::spawn(async move {
        let client = match Client::builder().build() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("sse-error", SseEvent {
                    connection_id: conn_id_task,
                    event: "error".into(),
                    data: e.to_string(),
                    id: None,
                });
                return;
            }
        };

        let mut req = client
            .get(&url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache");

        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let response = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit("sse-error", SseEvent {
                    connection_id: conn_id_task,
                    event: "error".into(),
                    data: e.to_string(),
                    id: None,
                });
                return;
            }
        };

        let status = response.status().as_u16();
        let _ = app.emit("sse-open", SseEvent {
            connection_id: conn_id_task.clone(),
            event: "open".into(),
            data: status.to_string(),
            id: None,
        });

        let mut stream = Box::pin(response.bytes_stream());
        let mut buffer = String::new();
        let mut current_event = "message".to_string();
        let mut current_data = String::new();
        let mut current_id: Option<String> = None;

        loop {
            tokio::select! {
                biased;
                _ = &mut cancel_rx => {
                    let _ = app.emit("sse-closed", SseEvent {
                        connection_id: conn_id_task,
                        event: "closed".into(),
                        data: String::new(),
                        id: None,
                    });
                    return;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));

                            while let Some(pos) = buffer.find('\n') {
                                let line = buffer[..pos].trim_end_matches('\r').to_string();
                                buffer = buffer[pos + 1..].to_string();

                                if line.is_empty() {
                                    if !current_data.is_empty() {
                                        let data = current_data.trim_end_matches('\n').to_string();
                                        let _ = app.emit("sse-message", SseEvent {
                                            connection_id: conn_id_task.clone(),
                                            event: current_event.clone(),
                                            data,
                                            id: current_id.clone(),
                                        });
                                    }
                                    current_event = "message".to_string();
                                    current_data.clear();
                                } else if line.starts_with(':') {
                                    // SSE comment — ignore
                                } else if let Some(colon_pos) = line.find(':') {
                                    let field = &line[..colon_pos];
                                    let value_start = colon_pos + 1;
                                    let value = if value_start < line.len() && line.as_bytes()[value_start] == b' ' {
                                        &line[value_start + 1..]
                                    } else {
                                        &line[value_start..]
                                    };
                                    match field {
                                        "event" => current_event = value.to_string(),
                                        "data" => {
                                            if !current_data.is_empty() {
                                                current_data.push('\n');
                                            }
                                            current_data.push_str(value);
                                        }
                                        "id" => {
                                            current_id = if value.is_empty() {
                                                None
                                            } else {
                                                Some(value.to_string())
                                            };
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => {
                            let _ = app.emit("sse-error", SseEvent {
                                connection_id: conn_id_task,
                                event: "error".into(),
                                data: e.to_string(),
                                id: None,
                            });
                            return;
                        }
                        None => {
                            let _ = app.emit("sse-closed", SseEvent {
                                connection_id: conn_id_task,
                                event: "closed".into(),
                                data: String::new(),
                                id: None,
                            });
                            return;
                        }
                    }
                }
            }
        }
    });

    Ok(conn_id)
}

#[tauri::command]
pub async fn sse_disconnect(
    connection_id: String,
    state: State<'_, SseConnections>,
) -> Result<(), String> {
    if let Some(tx) = state.0.lock().unwrap().remove(&connection_id) {
        let _ = tx.send(());
    }
    Ok(())
}
