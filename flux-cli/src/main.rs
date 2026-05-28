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

#[derive(Debug, Deserialize)]
struct YamlRequest {
    name: String,
    method: String,
    path: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    #[serde(default)]
    tests: Vec<YamlTest>,
}

#[derive(Debug, Deserialize)]
struct YamlFolder {
    name: String,
    #[serde(default)]
    requests: Vec<YamlRequest>,
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

fn get_nested(val: &Value, parts: &[&str]) -> Value {
    if parts.is_empty() {
        return val.clone();
    }
    match val.get(parts[0]) {
        Some(next) => get_nested(next, &parts[1..]),
        None => Value::Null,
    }
}

fn resolve_lhs(
    path: &str,
    status: u16,
    body: &Value,
    headers: &HashMap<String, String>,
    duration_ms: u64,
) -> Value {
    match path {
        "status" => Value::Number(status.into()),
        "duration" => Value::Number(duration_ms.into()),
        "body" => body.clone(),
        p if p.starts_with("body.") => {
            let parts: Vec<&str> = p[5..].split('.').collect();
            get_nested(body, &parts)
        }
        p if p.starts_with("headers.") => {
            let key = p[8..].to_lowercase();
            headers
                .get(&key)
                .map(|v| Value::String(v.clone()))
                .unwrap_or(Value::Null)
        }
        _ => Value::Null,
    }
}

fn parse_rhs(s: &str) -> Value {
    let s = s.trim();
    if s == "null" { return Value::Null; }
    if s == "true" { return Value::Bool(true); }
    if s == "false" { return Value::Bool(false); }
    if let Ok(n) = s.parse::<i64>() { return Value::Number(n.into()); }
    if let Ok(f) = s.parse::<f64>() { return serde_json::json!(f); }
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        return Value::String(s[1..s.len() - 1].to_string());
    }
    Value::String(s.to_string())
}

fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(n), Value::Number(m)) => n.as_f64() == m.as_f64(),
        (Value::String(s), Value::String(t)) => s == t,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Null, Value::Null) => true,
        (Value::Number(n), Value::String(s)) => {
            s.parse::<f64>().map(|f| n.as_f64() == Some(f)).unwrap_or(false)
        }
        (Value::String(s), Value::Number(n)) => {
            s.parse::<f64>().map(|f| Some(f) == n.as_f64()).unwrap_or(false)
        }
        _ => a == b,
    }
}

// Operators ordered so multi-char ops are checked before single-char
const OPS: &[&str] = &["!=", "==", ">=", "<=", ">", "<"];

fn evaluate_assertion(
    assertion: &str,
    status: u16,
    body: &Value,
    headers: &HashMap<String, String>,
    duration_ms: u64,
) -> AssertionResult {
    for &op in OPS {
        if let Some(idx) = assertion.find(op) {
            let lhs = assertion[..idx].trim();
            let rhs_raw = assertion[idx + op.len()..].trim();
            let lhs_val = resolve_lhs(lhs, status, body, headers, duration_ms);
            let rhs_val = parse_rhs(rhs_raw);

            let passed = match op {
                "==" => values_equal(&lhs_val, &rhs_val),
                "!=" => !values_equal(&lhs_val, &rhs_val),
                ">" => lhs_val.as_f64().zip(rhs_val.as_f64()).map(|(a, b)| a > b).unwrap_or(false),
                "<" => lhs_val.as_f64().zip(rhs_val.as_f64()).map(|(a, b)| a < b).unwrap_or(false),
                ">=" => lhs_val.as_f64().zip(rhs_val.as_f64()).map(|(a, b)| a >= b).unwrap_or(false),
                "<=" => lhs_val.as_f64().zip(rhs_val.as_f64()).map(|(a, b)| a <= b).unwrap_or(false),
                _ => false,
            };

            let detail = if !passed {
                Some(format!(
                    "got: {}",
                    serde_json::to_string(&lhs_val).unwrap_or_default()
                ))
            } else {
                None
            };

            return AssertionResult {
                assertion: assertion.to_string(),
                passed,
                detail,
            };
        }
    }

    AssertionResult {
        assertion: assertion.to_string(),
        passed: false,
        detail: Some("Could not parse assertion".to_string()),
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

    let mut builder = client.request(method, &url);
    for (k, v) in &req.headers {
        builder = builder.header(k, resolve_vars(v, env));
    }
    if let Some(body) = &req.body {
        builder = builder.body(resolve_vars(body, env));
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
            let body: Value =
                serde_json::from_str(&body_raw).unwrap_or(Value::String(body_raw));

            let assertions: Vec<AssertionResult> = req
                .tests
                .iter()
                .map(|t| evaluate_assertion(&t.assert, status, &body, &headers, duration_ms))
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
#[command(name = "flux", about = "Flux CLI — run API test collections", version)]
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

                // Flatten all requests (top-level + folders)
                let mut all_requests: Vec<&YamlRequest> =
                    collection.requests.iter().collect();
                for folder in &collection.folders {
                    all_requests.extend(folder.requests.iter());
                }

                let with_tests: Vec<&&YamlRequest> =
                    all_requests.iter().filter(|r| !r.tests.is_empty()).collect();

                if reporter == "console" {
                    println!();
                    println!(
                        "{}{}{} {}{}  {} requests with tests{}",
                        BOLD, CYAN, collection.name, RESET,
                        DIM, with_tests.len(), RESET
                    );
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
                                "  {}✗ {} — {}{}",
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
                    let report = JsonReport {
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
                    };

                    let json = serde_json::to_string_pretty(&report).unwrap();
                    match &output {
                        Some(out_path) => {
                            std::fs::write(out_path, &json).unwrap();
                            eprintln!("{}Report written to {}{}", DIM, out_path, RESET);
                        }
                        None => println!("{}", json),
                    }
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
