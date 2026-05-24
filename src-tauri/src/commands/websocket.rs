use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

pub struct WsConnections(pub Mutex<HashMap<String, UnboundedSender<String>>>);

#[derive(Serialize, Clone)]
pub struct WsEvent {
    pub connection_id: String,
    pub data: String,
}

#[tauri::command]
pub async fn ws_connect(
    url: String,
    app: AppHandle,
    state: State<'_, WsConnections>,
) -> Result<String, String> {
    let (ws_stream, _) = connect_async(&url).await.map_err(|e| e.to_string())?;
    let (mut sink, mut stream) = ws_stream.split();

    let conn_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    {
        state.0.lock().unwrap().insert(conn_id.clone(), tx);
    }

    // Outgoing: channel → WebSocket sink
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let conn_id_recv = conn_id.clone();

    // Incoming: WebSocket stream → Tauri events
    tokio::spawn(async move {
        while let Some(result) = stream.next().await {
            match result {
                Ok(Message::Text(text)) => {
                    let _ = app.emit("ws-message", WsEvent {
                        connection_id: conn_id_recv.clone(),
                        data: text.to_string(),
                    });
                }
                Ok(Message::Close(_)) => {
                    let _ = app.emit("ws-closed", WsEvent {
                        connection_id: conn_id_recv.clone(),
                        data: String::new(),
                    });
                    break;
                }
                Err(e) => {
                    let _ = app.emit("ws-error", WsEvent {
                        connection_id: conn_id_recv.clone(),
                        data: e.to_string(),
                    });
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(conn_id)
}

#[tauri::command]
pub async fn ws_send(
    connection_id: String,
    message: String,
    state: State<'_, WsConnections>,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    match map.get(&connection_id) {
        Some(tx) => tx.send(message).map_err(|e| e.to_string()),
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn ws_disconnect(
    connection_id: String,
    state: State<'_, WsConnections>,
) -> Result<(), String> {
    state.0.lock().unwrap().remove(&connection_id);
    Ok(())
}
