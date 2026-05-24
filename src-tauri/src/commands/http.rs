use reqwest::{header::{HeaderMap, HeaderName, HeaderValue}, Client, Method};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Instant;

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
    pub follow_redirects: Option<bool>,
    pub ssl_verify: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub size: usize,
}

#[tauri::command]
pub async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let ssl_verify = request.ssl_verify.unwrap_or(true);
    let follow_redirects = request.follow_redirects.unwrap_or(true);

    let redirect_policy = if follow_redirects {
        reqwest::redirect::Policy::default()
    } else {
        reqwest::redirect::Policy::none()
    };

    let client = Client::builder()
        .danger_accept_invalid_certs(!ssl_verify)
        .redirect(redirect_policy)
        .build()
        .map_err(|e| e.to_string())?;

    let method = Method::from_str(&request.method).map_err(|e| e.to_string())?;

    let mut header_map = HeaderMap::new();
    for (k, v) in &request.headers {
        let name = HeaderName::from_str(k).map_err(|e| e.to_string())?;
        let value = HeaderValue::from_str(v).map_err(|e| e.to_string())?;
        header_map.insert(name, value);
    }

    let mut req = client.request(method, &request.url).headers(header_map);
    if let Some(body) = request.body {
        req = req.body(body);
    }
    if let Some(ms) = request.timeout_ms {
        req = req.timeout(std::time::Duration::from_millis(ms));
    }

    let start = Instant::now();
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let duration_ms = start.elapsed().as_millis() as u64;

    let status = resp.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

    let mut resp_headers = HashMap::new();
    for (k, v) in resp.headers() {
        resp_headers.insert(
            k.to_string(),
            v.to_str().unwrap_or("").to_string(),
        );
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let size = body.len();

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text,
        headers: resp_headers,
        body,
        duration_ms,
        size,
    })
}
