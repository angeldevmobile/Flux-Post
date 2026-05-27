use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
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
    super::cookies::init_cookie_table(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            method      TEXT NOT NULL,
            url         TEXT NOT NULL,
            status      INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
            environment TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS session (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            access_token  TEXT NOT NULL,
            refresh_token TEXT,
            expires_at    INTEGER,
            user_id       TEXT,
            user_email    TEXT,
            user_name     TEXT,
            user_avatar   TEXT
        );",
    )?;
    let _ = conn.execute_batch("ALTER TABLE history ADD COLUMN environment TEXT NOT NULL DEFAULT '';");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub access_token:  String,
    pub refresh_token: Option<String>,
    pub expires_at:    Option<i64>,
    pub user_id:       Option<String>,
    pub user_email:    Option<String>,
    pub user_name:     Option<String>,
    pub user_avatar:   Option<String>,
}

#[tauri::command]
pub fn save_session(
    db: tauri::State<Db>,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
    user_id: Option<String>,
    user_email: Option<String>,
    user_name: Option<String>,
    user_avatar: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO session (id, access_token, refresh_token, expires_at, user_id, user_email, user_name, user_avatar)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           access_token=excluded.access_token, refresh_token=excluded.refresh_token,
           expires_at=excluded.expires_at, user_id=excluded.user_id,
           user_email=excluded.user_email, user_name=excluded.user_name,
           user_avatar=excluded.user_avatar",
        rusqlite::params![access_token, refresh_token, expires_at, user_id, user_email, user_name, user_avatar],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_session(db: tauri::State<Db>) -> Result<Option<SessionRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT access_token, refresh_token, expires_at, user_id, user_email, user_name, user_avatar FROM session WHERE id=1")
        .map_err(|e| e.to_string())?;
    let row = stmt.query_row([], |r| {
        Ok(SessionRow {
            access_token:  r.get(0)?,
            refresh_token: r.get(1)?,
            expires_at:    r.get(2)?,
            user_id:       r.get(3)?,
            user_email:    r.get(4)?,
            user_name:     r.get(5)?,
            user_avatar:   r.get(6)?,
        })
    });
    match row {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn clear_session(db: tauri::State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM session WHERE id=1", []).map_err(|e| e.to_string())?;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEntry {
    pub method: String,
    pub url: String,
    pub status: u16,
    pub duration_ms: u64,
    pub environment: String,
    pub timestamp: String,
}

#[tauri::command]
pub fn restore_history(
    db: tauri::State<Db>,
    entries: Vec<RestoreEntry>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for e in entries {
        conn.execute(
            "INSERT OR IGNORE INTO history (method, url, status, duration_ms, environment, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![e.method, e.url, e.status, e.duration_ms, e.environment, e.timestamp],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
