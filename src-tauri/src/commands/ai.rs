use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

//    shared types                                                             

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

//    private helper                                                            

async fn call_claude(
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let client = Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}]
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

fn require_key(api_key: &str) -> Result<(), String> {
    if api_key.is_empty() {
        Err("Claude API key not configured. Go to Settings → AI & Claude to add your key.".to_string())
    } else {
        Ok(())
    }
}

fn model_or_default(model: Option<String>) -> String {
    model.unwrap_or_else(|| "claude-sonnet-4-6".to_string())
}

//    commands                                                                  

#[tauri::command]
pub async fn generate_tests(
    request: AiRequest,
    response: AiResponse,
    api_key: String,
    model: Option<String>,
) -> Result<String, String> {
    require_key(&api_key)?;

    let system = "You are an API testing assistant. Generate precise test assertions in YAML format based on the HTTP request and response provided. Return only the YAML block with no explanation.";

    let user = format!(
        "Generate test assertions for this request/response.\n\n\
        Request: {} {}\nBody: {}\n\n\
        Response status: {}\nResponse body:\n{}\n\n\
        Return only YAML like:\ntests:\n  - assert: status == 200\n  - assert: body.field == value",
        request.method,
        request.url,
        request.body.as_deref().unwrap_or("(none)"),
        response.status,
        &response.body.chars().take(2000).collect::<String>(),
    );

    call_claude(&api_key, &model_or_default(model), system, &user, 1024).await
}

#[tauri::command]
pub async fn debug_assist(
    request: AiRequest,
    response: AiResponse,
    api_key: String,
    model: Option<String>,
) -> Result<String, String> {
    require_key(&api_key)?;

    let system = "You are an API debugging assistant embedded inside Flux, a native desktop API client (Tauri + Rust, no Electron). \
Know the full Flux UI so you can give precise, actionable fixes: \
REQUEST TABS — Params (query string key/value pairs), Headers (add/edit request headers), Auth (Bearer token, API Key, Basic, OAuth 2.0, AWS SigV4, mTLS), \
Body (none/json/form/multipart/binary/raw/graphql), Pre-req (JavaScript pre-request script using the pm API), \
Post-req (JavaScript post-response script), Extract (extract values from responses into environment variables). \
RESPONSE TABS — Body (formatted response body), Headers (response headers), Cookies (sent and received cookies), \
Tests (declarative assertions like 'status == 200' and 'body.id != null'; also shows AI-generated test results), \
Console (script logs and pm.console output), Timeline (waterfall: DNS + TCP + TLS + TTFB + Download). \
OTHER FEATURES — Environments panel (named envs with variables like {{BASE_URL}}, switch from the top bar), \
Collections sidebar (save and organize requests), Cookie Jar (automatic per-domain cookie storage), \
Command Palette (Ctrl+K to search all commands), Settings → AI & Claude (configure API key and model). \
Always tie your fix to a specific tab or UI element in Flux. Never give generic HTTP advice without a concrete Flux step.";

    let headers_str = request
        .headers
        .as_ref()
        .map(|h| h.iter().map(|(k, v)| format!("  {}: {}", k, v)).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();

    let user = format!(
        "A request in Flux returned a {} error. Diagnose it.\n\n\
        Request: {} {}\nHeaders sent:\n{}\nBody: {}\n\nResponse body:\n{}\n\n\
        Reply ONLY with valid JSON — no markdown, no code fences, no extra text:\n\
        {{\"what\":\"1-2 sentence explanation\",\
        \"cause\":\"1-2 sentence most likely cause\",\
        \"steps\":[\"Flux-specific step referencing tabs\"],\
        \"suggestions\":[{{\"kind\":\"header\",\"key\":\"Name\",\"value\":\"val\",\"label\":\"Short description\"}}]}}\n\
        suggestions[] is optional. Include it only for concrete one-click fixes: \
        a specific header, query param, or body value to add/change. \
        kind must be one of: header, param, body. \
        Omit suggestions entirely if the fix cannot be applied automatically.",
        response.status,
        request.method,
        request.url,
        if headers_str.is_empty() { "  (none)".to_string() } else { headers_str },
        request.body.as_deref().unwrap_or("(none)"),
        &response.body.chars().take(2000).collect::<String>(),
    );

    call_claude(&api_key, &model_or_default(model), system, &user, 1024).await
}

#[tauri::command]
pub async fn edit_content(
    content: String,
    instruction: String,
    language: String,
    api_key: String,
    model: Option<String>,
) -> Result<String, String> {
    require_key(&api_key)?;

    let system = format!(
        "You are a code editor assistant inside an HTTP API client tool (like Postman). \
        The user is editing a {} document. Apply the user's instruction and return ONLY the modified content — \
        no explanation, no markdown fences, no surrounding text. \
        Preserve formatting and indentation style. If the instruction is ambiguous, make the most reasonable edit.",
        language
    );

    let user = format!(
        "Current content:\n{}\n\nInstruction: {}",
        content, instruction
    );

    call_claude(&api_key, &model_or_default(model), &system, &user, 2048).await
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssertionFix {
    pub kind: String,   // "assertion" | "body" | "header"
    pub value: String,
    pub explanation: String,
}

#[tauri::command]
pub async fn fix_assertion(
    assertion: String,
    actual_status: u16,
    actual_body: String,
    req_method: String,
    req_url: String,
    req_body: Option<String>,
    api_key: String,
    model: Option<String>,
) -> Result<AssertionFix, String> {
    require_key(&api_key)?;

    let system = "You are an API test debugging assistant. A test assertion failed. \
        Determine the best fix: either correct the assertion to match the actual response, \
        or if the response itself is wrong, suggest what to change in the request body or headers. \
        Respond with a JSON object with these exact fields:\n\
        {\n  \"kind\": \"assertion\" | \"body\" | \"header\",\n  \"value\": \"<the fix>\",\n  \"explanation\": \"<one sentence why>\"\n}\n\
        Return only valid JSON, no markdown fences.";

    let user = format!(
        "Failing assertion: {}\n\n\
        Request: {} {}\nRequest body: {}\n\n\
        Actual response status: {}\nActual response body:\n{}\n\n\
        What is the best fix?",
        assertion,
        req_method,
        req_url,
        req_body.as_deref().unwrap_or("(none)"),
        actual_status,
        &actual_body.chars().take(2000).collect::<String>(),
    );

    let raw = call_claude(&api_key, &model_or_default(model), system, &user, 512).await?;

    serde_json::from_str::<AssertionFix>(&raw).map_err(|_| {
        // fallback: treat entire response as an assertion fix
        AssertionFix {
            kind: "assertion".to_string(),
            value: raw.trim().to_string(),
            explanation: "Claude returned an unstructured suggestion.".to_string(),
        }
        .to_string_err()
    })
}

trait ToStringErr {
    fn to_string_err(self) -> String;
}
impl ToStringErr for AssertionFix {
    fn to_string_err(self) -> String {
        format!("{}|{}|{}", self.kind, self.value, self.explanation)
    }
}

#[tauri::command]
pub async fn analyze_test_failures(
    failures_json: String,
    api_key: String,
    model: Option<String>,
) -> Result<String, String> {
    require_key(&api_key)?;

    let system = "You are an API test suite analyst. Given a list of failing test assertions and their context, \
        provide a concise diagnostic grouped by likely root cause. \
        Use markdown with bold headers. Be specific and actionable. Max 300 words.";

    let user = format!(
        "These test assertions failed in my API test suite. Analyze the failures and explain what to fix:\n\n{}",
        failures_json
    );

    call_claude(&api_key, &model_or_default(model), system, &user, 1024).await
}
