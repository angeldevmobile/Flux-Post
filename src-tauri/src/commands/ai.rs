use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct AiRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AiResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeContent {
    text: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeMessage {
    content: Vec<ClaudeContent>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub claude_api_key: Option<String>,
}

#[tauri::command]
pub async fn generate_tests(
    request: AiRequest,
    response: AiResponse,
    api_key: String,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("Claude API key not configured. Go to Settings to add your key.".to_string());
    }

    let prompt = format!(
        "Given this HTTP request and response, generate test assertions in YAML format.\n\n\
        Request:\n  {} {}\n  Body: {}\n\n\
        Response:\n  Status: {}\n  Body: {}\n\n\
        Return only YAML assertions like:\n\
        tests:\n  - assert: status == 200\n  - assert: body.field == value\n\
        No explanation. Only the YAML block.",
        request.method,
        request.url,
        request.body.as_deref().unwrap_or("(none)"),
        response.status,
        &response.body.chars().take(2000).collect::<String>(),
    );

    let client = Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error: {}", err));
    }

    let msg: ClaudeMessage = resp.json().await.map_err(|e| e.to_string())?;
    Ok(msg.content.into_iter().map(|c| c.text).collect::<Vec<_>>().join(""))
}

#[tauri::command]
pub async fn debug_assist(
    request: AiRequest,
    response: AiResponse,
    api_key: String,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("Claude API key not configured. Go to Settings to add your key.".to_string());
    }

    let headers_str = request
        .headers
        .as_ref()
        .map(|h| {
            h.iter()
                .map(|(k, v)| format!("  {}: {}", k, v))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    let prompt = format!(
        "An HTTP request returned a {} error. Explain the most likely cause and suggest concrete fixes.\n\n\
        Request:\n  {} {}\n  Headers:\n{}\n  Body: {}\n\n\
        Response body:\n{}\n\n\
        Reply in 3 short sections:\n\
        1. **What went wrong** (1-2 sentences)\n\
        2. **Most likely cause** (1-2 sentences)\n\
        3. **How to fix it** (bullet list, max 4 items)\n\
        Be specific to this request, not generic.",
        response.status,
        request.method,
        request.url,
        if headers_str.is_empty() { "  (none)".to_string() } else { headers_str },
        request.body.as_deref().unwrap_or("(none)"),
        &response.body.chars().take(2000).collect::<String>(),
    );

    let client = Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error: {}", err));
    }

    let msg: ClaudeMessage = resp.json().await.map_err(|e| e.to_string())?;
    Ok(msg.content.into_iter().map(|c| c.text).collect::<Vec<_>>().join(""))
}
