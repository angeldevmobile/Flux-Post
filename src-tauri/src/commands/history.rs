use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub duration_ms: u64,
    pub timestamp: String,
    pub environment: String,
}

pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            method      TEXT NOT NULL,
            url         TEXT NOT NULL,
            status      INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
            environment TEXT NOT NULL DEFAULT ''
        );",
    )?;
    // migration for existing DBs without the environment column
    let _ = conn.execute_batch("ALTER TABLE history ADD COLUMN environment TEXT NOT NULL DEFAULT '';");
    Ok(())
}

#[tauri::command]
pub fn save_history(
    db: tauri::State<Db>,
    method: String,
    url: String,
    status: u16,
    duration_ms: u64,
    environment: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO history (method, url, status, duration_ms, environment) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![method, url, status, duration_ms, environment],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_history(db: tauri::State<Db>) -> Result<Vec<HistoryEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, method, url, status, duration_ms, timestamp, environment FROM history ORDER BY id DESC LIMIT 200")
        .map_err(|e| e.to_string())?;

    let entries = stmt
        .query_map([], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                method: row.get(1)?,
                url: row.get(2)?,
                status: row.get(3)?,
                duration_ms: row.get(4)?,
                timestamp: row.get(5)?,
                environment: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

#[tauri::command]
pub fn clear_history(db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
