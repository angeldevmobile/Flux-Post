use clap::{Parser, Subcommand};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::process;
use std::time::Instant;

//   ANSI colors                                 

const GREEN: &str = "\x1b[32m";
const RED: &str = "\x1b[31m";
const CYAN: &str = "\x1b[36m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RESET: &str = "\x1b[0m";

//   YAML structures (same format as Flux app)                  

#[derive(Debug, Deserialize)]
struct YamlTest {
    assert: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct YamlAuth {
    #[serde(rename = "type")]
    auth_type: String,
    token: Option<String>,
    username: Option<String>,
    password: Option<String>,
    key: Option<String>,
    value: Option<String>,
    #[serde(rename = "in")]
    location: Option<String>,
    grant_type: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
    token_url: Option<String>,
    scopes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct YamlGraphql {
    query: Option<String>,
    variables: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct YamlScripts {
    pre_request: Option<String>,
    post_response: Option<String>,
}

fn default_kind() -> String {
    "http".to_string()
}

#[derive(Debug, Deserialize)]
struct YamlRequest {
    name: String,
    #[serde(default = "default_kind")]
    kind: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    #[serde(rename = "bodyType", alias = "body_type")]
    body_type: Option<String>,
    #[serde(default)]
    params: HashMap<String, String>,
    #[serde(default)]
    form: HashMap<String, String>,
    graphql: Option<YamlGraphql>,
    auth: Option<YamlAuth>,
    scripts: Option<YamlScripts>,
    #[serde(default)]
    tests: Vec<YamlTest>,
}

#[derive(Debug, Deserialize)]
struct YamlFolder {
    #[allow(dead_code)]
    name: String,
    #[serde(default)]
    requests: Vec<YamlRequest>,
    #[serde(default)]
    folders: Vec<YamlFolder>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YamlCollection {
    name: String,
    base_url: Option<String>,
    #[serde(default)]
    requests: Vec<YamlRequest>,
    #[serde(default)]
    folders: Vec<YamlFolder>,
}

//   Assertion evaluator (port of src/lib/testRunner.ts)             

struct AssertionResult {
    assertion: String,
    passed: bool,
    detail: Option<String>,
}

const ROOTS: &str = "status, duration, body, json or headers";

/// Mirrors `src/lib/assertions.ts`. `Absent` is a valid resolution (the field
/// was not in the response), while `Err` means the path itself is not something
/// we know how to resolve.
enum Resolved {
    Value(Value),
    Absent,
}

struct Ctx<'a> {
    status: u16,
    /// Parsed body, or None when the response was not JSON.
    json: Option<&'a Value>,
    raw_body: &'a str,
    headers: &'a HashMap<String, String>,
    duration_ms: u64,
}

fn walk(val: &Value, parts: &[&str]) -> Resolved {
    let mut cur = val;
    for part in parts {
        match cur.get(*part) {
            Some(next) => cur = next,
            None => return Resolved::Absent,
        }
    }
    Resolved::Value(cur.clone())
}

fn header_name(path: &str) -> Option<String> {
    let lower = path.to_lowercase();
    if let Some(rest) = lower.strip_prefix("headers[") {
        let inner = rest.strip_suffix(']')?.trim();
        let unquoted = inner
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .or_else(|| inner.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))?;
        return Some(unquoted.trim().to_string());
    }
    lower.strip_prefix("headers.").map(|s| s.trim().to_string())
}

/// An unknown root is an error, not null. Resolving it to null made
/// `whatever.path == null` pass against any response.
fn resolve_path(path: &str, ctx: &Ctx) -> Result<Resolved, String> {
    let p = path.trim();

    match p {
        "status" => return Ok(Resolved::Value(Value::Number(ctx.status.into()))),
        "duration" => return Ok(Resolved::Value(Value::Number(ctx.duration_ms.into()))),
        "body" | "json" => {
            return Ok(Resolved::Value(match ctx.json {
                Some(j) => j.clone(),
                None => Value::String(ctx.raw_body.to_string()),
            }))
        }
        _ => {}
    }

    if let Some(name) = header_name(p) {
        return Ok(match ctx.headers.get(&name) {
            Some(v) => Resolved::Value(Value::String(v.clone())),
            None => Resolved::Absent,
        });
    }

    let nested = p
        .strip_prefix("body.")
        .or_else(|| p.strip_prefix("json."));
    if let Some(rest) = nested {
        let Some(json) = ctx.json else {
            return Err("response body is not JSON".to_string());
        };
        let parts: Vec<&str> = rest.split('.').collect();
        return Ok(walk(json, &parts));
    }

    Err(format!("unknown path '{p}', expected {ROOTS}"))
}

fn parse_literal(s: &str) -> Value {
    let s = s.trim();
    if s == "null" { return Value::Null; }
    if s == "true" { return Value::Bool(true); }
    if s == "false" { return Value::Bool(false); }
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        return Value::String(s[1..s.len() - 1].to_string());
    }
    if let Ok(n) = s.parse::<i64>() { return Value::Number(n.into()); }
    if let Ok(f) = s.parse::<f64>() { return serde_json::json!(f); }
    Value::String(s.to_string())
}

fn as_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn loose_equals(a: Option<&Value>, b: &Value) -> bool {
    let Some(a) = a else {
        return matches!(b, Value::Null);
    };
    if matches!(a, Value::Null) {
        return matches!(b, Value::Null);
    }
    if matches!(b, Value::Null) {
        return false;
    }
    match (a, b) {
        (Value::String(s), Value::String(t)) => s == t,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        _ => match (as_number(a), as_number(b)) {
            (Some(x), Some(y)) => x == y,
            _ => a == b,
        },
    }
}

// Longest first, so `>=` is not read as `>`.
const OPS: &[&str] = &["===", "!==", "==", "!=", ">=", "<=", ">", "<"];

/// Scans left to right, preferring the longest operator at each position.
fn split_operator(expr: &str) -> Option<(&str, &str, &str)> {
    for (i, _) in expr.char_indices() {
        for op in OPS {
            if expr[i..].starts_with(op) {
                return Some((expr[..i].trim(), op, expr[i + op.len()..].trim()));
            }
        }
    }
    None
}

fn show(v: Option<&Value>) -> String {
    match v {
        None => "absent".to_string(),
        Some(v) => serde_json::to_string(v).unwrap_or_default(),
    }
}

fn evaluate_assertion(assertion: &str, ctx: &Ctx) -> AssertionResult {
    let expr = assertion.trim();
    let fail = |detail: String| AssertionResult {
        assertion: expr.to_string(),
        passed: false,
        detail: Some(detail),
    };
    let pass = || AssertionResult {
        assertion: expr.to_string(),
        passed: true,
        detail: None,
    };

    if expr.is_empty() {
        return fail("empty assertion".to_string());
    }

    // `<path> contains "text"` has no operator to split on.
    if let Some(idx) = expr.to_lowercase().find(" contains ") {
        let lhs = &expr[..idx];
        let rhs = &expr[idx + " contains ".len()..];
        let resolved = match resolve_path(lhs, ctx) {
            Ok(r) => r,
            Err(e) => return fail(e),
        };
        let needle = match parse_literal(rhs) {
            Value::String(s) => s,
            other => other.to_string(),
        };
        let haystack = match resolved {
            Resolved::Absent => return fail(format!("{} is absent", lhs.trim())),
            Resolved::Value(Value::String(s)) => s,
            Resolved::Value(v) => serde_json::to_string(&v).unwrap_or_default(),
        };
        return if haystack.contains(&needle) {
            pass()
        } else {
            fail(format!(
                "{} does not contain {}",
                serde_json::to_string(&haystack).unwrap_or_default(),
                serde_json::to_string(&needle).unwrap_or_default()
            ))
        };
    }

    let Some((lhs, op, rhs)) = split_operator(expr) else {
        return fail("could not parse assertion: expected an operator or 'contains'".to_string());
    };

    let resolved = match resolve_path(lhs, ctx) {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    let actual: Option<Value> = match resolved {
        Resolved::Value(v) => Some(v),
        Resolved::Absent => None,
    };
    let expected = parse_literal(rhs);

    if matches!(op, "==" | "===" | "!=" | "!==") {
        let equal = loose_equals(actual.as_ref(), &expected);
        let passed = if op.starts_with('!') { !equal } else { equal };
        return if passed {
            pass()
        } else {
            fail(format!(
                "expected {lhs} {op} {}, got {}",
                show(Some(&expected)),
                show(actual.as_ref())
            ))
        };
    }

    let (Some(a), Some(b)) = (actual.as_ref().and_then(as_number), as_number(&expected)) else {
        return fail(format!(
            "cannot compare {} {op} {} numerically",
            show(actual.as_ref()),
            show(Some(&expected))
        ));
    };

    let passed = match op {
        ">" => a > b,
        "<" => a < b,
        ">=" => a >= b,
        _ => a <= b,
    };

    if passed {
        pass()
    } else {
        fail(format!(
            "expected {lhs} {op} {}, got {}",
            show(Some(&expected)),
            show(actual.as_ref())
        ))
    }
}

fn collect_folder_requests<'a>(folder: &'a YamlFolder, out: &mut Vec<&'a YamlRequest>) {
    out.extend(folder.requests.iter());
    for sub in &folder.folders {
        collect_folder_requests(sub, out);
    }
}

#[cfg(test)]
mod assertion_tests {
    use super::*;

    const BODY: &str =
        r#"{"token":"abc","count":5,"nested":{"id":7},"nothing":null,"list":[1,2]}"#;

    fn check(assertion: &str) -> AssertionResult {
        let json: Value = serde_json::from_str(BODY).unwrap();
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/json".to_string());
        headers.insert("x-rate-limit".to_string(), "60".to_string());
        let ctx = Ctx {
            status: 200,
            json: Some(&json),
            raw_body: BODY,
            headers: &headers,
            duration_ms: 120,
        };
        evaluate_assertion(assertion, &ctx)
    }

    /// Mirrors the table in `src/lib/__tests__/assertions.test.ts`. Both sides
    /// must agree, or the app and CI disagree about what a collection asserts.
    #[test]
    fn the_assertion_contract_matches_the_app() {
        let table: &[(&str, bool)] = &[
            ("status == 200", true),
            ("status === 200", true),
            ("status != 404", true),
            ("status !== 200", false),
            ("status < 300", true),
            ("status <= 200", true),
            ("status > 199", true),
            ("status >= 201", false),
            ("duration < 500", true),
            ("duration > 500", false),
            (r#"json.token == "abc""#, true),
            (r#"body.token == "abc""#, true),
            ("json.count == 5", true),
            ("body.count == 5", true),
            ("json.nested.id == 7", true),
            ("body.nested.id == 7", true),
            ("json.token != null", true),
            ("json.nothing == null", true),
            ("json.missing == null", true),
            ("json.missing != null", false),
            ("json.deeply.missing.path == null", true),
            (r#"body contains "abc""#, true),
            (r#"body contains "zzz""#, false),
            (r#"json.token contains "ab""#, true),
            (r#"body.token contains "zz""#, false),
            (r#"headers["Content-Type"] == "application/json""#, true),
            (r#"headers["content-type"] == "application/json""#, true),
            (r#"headers.content-type == "application/json""#, true),
            (r#"headers.Content-Type == "application/json""#, true),
            ("headers.x-rate-limit == 60", true),
            (r#"headers["X-Nope"] == "x""#, false),
            (r#"headers["X-Nope"] == null"#, true),
            ("nonsense.path == null", false),
            ("whatever == null", false),
            ("json2.token == null", false),
            ("totally bogus", false),
            ("", false),
        ];

        for (assertion, expected) in table {
            let got = check(assertion).passed;
            assert_eq!(
                got, *expected,
                "'{assertion}' should {} but did not",
                if *expected { "pass" } else { "fail" }
            );
        }
    }

    #[test]
    fn an_unknown_root_fails_instead_of_passing_vacuously() {
        let r = check("nonsense.path == null");
        assert!(!r.passed);
        assert!(r.detail.unwrap().contains("unknown path"));
    }

    #[test]
    fn a_non_json_body_is_reported() {
        let headers = HashMap::new();
        let ctx = Ctx {
            status: 200,
            json: None,
            raw_body: "<html>nope</html>",
            headers: &headers,
            duration_ms: 10,
        };
        let r = evaluate_assertion("json.token == null", &ctx);
        assert!(!r.passed);
        assert!(r.detail.unwrap().contains("not JSON"));
    }

    #[test]
    fn ordering_against_a_non_number_fails_clearly() {
        let r = check(r#"json.token < "5""#);
        assert!(!r.passed);
        assert!(r.detail.unwrap().contains("numerically"));
    }

    #[test]
    fn failures_say_what_they_got() {
        assert!(check("status == 404").detail.unwrap().contains("got 200"));
        assert!(check("json.missing == 1").detail.unwrap().contains("got absent"));
    }

    #[test]
    fn a_numeric_string_matches_a_number() {
        let json: Value = serde_json::from_str(r#"{"id":"5"}"#).unwrap();
        let headers = HashMap::new();
        let ctx = Ctx {
            status: 200,
            json: Some(&json),
            raw_body: r#"{"id":"5"}"#,
            headers: &headers,
            duration_ms: 0,
        };
        assert!(evaluate_assertion("json.id == 5", &ctx).passed);
    }

    #[test]
    fn whitespace_around_the_operator_is_optional() {
        assert!(check("status==200").passed);
        assert!(check("  status  ==  200  ").passed);
    }
}

//   Variable interpolation

fn resolve_vars(s: &str, env: &HashMap<String, String>) -> String {
    let mut result = s.to_string();
    for (k, v) in env {
        result = result.replace(&format!("{{{{{}}}}}", k), v);
    }
    result
}

//   Auth

/// Applied to the outgoing request. Query-style credentials (an api key `in: query`)
/// have to reach the url builder, so they are returned rather than set here.
#[derive(Default)]
struct AppliedAuth {
    headers: Vec<(String, String)>,
    query: Vec<(String, String)>,
}

/// Exchanges client credentials for a token. The authorization-code grant needs a
/// browser round trip, so it cannot work unattended and is rejected up front.
async fn fetch_oauth_token(
    client: &Client,
    auth: &YamlAuth,
    env: &HashMap<String, String>,
) -> Result<String, String> {
    let grant = auth.grant_type.as_deref().unwrap_or("client_credentials");
    if grant != "client_credentials" {
        return Err(format!(
            "oauth2 grant '{grant}' needs an interactive browser, use client_credentials in CI"
        ));
    }

    let token_url = auth
        .token_url
        .as_deref()
        .map(|u| resolve_vars(u, env))
        .filter(|u| !u.is_empty())
        .ok_or("oauth2 auth is missing tokenUrl")?;

    let mut form = vec![("grant_type", "client_credentials".to_string())];
    if let Some(id) = &auth.client_id {
        form.push(("client_id", resolve_vars(id, env)));
    }
    if let Some(secret) = &auth.client_secret {
        form.push(("client_secret", resolve_vars(secret, env)));
    }
    if let Some(scopes) = auth.scopes.as_deref().filter(|s| !s.is_empty()) {
        form.push(("scope", resolve_vars(scopes, env)));
    }

    let resp = client
        .post(&token_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("oauth2 token request failed: {e}"))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("oauth2 token response was not JSON: {e}"))?;

    if !status.is_success() {
        return Err(format!("oauth2 token request returned {status}: {body}"));
    }

    body.get("access_token")
        .and_then(|t| t.as_str())
        .map(|t| t.to_string())
        .ok_or_else(|| format!("oauth2 token response has no access_token: {body}"))
}

async fn apply_auth(
    client: &Client,
    auth: &YamlAuth,
    env: &HashMap<String, String>,
) -> Result<AppliedAuth, String> {
    let v = |s: &Option<String>| s.as_deref().map(|x| resolve_vars(x, env)).unwrap_or_default();
    let mut out = AppliedAuth::default();

    match auth.auth_type.as_str() {
        "none" | "" => {}
        "bearer" => {
            out.headers.push(("Authorization".into(), format!("Bearer {}", v(&auth.token))));
        }
        "basic" => {
            use base64::Engine;
            let raw = format!("{}:{}", v(&auth.username), v(&auth.password));
            let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
            out.headers.push(("Authorization".into(), format!("Basic {encoded}")));
        }
        "apikey" => {
            let key = v(&auth.key);
            let value = v(&auth.value);
            if key.is_empty() {
                return Err("apikey auth is missing the key name".into());
            }
            match auth.location.as_deref().unwrap_or("header") {
                "query" => out.query.push((key, value)),
                _ => out.headers.push((key, value)),
            }
        }
        "oauth2" => {
            let token = fetch_oauth_token(client, auth, env).await?;
            out.headers.push(("Authorization".into(), format!("Bearer {token}")));
        }
        "awssigv4" => {
            return Err(
                "awssigv4 auth is not supported by the CLI runner yet, the request would go out unsigned"
                    .into(),
            );
        }
        other => return Err(format!("unknown auth type '{other}'")),
    }

    Ok(out)
}

//   HTTP runner

struct RequestResult {
    name: String,
    passed: usize,
    failed: usize,
    duration_ms: u64,
    assertions: Vec<AssertionResult>,
    error: Option<String>,
}

async fn run_request(
    client: &Client,
    req: &YamlRequest,
    base_url: Option<&str>,
    env: &HashMap<String, String>,
) -> RequestResult {
    let url = match base_url {
        Some(base) => resolve_vars(
            &format!("{}/{}", base.trim_end_matches('/'), req.path.trim_start_matches('/')),
            env,
        ),
        None => resolve_vars(&req.path, env),
    };

    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    // Auth may need a network round trip of its own (oauth2), and it can fail in
    // ways worth reporting rather than sending an unauthenticated request.
    let applied = match &req.auth {
        Some(auth) => match apply_auth(client, auth, env).await {
            Ok(a) => a,
            Err(e) => {
                return RequestResult {
                    name: req.name.clone(),
                    passed: 0,
                    failed: req.tests.len(),
                    duration_ms: 0,
                    assertions: vec![],
                    error: Some(e),
                }
            }
        },
        None => AppliedAuth::default(),
    };

    let mut builder = client.request(method, &url);

    let query: Vec<(String, String)> = req
        .params
        .iter()
        .map(|(k, v)| (k.clone(), resolve_vars(v, env)))
        .chain(applied.query)
        .collect();
    if !query.is_empty() {
        builder = builder.query(&query);
    }

    for (k, v) in &req.headers {
        builder = builder.header(k, resolve_vars(v, env));
    }
    for (k, v) in &applied.headers {
        builder = builder.header(k, v);
    }

    match req.body_type.as_deref() {
        Some("graphql") => {
            let g = req.graphql.as_ref();
            let query = g.and_then(|g| g.query.as_deref()).unwrap_or_default();
            let vars: Value = g
                .and_then(|g| g.variables.as_deref())
                .filter(|v| !v.trim().is_empty())
                .and_then(|v| serde_json::from_str(&resolve_vars(v, env)).ok())
                .unwrap_or(Value::Object(Default::default()));
            builder = builder.json(&serde_json::json!({
                "query": resolve_vars(query, env),
                "variables": vars,
            }));
        }
        Some("form") => {
            let fields: Vec<(String, String)> = req
                .form
                .iter()
                .map(|(k, v)| (k.clone(), resolve_vars(v, env)))
                .collect();
            builder = builder.form(&fields);
        }
        _ => {
            if let Some(body) = &req.body {
                builder = builder.body(resolve_vars(body, env));
            }
        }
    }

    let start = Instant::now();
    match builder.send().await {
        Err(e) => RequestResult {
            name: req.name.clone(),
            passed: 0,
            failed: req.tests.len(),
            duration_ms: start.elapsed().as_millis() as u64,
            assertions: vec![],
            error: Some(e.to_string()),
        },
        Ok(resp) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            let headers: HashMap<String, String> = resp
                .headers()
                .iter()
                .filter_map(|(k, v)| {
                    Some((k.as_str().to_lowercase(), v.to_str().ok()?.to_string()))
                })
                .collect();
            let body_raw = resp.text().await.unwrap_or_default();
            let json: Option<Value> = serde_json::from_str(&body_raw).ok();

            let ctx = Ctx {
                status,
                json: json.as_ref(),
                raw_body: &body_raw,
                headers: &headers,
                duration_ms,
            };
            let assertions: Vec<AssertionResult> = req
                .tests
                .iter()
                .map(|t| evaluate_assertion(&t.assert, &ctx))
                .collect();

            let passed = assertions.iter().filter(|a| a.passed).count();
            let failed = assertions.iter().filter(|a| !a.passed).count();

            RequestResult {
                name: req.name.clone(),
                passed,
                failed,
                duration_ms,
                assertions,
                error: None,
            }
        }
    }
}

//   JSON report

#[derive(Serialize)]
struct JsonSuiteReport {
    passed: usize,
    failed: usize,
    duration_ms: u64,
    collections: Vec<JsonReport>,
}

#[derive(Serialize)]
struct JsonReport {
    collection: String,
    passed: usize,
    failed: usize,
    duration_ms: u64,
    requests: Vec<JsonRequestReport>,
}

#[derive(Serialize)]
struct JsonRequestReport {
    name: String,
    passed: usize,
    failed: usize,
    duration_ms: u64,
    assertions: Vec<JsonAssertionReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct JsonAssertionReport {
    assertion: String,
    passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

//   CLI                                     

#[derive(Parser)]
#[command(name = "flux", about = "Flux CLI, run API test collections", version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run a collection or directory of collections
    Run {
        /// Path to a YAML collection file or directory
        path: String,
        /// Environment variable as KEY=VALUE (repeatable)
        #[arg(long = "env", value_name = "KEY=VALUE")]
        env: Vec<String>,
        /// Output format: console (default) or json
        #[arg(long, default_value = "console")]
        reporter: String,
        /// Write JSON report to file instead of stdout
        #[arg(long)]
        output: Option<String>,
        /// Stop on first failure
        #[arg(long)]
        bail: bool,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Run { path, env: env_args, reporter, output, bail } => {
            // Parse --env KEY=VALUE args
            let mut env: HashMap<String, String> = HashMap::new();
            for e in env_args {
                if let Some((k, v)) = e.split_once('=') {
                    env.insert(k.to_string(), v.to_string());
                }
            }

            // Collect YAML files
            let p = Path::new(&path);
            let mut files: Vec<std::path::PathBuf> = if p.is_dir() {
                std::fs::read_dir(p)
                    .expect("Cannot read directory")
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        matches!(
                            p.extension().and_then(|x| x.to_str()),
                            Some("yaml") | Some("yml")
                        )
                    })
                    .collect()
            } else {
                vec![p.to_path_buf()]
            };
            files.sort();

            if files.is_empty() {
                eprintln!("{}No YAML files found at {}{}", RED, path, RESET);
                process::exit(1);
            }

            let client = Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to build HTTP client");

            let mut total_passed = 0usize;
            let mut total_failed = 0usize;
            let mut any_error = false;
            let start_all = Instant::now();
            let mut json_collections: Vec<JsonReport> = vec![];

            for file in &files {
                let content = match std::fs::read_to_string(file) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("{}Error reading {:?}: {}{}", RED, file, e, RESET);
                        continue;
                    }
                };

                let content = content.trim_start_matches('\u{feff}');
                let collection: YamlCollection = match serde_yaml::from_str(content) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("{}Error parsing {:?}: {}{}", RED, file, e, RESET);
                        continue;
                    }
                };

                let base = collection
                    .base_url
                    .as_deref()
                    .map(|u| resolve_vars(u, &env));

                // Flatten all requests (top-level + folders, at any depth)
                let mut all_requests: Vec<&YamlRequest> =
                    collection.requests.iter().collect();
                for folder in &collection.folders {
                    collect_folder_requests(folder, &mut all_requests);
                }

                // gRPC requests cannot be driven from here; running them as HTTP
                // would fire a bogus request at the base url.
                let skipped_grpc = all_requests
                    .iter()
                    .filter(|r| r.kind == "grpc" && !r.tests.is_empty())
                    .count();
                all_requests.retain(|r| r.kind != "grpc");

                let with_tests: Vec<&&YamlRequest> =
                    all_requests.iter().filter(|r| !r.tests.is_empty()).collect();

                // Scripts run in the app's JS engine, which the CLI does not have.
                // Silently skipping them would make assertions fail for reasons
                // nobody can see from the output.
                let with_scripts = with_tests
                    .iter()
                    .filter(|r| {
                        r.scripts.as_ref().is_some_and(|s| {
                            s.pre_request.as_deref().is_some_and(|v| !v.trim().is_empty())
                                || s.post_response.as_deref().is_some_and(|v| !v.trim().is_empty())
                        })
                    })
                    .count();

                if reporter == "console" {
                    println!();
                    println!(
                        "{}{}{} {}{}  {} requests with tests{}",
                        BOLD, CYAN, collection.name, RESET,
                        DIM, with_tests.len(), RESET
                    );
                    if skipped_grpc > 0 {
                        println!(
                            "  {}skipped {} gRPC request(s), not supported by the CLI runner{}",
                            DIM, skipped_grpc, RESET
                        );
                    }
                    if with_scripts > 0 {
                        println!(
                            "  {}{} request(s) have pre/post scripts, which the CLI does not run{}",
                            DIM, with_scripts, RESET
                        );
                    }
                }

                let mut request_results: Vec<RequestResult> = vec![];
                let mut suite_passed = 0usize;
                let mut suite_failed = 0usize;

                for req in &all_requests {
                    if req.tests.is_empty() {
                        continue;
                    }

                    let result = run_request(&client, req, base.as_deref(), &env).await;

                    if reporter == "console" {
                        println!();
                        if let Some(ref err) = result.error {
                            println!(
                                "  {}✗ {}: {}{}",
                                RED, result.name, err, RESET
                            );
                            any_error = true;
                        } else {
                            println!(
                                "  {}{}{} {}  {}ms{}",
                                BOLD, result.name, RESET,
                                DIM, result.duration_ms, RESET
                            );
                            for a in &result.assertions {
                                if a.passed {
                                    println!("    {}✓{}  {}", GREEN, RESET, a.assertion);
                                } else {
                                    println!("    {}✗{}  {}", RED, RESET, a.assertion);
                                    if let Some(ref d) = a.detail {
                                        println!("         {}{}{}", DIM, d, RESET);
                                    }
                                }
                            }
                        }
                    }

                    suite_passed += result.passed;
                    suite_failed += result.failed;
                    total_passed += result.passed;
                    total_failed += result.failed;

                    let should_bail = bail && (result.failed > 0 || result.error.is_some());
                    request_results.push(result);

                    if should_bail {
                        break;
                    }
                }

                if reporter == "json" {
                    json_collections.push(JsonReport {
                        collection: collection.name,
                        passed: suite_passed,
                        failed: suite_failed,
                        duration_ms: start_all.elapsed().as_millis() as u64,
                        requests: request_results
                            .into_iter()
                            .map(|r| JsonRequestReport {
                                name: r.name,
                                passed: r.passed,
                                failed: r.failed,
                                duration_ms: r.duration_ms,
                                assertions: r
                                    .assertions
                                    .into_iter()
                                    .map(|a| JsonAssertionReport {
                                        assertion: a.assertion,
                                        passed: a.passed,
                                        detail: a.detail,
                                    })
                                    .collect(),
                                error: r.error,
                            })
                            .collect(),
                    });
                }
            }

            // Emit the consolidated JSON report once, after all collections run
            if reporter == "json" {
                let suite = JsonSuiteReport {
                    passed: total_passed,
                    failed: total_failed,
                    duration_ms: start_all.elapsed().as_millis() as u64,
                    collections: json_collections,
                };
                let json = serde_json::to_string_pretty(&suite).unwrap();
                match &output {
                    Some(out_path) => {
                        std::fs::write(out_path, &json).unwrap();
                        eprintln!("{}Report written to {}{}", DIM, out_path, RESET);
                    }
                    None => println!("{}", json),
                }
            }

            // Summary
            if reporter == "console" {
                let total_dur = start_all.elapsed().as_millis();
                println!();
                println!("{}               {}", DIM, RESET);
                if total_failed == 0 && !any_error {
                    println!(
                        "  {}{}✓ {} passed{}  {}{}ms{}",
                        BOLD, GREEN, total_passed, RESET,
                        DIM, total_dur, RESET
                    );
                } else {
                    println!(
                        "  {}{}✓ {} passed{}  {}{}✗ {} failed{}  {}{}ms{}",
                        BOLD, GREEN, total_passed, RESET,
                        BOLD, RED, total_failed, RESET,
                        DIM, total_dur, RESET
                    );
                }
                println!();
            }

            if total_failed > 0 || any_error {
                process::exit(1);
            }
        }
    }
}
