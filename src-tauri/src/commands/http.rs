use base64::Engine as _;
use reqwest::{header::{HeaderMap, HeaderName, HeaderValue, SET_COOKIE}, Client, Method, Proxy};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Instant;
use super::history::Db;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub key: String,
    pub value: Option<String>,
    pub file_base64: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_base64: Option<String>,
    pub multipart_fields: Option<Vec<MultipartField>>,
    pub timeout_ms: Option<u64>,
    pub follow_redirects: Option<bool>,
    pub ssl_verify: Option<bool>,
    pub proxy_http: Option<String>,
    pub proxy_https: Option<String>,
    pub no_proxy: Option<String>,
    pub proxy_ssl_verify: Option<bool>,
    pub client_cert_pem: Option<String>,
    pub client_key_pem: Option<String>,
    pub use_cookies: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub size: usize,
    pub body_encoding: String, // "text" | "base64"
    pub set_cookies: Vec<String>,
    pub sent_cookies: Vec<String>,
}

#[tauri::command]
pub async fn send_request(
    db: tauri::State<'_, Db>,
    request: HttpRequest,
) -> Result<HttpResponse, String> {
    let ssl_verify = request.ssl_verify.unwrap_or(true);
    let follow_redirects = request.follow_redirects.unwrap_or(true);
    let proxy_ssl_verify = request.proxy_ssl_verify.unwrap_or(true);

    let has_proxy = request.proxy_http.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
        || request.proxy_https.as_ref().map(|s| !s.is_empty()).unwrap_or(false);

    // When a proxy is in use, also consider proxy_ssl_verify for cert validation
    let effective_ssl_verify = ssl_verify && (!has_proxy || proxy_ssl_verify);

    // Always disable auto-redirect so we can manually follow and capture Set-Cookie from each hop
    let redirect_policy = reqwest::redirect::Policy::none();

    let mut builder = Client::builder()
        .danger_accept_invalid_certs(!effective_ssl_verify)
        .redirect(redirect_policy);

    if let Some(ref proxy_url) = request.proxy_http {
        if !proxy_url.is_empty() {
            let mut proxy = Proxy::http(proxy_url).map_err(|e| e.to_string())?;
            if let Some(ref no_proxy) = request.no_proxy {
                if !no_proxy.is_empty() {
                    proxy = proxy.no_proxy(reqwest::NoProxy::from_string(no_proxy));
                }
            }
            builder = builder.proxy(proxy);
        }
    }

    if let Some(ref proxy_url) = request.proxy_https {
        if !proxy_url.is_empty() {
            let mut proxy = Proxy::https(proxy_url).map_err(|e| e.to_string())?;
            if let Some(ref no_proxy) = request.no_proxy {
                if !no_proxy.is_empty() {
                    proxy = proxy.no_proxy(reqwest::NoProxy::from_string(no_proxy));
                }
            }
            builder = builder.proxy(proxy);
        }
    }

    // Client certificate for mutual TLS (mTLS)
    if let Some(ref cert_pem) = request.client_cert_pem {
        if !cert_pem.is_empty() {
            let key_pem = request.client_key_pem.as_deref().unwrap_or("");
            let mut combined = cert_pem.clone();
            if !key_pem.is_empty() {
                combined.push('\n');
                combined.push_str(key_pem);
            }
            let identity = reqwest::Identity::from_pem(combined.as_bytes())
                .map_err(|e| format!("Invalid client certificate: {e}"))?;
            builder = builder.identity(identity);
        }
    }

    let client = builder.build().map_err(|e| e.to_string())?;

    let method = Method::from_str(&request.method).map_err(|e| e.to_string())?;

    let mut header_map = HeaderMap::new();
    for (k, v) in &request.headers {
        let name = HeaderName::from_str(k).map_err(|e| e.to_string())?;
        let value = HeaderValue::from_str(v).map_err(|e| e.to_string())?;
        header_map.insert(name, value);
    }

    // Inject stored cookies for this URL when cookie jar is enabled
    let mut sent_cookies: Vec<String> = Vec::new();
    if request.use_cookies.unwrap_or(false) {
        if let Ok(conn) = db.0.lock() {
            if let Ok(cookie_header) = super::cookies::get_cookie_header_for_url(&conn, &request.url) {
                if !cookie_header.is_empty() && !header_map.contains_key(reqwest::header::COOKIE) {
                    if let Ok(val) = HeaderValue::from_str(&cookie_header) {
                        header_map.insert(reqwest::header::COOKIE, val);
                    }
                }
                sent_cookies = cookie_header
                    .split(';')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }
    }

    let mut req = client.request(method, &request.url).headers(header_map);

    if let Some(fields) = request.multipart_fields {
        let mut form = reqwest::multipart::Form::new();
        for field in fields.into_iter().filter(|f| f.enabled && !f.key.is_empty()) {
            if let Some(b64) = field.file_base64 {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&b64)
                    .map_err(|e| e.to_string())?;
                let file_name = field.file_name.unwrap_or_default();
                let mime = field.mime_type.unwrap_or_else(|| "application/octet-stream".into());
                let part = reqwest::multipart::Part::bytes(bytes)
                    .file_name(file_name)
                    .mime_str(&mime)
                    .map_err(|e| e.to_string())?;
                form = form.part(field.key, part);
            } else if let Some(val) = field.value {
                form = form.text(field.key, val);
            }
        }
        req = req.multipart(form);
    } else if let Some(b64) = request.body_base64 {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .map_err(|e| e.to_string())?;
        req = req.body(bytes);
    } else if let Some(body) = request.body {
        req = req.body(body);
    }

    if let Some(ms) = request.timeout_ms {
        req = req.timeout(std::time::Duration::from_millis(ms));
    }

    let start = Instant::now();
    let mut resp = req.send().await.map_err(|e| e.to_string())?;
    let mut all_set_cookies: Vec<String> = Vec::new();
    let mut hops = 0u32;

    // Manually follow redirects so we can capture Set-Cookie from each hop
    while follow_redirects && resp.status().is_redirection() && hops < 10 {
        for val in resp.headers().get_all(SET_COOKIE).iter() {
            if let Ok(s) = val.to_str() {
                all_set_cookies.push(s.to_string());
            }
        }
        let location = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        match location {
            Some(loc) => {
                // Use the response URL to correctly resolve relative redirects
                let next_url = resp.url().join(&loc)
                    .map(|u| u.to_string())
                    .unwrap_or(loc);
                resp = client.get(&next_url).send().await.map_err(|e| e.to_string())?;
                hops += 1;
            }
            None => break,
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;

    let status = resp.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

    // Collect Set-Cookie from final response + captured from redirect hops
    let mut set_cookies: Vec<String> = resp
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .collect();
    set_cookies.append(&mut all_set_cookies);

    let mut resp_headers = HashMap::new();
    for (k, v) in resp.headers() {
        resp_headers.insert(
            k.to_string(),
            v.to_str().unwrap_or("").to_string(),
        );
    }

    // Persist cookies to SQLite when cookie jar is enabled
    if request.use_cookies.unwrap_or(false) && !set_cookies.is_empty() {
        if let Ok(conn) = db.0.lock() {
            let _ = super::cookies::save_cookies_from_headers(&conn, &request.url, &set_cookies);
        }
    }

    let ct = resp_headers
        .get("content-type")
        .map(|s| s.as_str())
        .unwrap_or("")
        .to_lowercase();

    let is_binary = ct.starts_with("image/")
        || ct.contains("application/octet-stream")
        || ct.contains("application/pdf");

    let (body, body_encoding, size) = if is_binary {
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let sz = bytes.len();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        (b64, "base64".to_string(), sz)
    } else {
        let text = resp.text().await.map_err(|e| e.to_string())?;
        let sz = text.len();
        (text, "text".to_string(), sz)
    };

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text,
        headers: resp_headers,
        set_cookies,
        sent_cookies,
        body,
        duration_ms,
        size,
        body_encoding,
    })
}
