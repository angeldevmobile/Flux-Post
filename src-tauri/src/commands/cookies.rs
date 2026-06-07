use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use super::history::Db;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CookieEntry {
    pub domain:    String,
    pub path:      String,
    pub name:      String,
    pub value:     String,
    pub expires:   Option<i64>,
    pub secure:    bool,
    pub http_only: bool,
    pub same_site: String,
    pub host_only: bool,
}

struct ParsedCookie {
    domain:    String,
    host_only: bool,
    path:      String,
    name:      String,
    value:     String,
    expires:   Option<i64>,
    secure:    bool,
    http_only: bool,
    same_site: String,
}

pub fn init_cookie_table(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cookies (
            domain     TEXT    NOT NULL,
            path       TEXT    NOT NULL DEFAULT '/',
            name       TEXT    NOT NULL,
            value      TEXT    NOT NULL,
            expires    INTEGER,
            secure     INTEGER NOT NULL DEFAULT 0,
            http_only  INTEGER NOT NULL DEFAULT 0,
            same_site  TEXT    NOT NULL DEFAULT 'Lax',
            host_only  INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (domain, name, path)
        );",
    )
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn parse_host(url: &str) -> Option<String> {
    let s = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host_part = s.split('/').next()?;
    let host = host_part.split(':').next()?;
    Some(host.to_lowercase())
}

fn parse_set_cookie_header(header: &str, request_host: &str) -> Option<ParsedCookie> {
    let mut parts = header.split(';');
    let nv_part = parts.next()?.trim();
    let eq = nv_part.find('=')?;
    let name = nv_part[..eq].trim().to_string();
    let value = nv_part[eq + 1..].to_string();
    if name.is_empty() {
        return None;
    }

    let mut domain: Option<String> = None;
    let mut path = "/".to_string();
    let mut expires: Option<i64> = None;
    let mut secure = false;
    let mut http_only = false;
    let mut same_site = "Lax".to_string();
    let mut host_only = true;

    for attr in parts {
        let attr = attr.trim();
        let lower = attr.to_lowercase();
        if lower.starts_with("domain=") {
            let d = attr[7..].trim().trim_start_matches('.').to_lowercase();
            if !d.is_empty() {
                domain = Some(d);
                host_only = false;
            }
        } else if lower.starts_with("path=") {
            let p = attr[5..].trim().to_string();
            if !p.is_empty() {
                path = p;
            }
        } else if lower.starts_with("max-age=") {
            if let Ok(secs) = lower[8..].parse::<i64>() {
                expires = Some(now_secs() + secs);
            }
        } else if lower == "secure" {
            secure = true;
        } else if lower == "httponly" {
            http_only = true;
        } else if lower.starts_with("samesite=") {
            same_site = match lower[9..].trim() {
                "strict" => "Strict",
                "none"   => "None",
                _        => "Lax",
            }
            .to_string();
        }
    }

    let final_domain = domain.unwrap_or_else(|| request_host.to_string());

    Some(ParsedCookie {
        domain: final_domain,
        host_only,
        path,
        name,
        value,
        expires,
        secure,
        http_only,
        same_site,
    })
}

// Called from http.rs after a response is received.
pub fn save_cookies_from_headers(
    conn: &Connection,
    request_url: &str,
    set_cookie_headers: &[String],
) -> SqlResult<()> {
    let host = match parse_host(request_url) {
        Some(h) => h,
        None => return Ok(()),
    };
    let now = now_secs();

    for header in set_cookie_headers {
        let Some(c) = parse_set_cookie_header(header, &host) else { continue };

        // Expired or max-age=0 → delete
        if let Some(exp) = c.expires {
            if exp <= now {
                conn.execute(
                    "DELETE FROM cookies WHERE domain=?1 AND name=?2 AND path=?3",
                    rusqlite::params![c.domain, c.name, c.path],
                )?;
                continue;
            }
        }

        conn.execute(
            "INSERT INTO cookies
               (domain, path, name, value, expires, secure, http_only, same_site, host_only, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(domain, name, path) DO UPDATE SET
               value=excluded.value, expires=excluded.expires,
               secure=excluded.secure, http_only=excluded.http_only,
               same_site=excluded.same_site",
            rusqlite::params![
                c.domain, c.path, c.name, c.value,
                c.expires, c.secure as i32, c.http_only as i32,
                c.same_site, c.host_only as i32, now,
            ],
        )?;
    }
    Ok(())
}

// Called from http.rs before a request is sent.
// Returns a "Cookie: name=val; name2=val2" header value (empty string if none).
pub fn get_cookie_header_for_url(conn: &Connection, request_url: &str) -> SqlResult<String> {
    let host = match parse_host(request_url) {
        Some(h) => h,
        None => return Ok(String::new()),
    };
    let now = now_secs();

    // Purge expired entries
    let _ = conn.execute(
        "DELETE FROM cookies WHERE expires IS NOT NULL AND expires <= ?1",
        rusqlite::params![now],
    );

    let mut stmt = conn.prepare(
        "SELECT name, value, domain, host_only FROM cookies WHERE expires IS NULL OR expires > ?1",
    )?;

    let rows: Vec<(String, String, String, bool)> = stmt
        .query_map(rusqlite::params![now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)? != 0,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let header = rows
        .into_iter()
        .filter(|(_, _, domain, host_only)| {
            if *host_only {
                host == *domain
            } else {
                host == *domain || host.ends_with(&format!(".{}", domain))
            }
        })
        .map(|(name, value, _, _)| format!("{}={}", name, value))
        .collect::<Vec<_>>()
        .join("; ");

    Ok(header)
}

//    Tauri commands                                                           

#[tauri::command]
pub fn get_all_cookies(db: tauri::State<Db>) -> Result<Vec<CookieEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_secs();

    let _ = conn.execute(
        "DELETE FROM cookies WHERE expires IS NOT NULL AND expires <= ?1",
        rusqlite::params![now],
    );

    let mut stmt = conn
        .prepare(
            "SELECT domain, path, name, value, expires, secure, http_only, same_site, host_only
               FROM cookies ORDER BY domain, name",
        )
        .map_err(|e| e.to_string())?;

    let entries = stmt
        .query_map([], |row| {
            Ok(CookieEntry {
                domain:    row.get(0)?,
                path:      row.get(1)?,
                name:      row.get(2)?,
                value:     row.get(3)?,
                expires:   row.get(4)?,
                secure:    row.get::<_, i32>(5)? != 0,
                http_only: row.get::<_, i32>(6)? != 0,
                same_site: row.get(7)?,
                host_only: row.get::<_, i32>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

#[tauri::command]
pub fn delete_cookie(
    db: tauri::State<Db>,
    domain: String,
    name: String,
    path: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM cookies WHERE domain=?1 AND name=?2 AND path=?3",
        rusqlite::params![domain, name, path],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_cookies(
    db: tauri::State<Db>,
    domain: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match domain {
        Some(d) => conn.execute("DELETE FROM cookies WHERE domain=?1", rusqlite::params![d]),
        None    => conn.execute("DELETE FROM cookies", []),
    }
    .map(|_| ())
    .map_err(|e| e.to_string())
}
