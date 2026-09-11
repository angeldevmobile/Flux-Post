//! Tests de la herencia, del `--env-file` y del reporte JUnit.
//!
//! La herencia tiene que dar el mismo resultado que
//! `src/lib/__tests__/inheritance.test.ts` en la app: si los dos ficheros
//! divergen, un test pasa en la app y falla en CI, que es justo lo que este
//! runner viene a evitar.

use super::*;

mod inheritance {
    use super::*;

    fn parse(yaml: &str) -> YamlCollection {
        serde_yaml::from_str(yaml).expect("yaml")
    }

    #[test]
    fn auth_falls_back_to_the_folder_and_then_the_collection() {
        let col = parse(
            r#"
name: API
auth:
  type: bearer
  token: col
folders:
  - name: Admin
    auth:
      type: bearer
      token: folder
    requests:
      - name: inherits folder
        method: GET
        path: /a
      - name: has its own
        method: GET
        path: /b
        auth:
          type: bearer
          token: own
  - name: Public
    requests:
      - name: inherits collection
        method: GET
        path: /c
"#,
        );
        let got = collect_requests(&col);
        let token_of = |n: &str| {
            got.iter()
                .find(|(r, _)| r.name == n)
                .map(|(r, i)| {
                    r.auth
                        .as_ref()
                        .or(i.auth)
                        .and_then(|a| a.token.clone())
                        .unwrap_or_default()
                })
                .unwrap()
        };
        assert_eq!(token_of("inherits folder"), "folder");
        assert_eq!(token_of("has its own"), "own");
        assert_eq!(token_of("inherits collection"), "col");
    }

    #[test]
    fn the_nearest_folder_wins_when_folders_nest() {
        let col = parse(
            r#"
name: API
folders:
  - name: outer
    auth:
      type: bearer
      token: outer
    folders:
      - name: inner
        auth:
          type: bearer
          token: inner
        requests:
          - name: deep
            method: GET
            path: /x
"#,
        );
        let got = collect_requests(&col);
        let (_, inh) = got.iter().find(|(r, _)| r.name == "deep").unwrap();
        assert_eq!(inh.auth.and_then(|a| a.token.as_deref()), Some("inner"));
        assert_eq!(inh.folder_path, "outer/inner");
    }

    #[test]
    fn headers_merge_with_the_closest_level_winning() {
        let col = parse(
            r#"
name: API
headers:
  X-Tenant: acme
  X-Env: prod
folders:
  - name: Admin
    headers:
      X-Env: staging
    requests:
      - name: r
        method: GET
        path: /x
"#,
        );
        let got = collect_requests(&col);
        let (_, inh) = &got[0];
        assert_eq!(inh.headers.get("X-Tenant").map(String::as_str), Some("acme"));
        assert_eq!(inh.headers.get("X-Env").map(String::as_str), Some("staging"));
    }

    #[test]
    fn a_repeated_header_does_not_survive_twice_under_a_different_case() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "text/plain".to_string());
        let mut inner = HashMap::new();
        inner.insert("content-type".to_string(), "application/json".to_string());
        merge_headers(&mut headers, &inner);
        assert_eq!(headers.len(), 1);
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
    }

    #[test]
    fn scripts_concatenate_from_the_outside_in() {
        let col = parse(
            r#"
name: API
scripts:
  preRequest: "col();"
folders:
  - name: F
    scripts:
      preRequest: "folder();"
    requests:
      - name: r
        method: GET
        path: /x
"#,
        );
        let got = collect_requests(&col);
        let (_, inh) = &got[0];
        assert_eq!(inh.pre_request.as_deref(), Some("col();\nfolder();"));
    }

    #[test]
    fn a_root_request_inherits_the_collection_and_has_an_empty_folder_path() {
        let col = parse(
            r#"
name: API
headers:
  X-Tenant: acme
requests:
  - name: root
    method: GET
    path: /x
"#,
        );
        let got = collect_requests(&col);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].1.folder_path, "");
        assert_eq!(
            got[0].1.headers.get("X-Tenant").map(String::as_str),
            Some("acme")
        );
    }

    /// Una coleccion vieja, sin ninguno de los campos nuevos, tiene que seguir
    /// cargando igual.
    #[test]
    fn a_collection_without_the_new_fields_still_loads() {
        let col = parse(
            r#"
name: API
requests:
  - name: r
    method: GET
    path: /x
folders:
  - name: F
    requests:
      - name: s
        method: GET
        path: /y
"#,
        );
        let got = collect_requests(&col);
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|(_, i)| i.auth.is_none() && i.headers.is_empty()));
    }
}

mod env_file {
    use super::*;

    #[test]
    fn reads_plain_pairs_and_skips_comments_and_blanks() {
        let env = parse_env_file("# comment\n\nBASE_URL=https://api.example.com\nTOKEN=abc\n");
        assert_eq!(env.len(), 2);
        assert_eq!(
            env.get("BASE_URL").map(String::as_str),
            Some("https://api.example.com")
        );
        assert_eq!(env.get("TOKEN").map(String::as_str), Some("abc"));
    }

    #[test]
    fn strips_matching_quotes_but_leaves_inner_ones() {
        let env = parse_env_file("A=\"quoted\"\nB='single'\nC=say \"hi\"\n");
        assert_eq!(env.get("A").map(String::as_str), Some("quoted"));
        assert_eq!(env.get("B").map(String::as_str), Some("single"));
        assert_eq!(env.get("C").map(String::as_str), Some("say \"hi\""));
    }

    #[test]
    fn ignores_a_leading_export_and_keeps_equals_signs_in_the_value() {
        let env = parse_env_file("export TOKEN=abc==\n");
        assert_eq!(env.get("TOKEN").map(String::as_str), Some("abc=="));
    }

    #[test]
    fn skips_lines_without_a_key() {
        let env = parse_env_file("=novalue\nnoequals\nOK=1\n");
        assert_eq!(env.len(), 1);
        assert_eq!(env.get("OK").map(String::as_str), Some("1"));
    }
}

mod junit {
    use super::*;

    fn report() -> Vec<JsonReport> {
        vec![JsonReport {
            collection: "API & co".to_string(),
            passed: 1,
            failed: 1,
            duration_ms: 1200,
            requests: vec![
                JsonRequestReport {
                    name: "login".to_string(),
                    passed: 1,
                    failed: 1,
                    duration_ms: 300,
                    assertions: vec![
                        JsonAssertionReport {
                            assertion: "status == 200".to_string(),
                            passed: true,
                            detail: None,
                        },
                        JsonAssertionReport {
                            assertion: "json.token != null".to_string(),
                            passed: false,
                            detail: Some("got absent".to_string()),
                        },
                    ],
                    error: None,
                },
                JsonRequestReport {
                    name: "unreachable".to_string(),
                    passed: 0,
                    failed: 1,
                    duration_ms: 0,
                    assertions: vec![],
                    error: Some("connection refused".to_string()),
                },
            ],
        }]
    }

    #[test]
    fn counts_tests_failures_and_errors_at_the_top() {
        let xml = junit_report(&report(), 1500);
        assert!(xml.contains(
            r#"<testsuites name="flux" tests="2" failures="1" errors="1" time="1.500">"#
        ));
    }

    #[test]
    fn writes_one_testcase_per_assertion_with_the_detail_as_the_failure() {
        let xml = junit_report(&report(), 1500);
        assert!(xml.contains(r#"name="status == 200""#));
        assert!(xml.contains(r#"name="json.token != null""#));
        assert!(xml.contains(r#"<failure message="got absent"/>"#));
    }

    #[test]
    fn a_request_that_never_answered_is_an_error_not_a_failure() {
        let xml = junit_report(&report(), 1500);
        assert!(xml.contains(r#"name="unreachable""#));
        assert!(xml.contains(r#"<error message="connection refused"/>"#));
    }

    #[test]
    fn escapes_xml_metacharacters_in_names() {
        let xml = junit_report(&report(), 1500);
        assert!(xml.contains("API &amp; co"));
        assert!(!xml.contains("API & co"));
    }

    #[test]
    fn times_are_in_seconds_not_milliseconds() {
        let xml = junit_report(&report(), 1500);
        assert!(xml.contains(r#"time="1.200""#), "suite time in seconds");
        assert!(xml.contains(r#"time="0.300""#), "testcase time in seconds");
    }
}

mod url_joining {
    use super::*;

    /// Mismo contrato que `resolveRequestUrl` en src/lib/requestUrl.ts.
    #[test]
    fn an_absolute_path_wins_over_the_base_url() {
        assert_eq!(
            join_url(Some("http://base.example.com"), "https://other.example.com/x"),
            "https://other.example.com/x"
        );
    }

    #[test]
    fn a_relative_path_is_joined_with_exactly_one_slash() {
        assert_eq!(join_url(Some("http://b.com"), "/x"), "http://b.com/x");
        assert_eq!(join_url(Some("http://b.com/"), "x"), "http://b.com/x");
        assert_eq!(join_url(Some("http://b.com//"), "//x"), "http://b.com/x");
    }

    #[test]
    fn without_a_base_url_the_path_is_the_url() {
        assert_eq!(join_url(None, "https://a.com/x"), "https://a.com/x");
        assert_eq!(join_url(Some("   "), "https://a.com/x"), "https://a.com/x");
    }

    #[test]
    fn an_empty_path_leaves_the_base_url() {
        assert_eq!(join_url(Some("http://b.com"), ""), "http://b.com");
    }

    /// Cualquier `esquema://` cuenta como absoluto, igual que el regex
    /// `^[a-zA-Z][a-zA-Z0-9+.-]*://` de la app. No se inventa una lista de
    /// esquemas conocidos aqui que la app no tenga.
    #[test]
    fn any_scheme_counts_as_absolute() {
        assert_eq!(join_url(Some("http://b.com"), "path://x"), "path://x");
    }

    #[test]
    fn a_variable_or_a_bare_colon_is_not_a_scheme() {
        assert_eq!(join_url(Some("http://b.com"), "{{HOST}}/x"), "http://b.com/{{HOST}}/x");
        assert_eq!(join_url(Some("http://b.com"), "a:b/x"), "http://b.com/a:b/x");
        assert_eq!(join_url(Some("http://b.com"), "9x://y"), "http://b.com/9x://y");
    }
}

/// Espejo de `describe("variable interpolation")` en
/// src/lib/__tests__/assertions.test.ts. Mismos casos, mismos resultados.
mod variable_interpolation {
    use super::*;

    const BODY: &str = r#"{"token":"abc","count":5,"nested":{"id":7},"nothing":null,"list":[1,2]}"#;

    fn vars() -> HashMap<String, String> {
        [
            ("TOKEN", "abc"),
            ("COUNT", "5"),
            ("PART", "ab"),
            ("FIELD", "token"),
            ("EMPTY", ""),
            ("WEIRD", "a == b"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    fn check_with(assertion: &str, env: &HashMap<String, String>) -> AssertionResult {
        let json: Value = serde_json::from_str(BODY).unwrap();
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/json".to_string());
        let ctx = Ctx {
            status: 200,
            json: Some(&json),
            raw_body: BODY,
            headers: &headers,
            duration_ms: 120,
            env,
        };
        evaluate_assertion(assertion, &ctx)
    }

    fn ok(assertion: &str) -> bool {
        check_with(assertion, &vars()).passed
    }

    #[test]
    fn resolves_a_variable_on_the_value_side() {
        assert!(ok(r#"json.token == "{{TOKEN}}""#));
        assert!(!ok(r#"json.token != "{{TOKEN}}""#));
    }

    #[test]
    fn resolves_an_unquoted_variable_into_a_number() {
        assert!(ok("json.count == {{COUNT}}"));
        assert!(!ok("json.count > {{COUNT}}"));
        assert!(ok("json.count >= {{COUNT}}"));
    }

    #[test]
    fn resolves_inside_a_contains_needle() {
        assert!(ok(r#"json.token contains "{{PART}}""#));
        assert!(ok(r#"json.token contains "{{TOKEN}}""#));
    }

    #[test]
    fn resolves_on_the_path_side_too() {
        assert!(ok(r#"json.{{FIELD}} == "abc""#));
    }

    #[test]
    fn leaves_an_unknown_variable_as_written_so_it_fails_loudly() {
        let r = check_with(r#"json.token == "{{NOPE}}""#, &vars());
        assert!(!r.passed);
        assert!(r.detail.unwrap().contains("{{NOPE}}"));
    }

    #[test]
    fn reports_the_assertion_as_written_not_with_the_value_substituted() {
        // Sustituirlo dejaria el valor de una variable secreta en el reporte.
        let r = check_with(r#"json.token == "{{TOKEN}}""#, &vars());
        assert_eq!(r.assertion, r#"json.token == "{{TOKEN}}""#);
    }

    #[test]
    fn a_variables_value_cannot_change_which_operator_is_parsed() {
        let r = check_with(r#"json.token == "{{WEIRD}}""#, &vars());
        assert!(!r.passed);
        assert!(r.detail.unwrap().contains("a == b"));
    }

    #[test]
    fn an_empty_variable_resolves_to_an_empty_string() {
        let json: Value = serde_json::from_str(r#"{"s":""}"#).unwrap();
        let headers = HashMap::new();
        let env = vars();
        let ctx = Ctx {
            status: 200,
            json: Some(&json),
            raw_body: r#"{"s":""}"#,
            headers: &headers,
            duration_ms: 0,
            env: &env,
        };
        assert!(evaluate_assertion(r#"json.s == "{{EMPTY}}""#, &ctx).passed);
    }

    #[test]
    fn behaves_exactly_as_before_with_no_variables() {
        let empty = HashMap::new();
        assert!(!check_with(r#"json.token == "{{TOKEN}}""#, &empty).passed);
    }
}

/// Espejo de src/lib/__tests__/resolveVariable.test.ts. Mismos casos.
///
/// El CLI no tiene entornos con nombre ni variables globales: todo llega por
/// `--env` y `--env-file`, asi que aqui hay un solo mapa. Lo que si tiene que
/// coincidir es la forma de sustituir y los built-ins dinamicos.
mod variable_resolution {
    use super::*;

    fn env() -> HashMap<String, String> {
        [("TOKEN", "abc"), ("EMPTY", ""), ("NESTED", "{{TOKEN}}")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn r(s: &str) -> String {
        resolve_vars(s, &env())
    }

    #[test]
    fn replaces_a_variable() {
        assert_eq!(r("Bearer {{TOKEN}}"), "Bearer abc");
    }

    #[test]
    fn replaces_every_occurrence() {
        assert_eq!(r("{{TOKEN}}-{{TOKEN}}"), "abc-abc");
    }

    #[test]
    fn leaves_an_unknown_variable_exactly_as_written() {
        assert_eq!(r("{{NOPE}}"), "{{NOPE}}");
        assert_eq!(r("a {{NOPE}} b"), "a {{NOPE}} b");
    }

    #[test]
    fn resolves_an_empty_variable_to_an_empty_string() {
        assert_eq!(r("[{{EMPTY}}]"), "[]");
    }

    #[test]
    fn does_not_re_resolve_what_it_just_substituted() {
        assert_eq!(r("{{NESTED}}"), "{{TOKEN}}");
    }

    #[test]
    fn leaves_text_with_no_variables_untouched() {
        assert_eq!(r("plain text"), "plain text");
        assert_eq!(r(""), "");
    }

    #[test]
    fn ignores_braces_that_do_not_close() {
        assert_eq!(r("{{TOKEN"), "{{TOKEN");
        assert_eq!(r("{{}}"), "{{}}");
    }

    #[test]
    fn handles_non_ascii_around_a_variable() {
        // El escaneo va por bytes; un corte a mitad de caracter entraria en panico.
        assert_eq!(r("año {{TOKEN}} ñ"), "año abc ñ");
    }

    #[test]
    fn guid_is_a_v4_uuid() {
        let v = r("{{$guid}}");
        assert_eq!(v.len(), 36, "{v}");
        let parts: Vec<&str> = v.split('-').collect();
        assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![8, 4, 4, 4, 12]);
        assert!(parts[2].starts_with('4'), "version nibble: {v}");
        assert!(matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'), "variant: {v}");
        assert!(v.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    }

    #[test]
    fn each_guid_in_the_same_string_is_different() {
        let v = r("{{$guid}} {{$guid}}");
        let (a, b) = v.split_once(' ').unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn timestamp_is_epoch_milliseconds() {
        let v: u128 = r("{{$timestamp}}").parse().expect("number");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        assert!(now.abs_diff(v) < 5000);
    }

    #[test]
    fn iso_timestamp_has_the_same_shape_as_the_apps() {
        // `new Date().toISOString()`: 2026-09-09T12:34:56.789Z
        let v = r("{{$isoTimestamp}}");
        assert_eq!(v.len(), 24, "{v}");
        assert!(v.ends_with('Z'));
        assert_eq!(&v[4..5], "-");
        assert_eq!(&v[10..11], "T");
        assert_eq!(&v[19..20], ".");
        assert!(chrono::DateTime::parse_from_rfc3339(&v).is_ok(), "{v}");
    }

    #[test]
    fn random_int_is_between_0_and_999() {
        for _ in 0..200 {
            let v: u32 = r("{{$randomInt}}").parse().expect("number");
            assert!(v <= 999);
        }
    }

    #[test]
    fn a_builtin_wins_over_an_env_variable_of_the_same_name() {
        let mut e = env();
        e.insert("$timestamp".to_string(), "nope".to_string());
        assert_ne!(resolve_vars("{{$timestamp}}", &e), "nope");
    }
}

/// Espejo de `describe("extractVariables")` en
/// src/lib/__tests__/runCollectionRequest.test.ts. Mismos casos.
mod extractors {
    use super::*;

    fn rules(pairs: &[(&str, &str)]) -> Vec<YamlExtractor> {
        pairs
            .iter()
            .map(|(path, variable)| YamlExtractor {
                path: path.to_string(),
                variable: variable.to_string(),
            })
            .collect()
    }

    #[test]
    fn captures_a_value_by_jsonpath() {
        let out = extract_variables(&rules(&[("$.data.token", "TOKEN")]), r#"{"data":{"token":"abc"}}"#);
        assert_eq!(out.get("TOKEN").map(String::as_str), Some("abc"));
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn captures_several_rules_at_once() {
        let out = extract_variables(
            &rules(&[("$.id", "ID"), ("$.nested.name", "NAME")]),
            r#"{"id":7,"nested":{"name":"ana"}}"#,
        );
        assert_eq!(out.get("ID").map(String::as_str), Some("7"));
        assert_eq!(out.get("NAME").map(String::as_str), Some("ana"));
    }

    #[test]
    fn skips_a_path_that_is_not_in_the_response() {
        let out = extract_variables(&rules(&[("$.missing", "TOKEN")]), r#"{"other":1}"#);
        assert!(out.is_empty());
    }

    #[test]
    fn returns_nothing_for_a_non_json_body() {
        let out = extract_variables(&rules(&[("$.token", "TOKEN")]), "<html>nope</html>");
        assert!(out.is_empty());
    }

    #[test]
    fn returns_nothing_without_rules() {
        assert!(extract_variables(&[], r#"{"token":"abc"}"#).is_empty());
    }

    #[test]
    fn ignores_a_half_written_rule() {
        let out = extract_variables(&rules(&[("", "TOKEN"), ("$.a", "")]), r#"{"a":1}"#);
        assert!(out.is_empty());
    }

    /// El YAML que escribe la app tiene que cargar aqui tal cual.
    #[test]
    fn the_apps_yaml_shape_parses() {
        let col: YamlCollection = serde_yaml::from_str(
            r#"
name: API
requests:
  - name: login
    method: POST
    path: /login
    extractors:
      - path: $.data.token
        variable: TOKEN
"#,
        )
        .expect("yaml");
        let r = &col.requests[0];
        assert_eq!(r.extractors.len(), 1);
        assert_eq!(r.extractors[0].path, "$.data.token");
        assert_eq!(r.extractors[0].variable, "TOKEN");
    }

    /// Una coleccion sin extractores sigue cargando.
    #[test]
    fn a_request_without_extractors_still_parses() {
        let col: YamlCollection =
            serde_yaml::from_str("name: API\nrequests:\n  - name: r\n    method: GET\n    path: /x\n")
                .expect("yaml");
        assert!(col.requests[0].extractors.is_empty());
    }
}

