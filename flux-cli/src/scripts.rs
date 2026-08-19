//! Ejecucion de los scripts pre y post de una request.
//!
//! El shim de `pm` se escribe en JavaScript (`js_shim.js`) en vez de portarse a
//! Rust: asi se parece linea a linea al de la app (`src/lib/preRequest.ts`) y no
//! divergen. Rust solo pasa datos por JSON en las dos direcciones.

use serde::Deserialize;
use std::collections::HashMap;

use boa_engine::{Context, Source};

const SHIM: &str = include_str!("js_shim.js");

#[derive(Debug, Deserialize, Default)]
pub struct ScriptTest {
    pub name: String,
    pub passed: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ScriptOutcome {
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub tests: Vec<ScriptTest>,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
}

pub struct ScriptResponse<'a> {
    pub status: u16,
    pub body: &'a str,
    pub headers: &'a HashMap<String, String>,
    pub duration_ms: u128,
}

fn run(
    script: &str,
    env: &HashMap<String, String>,
    response: Option<ScriptResponse<'_>>,
) -> ScriptOutcome {
    let ctx = serde_json::json!({
        "env": env,
        "response": response.map(|r| serde_json::json!({
            "status": r.status,
            "body": r.body,
            "headers": r.headers,
            "durationMs": r.duration_ms,
        })),
        "out": { "env": {}, "headers": {}, "tests": [], "logs": [], "error": null },
    });

    // El script del usuario va dentro de un try: un error suyo se reporta como
    // fallo del script, no revienta la ejecucion de la suite entera.
    let source = format!(
        "globalThis.__flux = {ctx};\n{SHIM}\ntry {{\n{script}\n}} catch (e) {{ \
         globalThis.__flux.out.error = String((e && e.message) || e); }}\n\
         JSON.stringify(globalThis.__flux.out)"
    );

    let mut context = Context::default();
    match context.eval(Source::from_bytes(&source)) {
        Ok(value) => match value.to_string(&mut context) {
            Ok(js) => serde_json::from_str(&js.to_std_string_escaped()).unwrap_or_default(),
            Err(e) => ScriptOutcome {
                error: Some(format!("script result was not readable: {e}")),
                ..Default::default()
            },
        },
        Err(e) => ScriptOutcome {
            error: Some(format!("script failed to run: {e}")),
            ..Default::default()
        },
    }
}

pub fn run_pre_request(script: &str, env: &HashMap<String, String>) -> ScriptOutcome {
    run(script, env, None)
}

pub fn run_post_response(
    script: &str,
    env: &HashMap<String, String>,
    response: ScriptResponse<'_>,
) -> ScriptOutcome {
    run(script, env, Some(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> HashMap<String, String> {
        HashMap::from([("BASE".to_string(), "https://api.test".to_string())])
    }

    fn resp<'a>(body: &'a str, headers: &'a HashMap<String, String>) -> ScriptResponse<'a> {
        ScriptResponse { status: 200, body, headers, duration_ms: 42 }
    }

    #[test]
    fn pre_request_reads_and_writes_environment() {
        let out = run_pre_request(
            "pm.environment.set('TOKEN', 'abc' + pm.environment.get('BASE').length);",
            &env(),
        );
        assert_eq!(out.error, None);
        assert_eq!(out.env.get("TOKEN").map(String::as_str), Some("abc16"));
    }

    #[test]
    fn pre_request_can_add_a_header() {
        let out = run_pre_request("pm.request.headers.upsert('X-Run', '1');", &env());
        assert_eq!(out.headers.get("X-Run").map(String::as_str), Some("1"));
    }

    #[test]
    fn post_response_records_passing_and_failing_tests() {
        let h = HashMap::new();
        let out = run_post_response(
            "pm.test('status', () => pm.response.to.have.status(200));\
             pm.test('wrong', () => pm.response.to.have.status(404));",
            &env(),
            resp("{}", &h),
        );
        assert_eq!(out.error, None);
        assert_eq!(out.tests.len(), 2);
        assert!(out.tests[0].passed);
        assert!(!out.tests[1].passed);
        assert!(out.tests[1].error.as_deref().unwrap().contains("404"));
    }

    #[test]
    fn post_response_can_read_the_json_body() {
        let h = HashMap::new();
        let out = run_post_response(
            "pm.test('id', () => pm.expect(pm.response.json().id).to.equal(7));",
            &env(),
            resp(r#"{"id":7}"#, &h),
        );
        assert!(out.tests[0].passed, "{:?}", out.tests[0].error);
    }

    #[test]
    fn post_response_reads_headers_case_insensitively() {
        let h = HashMap::from([("content-type".to_string(), "application/json".to_string())]);
        let out = run_post_response(
            "pm.test('ct', () => pm.expect(pm.response.headers.get('Content-Type')).to.equal('application/json'));",
            &env(),
            resp("{}", &h),
        );
        assert!(out.tests[0].passed, "{:?}", out.tests[0].error);
    }

    #[test]
    fn a_broken_script_is_reported_instead_of_aborting() {
        let out = run_pre_request("this is not valid javascript !!!", &env());
        assert!(out.error.is_some());
    }

    #[test]
    fn console_output_is_captured() {
        let out = run_pre_request("console.log('hello', 'world');", &env());
        assert_eq!(out.logs, vec!["hello world"]);
    }
}
