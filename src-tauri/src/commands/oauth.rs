use base64::Engine as _;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthToken {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

fn generate_code_verifier() -> String {
    let bytes: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
}

fn s256_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize())
}

async fn wait_for_code(listener: TcpListener) -> Result<String, String> {
    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| e.to_string())?;

    // "GET /callback?code=xxx&state=yyy HTTP/1.1"
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("Bad HTTP request")?;

    let query = path.splitn(2, '?').nth(1).ok_or("No query string in callback")?;

    let code = query
        .split('&')
        .find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            if k == "code" { Some(v.to_string()) } else { None }
        })
        .ok_or("No authorization code in callback")?;

    let html = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
        <html><body style='font-family:sans-serif;text-align:center;padding:48px;background:#0A0A0A;color:#E4E4E7'>\
        <h2 style='color:#A855F7'>Authentication Successful</h2>\
        <p>You can close this tab and return to Flux.</p>\
        <script>setTimeout(()=>window.close(),1500)</script>\
        </body></html>";

    stream.write_all(html).await.map_err(|e| e.to_string())?;
    stream.flush().await.map_err(|e| e.to_string())?;

    Ok(code)
}

async fn exchange_code(
    code: &str,
    client_id: &str,
    client_secret: Option<&str>,
    verifier: &str,
    redirect_uri: &str,
    token_url: &str,
) -> Result<OAuthToken, String> {
    let client = Client::new();

    let mut params: Vec<(&str, &str)> = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("code_verifier", verifier),
    ];

    let secret_buf;
    if let Some(s) = client_secret {
        secret_buf = s.to_string();
        params.push(("client_secret", &secret_buf));
    }

    let resp = client
        .post(token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        let desc = json.get("error_description")
            .and_then(|d| d.as_str())
            .unwrap_or("");
        return Err(format!("{}: {}", err.as_str().unwrap_or("oauth_error"), desc));
    }

    Ok(OAuthToken {
        access_token: json["access_token"].as_str().unwrap_or("").to_string(),
        token_type: json["token_type"].as_str().unwrap_or("Bearer").to_string(),
        expires_in: json["expires_in"].as_u64(),
        refresh_token: json["refresh_token"].as_str().map(|s| s.to_string()),
        scope: json["scope"].as_str().map(|s| s.to_string()),
    })
}

/// Starts Authorization Code + PKCE flow. Opens browser, waits for callback,
/// exchanges code for token, emits "oauth-token" or "oauth-error" event.
/// Returns the local redirect port so the frontend knows the flow started.
#[tauri::command]
pub async fn oauth_auth_code(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: Option<String>,
    auth_url: String,
    token_url: String,
    scopes: String,
) -> Result<u16, String> {
    use tauri_plugin_opener::OpenerExt;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let verifier = generate_code_verifier();
    let challenge = s256_challenge(&verifier);

    let mut auth_uri = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&code_challenge={}&code_challenge_method=S256",
        auth_url,
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&challenge),
    );
    if !scopes.trim().is_empty() {
        auth_uri.push_str(&format!("&scope={}", urlencoding::encode(&scopes)));
    }

    app.opener()
        .open_url(&auth_uri, None::<&str>)
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    tokio::spawn(async move {
        match wait_for_code(listener).await {
            Ok(code) => {
                match exchange_code(
                    &code,
                    &client_id,
                    client_secret.as_deref(),
                    &verifier,
                    &redirect_uri,
                    &token_url,
                )
                .await
                {
                    Ok(token) => { let _ = app_handle.emit("oauth-token", token); }
                    Err(e) => { let _ = app_handle.emit("oauth-error", e); }
                }
            }
            Err(e) => { let _ = app_handle.emit("oauth-error", e); }
        }
    });

    Ok(port)
}

/// Starts a local callback server on a fixed port for Supabase GitHub OAuth.
/// Emits "supabase-oauth-code" with the code when the redirect arrives.
#[tauri::command]
pub async fn start_oauth_callback(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:42813")
        .await
        .map_err(|e| format!("Port 42813 in use: {}", e))?;

    tokio::spawn(async move {
        match wait_for_code(listener).await {
            Ok(code) => { let _ = app.emit("supabase-oauth-code", code); }
            Err(e)   => { let _ = app.emit("supabase-oauth-error", e); }
        }
    });

    Ok(42813)
}

/// Client Credentials flow — no browser needed, returns token directly.
#[tauri::command]
pub async fn oauth_client_credentials(
    client_id: String,
    client_secret: String,
    token_url: String,
    scopes: String,
) -> Result<OAuthToken, String> {
    let client = Client::new();
    let mut params: Vec<(&str, &str)> = vec![
        ("grant_type", "client_credentials"),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
    ];
    if !scopes.trim().is_empty() {
        params.push(("scope", &scopes));
    }

    let resp = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        let desc = json.get("error_description")
            .and_then(|d| d.as_str())
            .unwrap_or("");
        return Err(format!("{}: {}", err.as_str().unwrap_or("oauth_error"), desc));
    }

    Ok(OAuthToken {
        access_token: json["access_token"].as_str().unwrap_or("").to_string(),
        token_type: json["token_type"].as_str().unwrap_or("Bearer").to_string(),
        expires_in: json["expires_in"].as_u64(),
        refresh_token: json["refresh_token"].as_str().map(|s| s.to_string()),
        scope: json["scope"].as_str().map(|s| s.to_string()),
    })
}
