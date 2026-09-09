mod scripts;
#[cfg(test)]
mod cli_tests;
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
    name: String,
    auth: Option<YamlAuth>,
    #[serde(default)]
    headers: HashMap<String, String>,
    scripts: Option<YamlScripts>,
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
    auth: Option<YamlAuth>,
    #[serde(default)]
    headers: HashMap<String, String>,
    scripts: Option<YamlScripts>,
    #[serde(default)]
    requests: Vec<YamlRequest>,
    #[serde(default)]
    folders: Vec<YamlFolder>,
}

/// Lo que una request hereda de su carpeta y de su coleccion.
///
/// Tiene que dar el mismo resultado que `src/lib/inheritance.ts` en la app: si
/// divergen, un test pasa en la app y falla en CI, que es justo lo que este
/// runner viene a evitar.
#[derive(Default, Clone)]
struct Inherited<'a> {
    auth: Option<&'a YamlAuth>,
    headers: HashMap<String, String>,
    pre_request: Option<String>,
    post_response: Option<String>,
    /// Ruta de carpetas ("Admin/Users"), para poder filtrar con --folder.
    folder_path: String,
}

fn concat_script(outer: Option<&str>, inner: Option<&str>) -> Option<String> {
    let a = outer.map(str::trim).filter(|v| !v.is_empty());
    let b = inner.map(str::trim).filter(|v| !v.is_empty());
    match (a, b) {
        (Some(a), Some(b)) => Some(format!("{a}
{b}")),
        (Some(a), None) => Some(a.to_string()),
        (None, Some(b)) => Some(b.to_string()),
        (None, None) => None,
    }
}

/// Fusiona headers respetando que en HTTP el nombre no distingue mayusculas:
/// el nivel mas cercano pisa al de fuera en vez de añadir un segundo valor.
fn merge_headers(into: &mut HashMap<String, String>, from: &HashMap<String, String>) {
    for (k, v) in from {
        let lower = k.to_lowercase();
        into.retain(|existing, _| existing.to_lowercase() != lower);
        into.insert(k.clone(), v.clone());
    }
}

/// Aplana la coleccion resolviendo la herencia de cada request por el camino.
fn collect_requests<'a>(
    collection: &'a YamlCollection,
) -> Vec<(&'a YamlRequest, Inherited<'a>)> {
    let root = Inherited {
        auth: collection.auth.as_ref(),
        headers: collection.headers.clone(),
        pre_request: collection
            .scripts
            .as_ref()
            .and_then(|s| s.pre_request.clone()),
        post_response: collection
            .scripts
            .as_ref()
            .and_then(|s| s.post_response.clone()),
        folder_path: String::new(),
    };

    let mut out: Vec<(&YamlRequest, Inherited)> = collection
        .requests
        .iter()
        .map(|r| (r, root.clone()))
        .collect();

    fn walk<'a>(
        folders: &'a [YamlFolder],
        parent: &Inherited<'a>,
        out: &mut Vec<(&'a YamlRequest, Inherited<'a>)>,
    ) {
        for folder in folders {
            let mut headers = parent.headers.clone();
            merge_headers(&mut headers, &folder.headers);

            let ctx = Inherited {
                // El auth mas cercano gana entero: mezclar campos de dos
                // niveles daria credenciales a medias.
                auth: folder.auth.as_ref().or(parent.auth),
                headers,
                pre_request: concat_script(
                    parent.pre_request.as_deref(),
                    folder.scripts.as_ref().and_then(|s| s.pre_request.as_deref()),
                ),
                post_response: concat_script(
                    parent.post_response.as_deref(),
                    folder.scripts.as_ref().and_then(|s| s.post_response.as_deref()),
                ),
                folder_path: if parent.folder_path.is_empty() {
                    folder.name.clone()
                } else {
                    format!("{}/{}", parent.folder_path, folder.name)
                },
            };

            out.extend(folder.requests.iter().map(|r| (r, ctx.clone())));
            walk(&folder.folders, &ctx, out);
        }
    }

    walk(&collection.folders, &root, &mut out);
    out
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
    /// Variables de entorno para interpolar `{{VAR}}` dentro de la assertion.
    ///
    /// Sin esto, `json.token == "{{TOKEN}}"` comparaba contra el texto literal
    /// y fallaba siempre. Se aplica despues de partir el operador, para que un
    /// valor que contenga `==` o ` contains ` no cambie como se lee la
    /// expresion. Espejo de `resolveVars` en src/lib/assertions.ts.
    env: &'a HashMap<String, String>,
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
        let lhs = &resolve_vars(&expr[..idx], ctx.env);
        let rhs = &resolve_vars(&expr[idx + " contains ".len()..], ctx.env);
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
    // El operador ya esta elegido sobre la plantilla; solo se interpolan los lados.
    let lhs = &resolve_vars(lhs, ctx.env);
    let rhs = &resolve_vars(rhs, ctx.env);

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
        let env = HashMap::new();
        let ctx = Ctx {
            status: 200,
            json: Some(&json),
            raw_body: BODY,
            headers: &headers,
            duration_ms: 120,
            env: &env,
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
        let env = HashMap::new();
        let ctx = Ctx {
            status: 200,
            json: None,
            raw_body: "<html>nope</html>",
            headers: &headers,
            duration_ms: 10,
            env: &env,
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
        let env = HashMap::new();
        let ctx = Ctx {
            status: 200,
            json: Some(&json),
            raw_body: r#"{"id":"5"}"#,
            headers: &headers,
            duration_ms: 0,
            env: &env,
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
    /// Salida de `console.log` de los scripts: sin esto, depurar un script que
    /// falla solo en CI seria a ciegas.
    logs: Vec<String>,
}

async fn run_request(
    client: &Client,
    req: &YamlRequest,
    inh: &Inherited<'_>,
    base_url: Option<&str>,
    env: &HashMap<String, String>,
) -> RequestResult {
    // El script de pre-request suele pedir un token, asi que corre antes de
    // resolver variables: lo que escriba en el entorno tiene que aplicarse ya.
    let mut env = env.clone();
    let mut script_headers: HashMap<String, String> = HashMap::new();
    let mut script_error: Option<String> = None;
    let mut logs: Vec<String> = Vec::new();

    let pre_script = concat_script(
        inh.pre_request.as_deref(),
        req.scripts.as_ref().and_then(|s| s.pre_request.as_deref()),
    );
    if let Some(pre) = pre_script.as_deref() {
        if !pre.trim().is_empty() {
            let out = scripts::run_pre_request(pre, &env);
            env.extend(out.env);
            script_headers.extend(out.headers);
            logs.extend(out.logs);
            if let Some(e) = out.error {
                script_error = Some(format!("pre-request script: {e}"));
            }
        }
    }
    let env = &env;

    let url = resolve_vars(&join_url(base_url, &req.path), env);

    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .unwrap_or(reqwest::Method::GET);

    // Auth may need a network round trip of its own (oauth2), and it can fail in
    // ways worth reporting rather than sending an unauthenticated request.
    // El auth propio gana; si no hay, se hereda de la carpeta o la coleccion.
    let effective_auth = req.auth.as_ref().or(inh.auth);
    let applied = match effective_auth {
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
                    logs: vec![],
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

    // Se fusionan antes de mandarlos: `builder.header()` dos veces con el mismo
    // nombre añade un segundo valor en vez de reemplazarlo, asi que un header
    // de la request no llegaba a pisar al de su carpeta.
    let mut headers: HashMap<String, String> = HashMap::new();
    merge_headers(&mut headers, &inh.headers);
    let own: HashMap<String, String> = req
        .headers
        .iter()
        .map(|(k, v)| (k.clone(), resolve_vars(v, env)))
        .collect();
    merge_headers(&mut headers, &own);
    merge_headers(&mut headers, &applied.headers.iter().cloned().collect());
    merge_headers(&mut headers, &script_headers);
    for (k, v) in &headers {
        builder = builder.header(k, resolve_vars(v, env));
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
            logs: vec![],
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
                // El mismo `env` que se uso para enviar, incluido lo que haya
                // escrito el script de pre-request.
                env,
            };
            let mut assertions: Vec<AssertionResult> = req
                .tests
                .iter()
                .map(|t| evaluate_assertion(&t.assert, &ctx))
                .collect();

            // Los `pm.test()` del script post cuentan como aserciones, para que
            // una coleccion importada de Postman falle la build igual que una
            // escrita en Flux.
            let mut post_error = None;
            let post_script = concat_script(
                inh.post_response.as_deref(),
                req.scripts.as_ref().and_then(|s| s.post_response.as_deref()),
            );
            if let Some(post) = post_script.as_deref() {
                if !post.trim().is_empty() {
                    let out = scripts::run_post_response(
                        post,
                        env,
                        scripts::ScriptResponse {
                            status,
                            body: &body_raw,
                            headers: &headers,
                            duration_ms: duration_ms as u128,
                        },
                    );
                    logs.extend(out.logs);
                    for t in out.tests {
                        assertions.push(AssertionResult {
                            assertion: t.name,
                            passed: t.passed,
                            detail: t.error,
                        });
                    }
                    if let Some(e) = out.error {
                        post_error = Some(format!("post-response script: {e}"));
                    }
                }
            }

            let passed = assertions.iter().filter(|a| a.passed).count();
            let failed = assertions.iter().filter(|a| !a.passed).count();

            RequestResult {
                name: req.name.clone(),
                passed,
                failed,
                duration_ms,
                assertions,
                error: script_error.or(post_error),
                logs,
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

/// Une el baseUrl de la coleccion con la ruta de la request.
///
/// Port de `resolveRequestUrl` en src/lib/requestUrl.ts. Aqui faltaba el caso
/// de la ruta absoluta, asi que una request con url completa dentro de una
/// coleccion con baseUrl salia como "http://base//http://otra/x" en CI y bien
/// en la app.
fn join_url(base_url: Option<&str>, path: &str) -> String {
    let base = base_url.unwrap_or("").trim();
    if base.is_empty() {
        return path.to_string();
    }
    // Una ruta absoluta manda sobre el baseUrl de la coleccion.
    let is_absolute = path
        .split_once("://")
        .is_some_and(|(scheme, _)| {
            !scheme.is_empty()
                && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
        });
    if is_absolute {
        return path.to_string();
    }
    if path.is_empty() {
        return base.to_string();
    }
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

/// Lee un archivo estilo `.env`: `KEY=VALUE` por linea, `#` para comentarios,
/// comillas opcionales alrededor del valor y un `export` inicial que se ignora.
fn parse_env_file(content: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some((k, v)) = line.split_once('=') else { continue };
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let v = v.trim();
        // Solo se quitan las comillas si abren y cierran; si no, son parte del valor.
        let value = if v.len() >= 2
            && ((v.starts_with('"') && v.ends_with('"'))
                || (v.starts_with("'") && v.ends_with("'")))
        {
            &v[1..v.len() - 1]
        } else {
            v
        };
        out.insert(key.to_string(), value.to_string());
    }
    out
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
}

/// JUnit XML, que es el formato que GitLab CI, Jenkins y las GitHub Actions de
/// reporte saben leer. Una <testsuite> por coleccion y un <testcase> por
/// assertion, para que el fallo se vea en la linea exacta y no como "la
/// coleccion fallo".
fn junit_report(collections: &[JsonReport], total_ms: u64) -> String {
    let total_tests: usize = collections.iter().map(|c| c.passed + c.failed).sum();
    let total_failures: usize = collections.iter().map(|c| c.failed).sum();
    let total_errors: usize = collections
        .iter()
        .flat_map(|c| c.requests.iter())
        .filter(|r| r.error.is_some())
        .count();

    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>
");
    xml.push_str(&format!(
        "<testsuites name=\"flux\" tests=\"{}\" failures=\"{}\" errors=\"{}\" time=\"{:.3}\">
",
        total_tests,
        total_failures,
        total_errors,
        total_ms as f64 / 1000.0
    ));

    for c in collections {
        let errors = c.requests.iter().filter(|r| r.error.is_some()).count();
        xml.push_str(&format!(
            "  <testsuite name=\"{}\" tests=\"{}\" failures=\"{}\" errors=\"{}\" time=\"{:.3}\">
",
            xml_escape(&c.collection),
            c.passed + c.failed,
            c.failed,
            errors,
            c.duration_ms as f64 / 1000.0
        ));

        for r in &c.requests {
            if let Some(ref err) = r.error {
                // Una request que ni llego a responder no tiene assertions que
                // reportar: se emite como <error> para distinguirla de un fallo.
                xml.push_str(&format!(
                    "    <testcase classname=\"{}\" name=\"{}\" time=\"{:.3}\">
",
                    xml_escape(&c.collection),
                    xml_escape(&r.name),
                    r.duration_ms as f64 / 1000.0
                ));
                xml.push_str(&format!(
                    "      <error message=\"{}\"/>
",
                    xml_escape(err)
                ));
                xml.push_str("    </testcase>
");
                continue;
            }

            for a in &r.assertions {
                xml.push_str(&format!(
                    "    <testcase classname=\"{}\" name=\"{}\" time=\"{:.3}\">
",
                    xml_escape(&format!("{} / {}", c.collection, r.name)),
                    xml_escape(&a.assertion),
                    r.duration_ms as f64 / 1000.0
                ));
                if !a.passed {
                    xml.push_str(&format!(
                        "      <failure message=\"{}\"/>
",
                        xml_escape(a.detail.as_deref().unwrap_or("assertion failed"))
                    ));
                }
                xml.push_str("    </testcase>
");
            }
        }

        xml.push_str("  </testsuite>
");
    }

    xml.push_str("</testsuites>
");
    xml
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
        /// Read variables from a .env style file (repeatable, later files win)
        #[arg(long = "env-file", value_name = "PATH")]
        env_file: Vec<String>,
        /// Only run requests inside this folder, by name or path ("Admin/Users")
        #[arg(long, value_name = "NAME")]
        folder: Option<String>,
        /// Output format: console (default), json or junit
        #[arg(long, default_value = "console")]
        reporter: String,
        /// Write the report to a file instead of stdout
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
        Commands::Run { path, env: env_args, env_file, folder: folder_filter, reporter, output, bail } => {
            if !matches!(reporter.as_str(), "console" | "json" | "junit") {
                eprintln!("{}Unknown reporter \"{}\": use console, json or junit{}", RED, reporter, RESET);
                process::exit(2);
            }

            // Los --env-file van primero para que un --env suelto pueda pisarlos
            // desde la linea de comandos del pipeline.
            let mut env: HashMap<String, String> = HashMap::new();
            for f in &env_file {
                match std::fs::read_to_string(f) {
                    Ok(content) => env.extend(parse_env_file(&content)),
                    Err(e) => {
                        eprintln!("{}Cannot read env file {}: {}{}", RED, f, e, RESET);
                        process::exit(1);
                    }
                }
            }
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

                // Aplanado con la herencia ya resuelta por el camino.
                let mut all_requests = collect_requests(&collection);

                // --folder: por nombre de carpeta o por ruta ("Admin/Users").
                if let Some(ref want) = folder_filter {
                    let want_lower = want.trim_matches('/').to_lowercase();
                    all_requests.retain(|(_, inh)| {
                        let path = inh.folder_path.to_lowercase();
                        path == want_lower || path.starts_with(&format!("{want_lower}/"))
                    });
                    if all_requests.is_empty() {
                        eprintln!(
                            "{}No folder matching \"{}\" in {}{}",
                            RED, want, collection.name, RESET
                        );
                    }
                }

                // gRPC requests cannot be driven from here; running them as HTTP
                // would fire a bogus request at the base url.
                let skipped_grpc = all_requests
                    .iter()
                    .filter(|(r, _)| r.kind == "grpc" && !r.tests.is_empty())
                    .count();
                all_requests.retain(|(r, _)| r.kind != "grpc");

                let with_tests: Vec<_> =
                    all_requests.iter().filter(|(r, _)| !r.tests.is_empty()).collect();

                let with_scripts = with_tests
                    .iter()
                    .filter(|(r, inh)| {
                        let own = r.scripts.as_ref().is_some_and(|s| {
                            s.pre_request.as_deref().is_some_and(|v| !v.trim().is_empty())
                                || s.post_response.as_deref().is_some_and(|v| !v.trim().is_empty())
                        });
                        own || inh.pre_request.is_some() || inh.post_response.is_some()
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
                            "  {}running pre/post scripts on {} request(s){}",
                            DIM, with_scripts, RESET
                        );
                    }
                }

                let mut request_results: Vec<RequestResult> = vec![];
                let mut suite_passed = 0usize;
                let mut suite_failed = 0usize;

                for (req, inh) in &all_requests {
                    if req.tests.is_empty() {
                        continue;
                    }

                    let result = run_request(&client, req, inh, base.as_deref(), &env).await;

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
                            for line in &result.logs {
                                println!("    {}› {}{}", DIM, line, RESET);
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

                if reporter == "json" || reporter == "junit" {
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

            if reporter == "junit" {
                let xml = junit_report(&json_collections, start_all.elapsed().as_millis() as u64);
                match &output {
                    Some(out_path) => {
                        if let Err(e) = std::fs::write(out_path, &xml) {
                            eprintln!("{}Cannot write {}: {}{}", RED, out_path, e, RESET);
                            process::exit(1);
                        }
                        eprintln!("{}JUnit report written to {}{}", DIM, out_path, RESET);
                    }
                    None => println!("{}", xml),
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
