use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

//    YAML schema                                                                

#[derive(Debug, Deserialize, Serialize)]
struct YamlTest {
    assert: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct YamlGrpc {
    #[serde(skip_serializing_if = "Option::is_none")]
    endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    metadata: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proto_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proto_name: Option<String>,
}

/// Auth config as written in the collection file. Credential fields are meant
/// to hold `{{VAR}}` references rather than literals. The UI offers to move a
/// pasted secret into the environment before saving.
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct YamlAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(rename = "in", skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_access_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct YamlScripts {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_request: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_response: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YamlExtractor {
    pub path: String,
    pub variable: String,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct YamlGraphql {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct YamlRequest {
    // Absent in collections written before stable ids; the loader falls back to
    // a positional id and the next save writes one.
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    name: String,
    #[serde(default = "default_kind")]
    kind: String,
    // HTTP fields
    #[serde(default, skip_serializing_if = "String::is_empty")]
    method: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    path: String,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    headers: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    // Written as camelCase like the rest of the schema; the alias keeps reading
    // collections saved when this one field was snake_case.
    #[serde(
        rename = "bodyType",
        alias = "body_type",
        skip_serializing_if = "Option::is_none"
    )]
    body_type: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    params: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    form: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    graphql: Option<YamlGraphql>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auth: Option<YamlAuth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scripts: Option<YamlScripts>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    extractors: Vec<YamlExtractor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tests: Vec<YamlTest>,
    // gRPC fields (inlined)
    #[serde(skip_serializing_if = "Option::is_none")]
    grpc: Option<YamlGrpc>,
}

fn default_kind() -> String {
    "http".to_string()
}

#[derive(Debug, Deserialize, Serialize)]
struct YamlFolder {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    requests: Vec<YamlRequest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    folders: Vec<YamlFolder>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct YamlCollection {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(default)]
    requests: Vec<YamlRequest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    folders: Vec<YamlFolder>,
}

//    Output DTOs (sent to / received from TypeScript)                          

#[derive(Debug, Serialize, Deserialize)]
pub struct TestAssertion {
    pub assert: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRequestFields {
    pub endpoint: Option<String>,
    pub service: Option<String>,
    pub method: Option<String>,
    pub payload: Option<String>,
    pub metadata: HashMap<String, String>,
    pub proto_id: Option<String>,
    pub proto_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOut {
    pub id: String,
    pub name: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    // HTTP
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_type: Option<String>,
    #[serde(default)]
    pub params: HashMap<String, String>,
    #[serde(default)]
    pub form: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphql: Option<YamlGraphql>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<YamlAuth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scripts: Option<YamlScripts>,
    #[serde(default)]
    pub extractors: Vec<YamlExtractor>,
    #[serde(default)]
    pub tests: Vec<TestAssertion>,
    // gRPC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grpc: Option<GrpcRequestFields>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderOut {
    pub id: String,
    pub name: String,
    pub expanded: bool,
    pub requests: Vec<RequestOut>,
    #[serde(default)]
    pub folders: Vec<FolderOut>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionOut {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub base_url: Option<String>,
    pub requests: Vec<RequestOut>,
    pub folders: Vec<FolderOut>,
    pub expanded: bool,
    pub group: Option<String>,
}

//    Conversions                                                                

fn yaml_req_to_out(r: YamlRequest, id: String) -> RequestOut {
    let grpc = r.grpc.map(|g| GrpcRequestFields {
        endpoint: g.endpoint,
        service: g.service,
        method: g.method,
        payload: g.payload,
        metadata: g.metadata,
        proto_id: g.proto_id,
        proto_name: g.proto_name,
    });
    RequestOut {
        id,
        name: r.name,
        kind: r.kind,
        method: r.method,
        path: r.path,
        headers: r.headers,
        body: r.body,
        body_type: r.body_type,
        params: r.params,
        form: r.form,
        graphql: r.graphql,
        auth: r.auth,
        scripts: r.scripts,
        extractors: r.extractors,
        tests: r.tests.into_iter().map(|t| TestAssertion { assert: t.assert }).collect(),
        grpc,
    }
}

fn out_to_yaml_req(r: RequestOut) -> YamlRequest {
    let grpc = r.grpc.map(|g| YamlGrpc {
        endpoint: g.endpoint,
        service: g.service,
        method: g.method,
        payload: g.payload,
        metadata: g.metadata,
        proto_id: g.proto_id,
        proto_name: g.proto_name,
    });
    YamlRequest {
        id: Some(r.id),
        name: r.name,
        kind: r.kind,
        method: r.method,
        path: r.path,
        headers: r.headers,
        body: r.body,
        body_type: r.body_type,
        params: r.params,
        form: r.form,
        graphql: r.graphql,
        auth: r.auth,
        scripts: r.scripts,
        extractors: r.extractors,
        tests: r.tests.into_iter().map(|t| YamlTest { assert: t.assert }).collect(),
        grpc,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(yaml: &str) -> YamlCollection {
        serde_yaml::from_str(yaml).expect("collection should parse")
    }

    // Collections predating mixed HTTP/gRPC support have no `kind:` field.
    #[test]
    fn request_without_kind_defaults_to_http() {
        let col = parse(
            r#"
name: Legacy
requests:
  - name: Get users
    method: GET
    path: /users
"#,
        );
        let out = yaml_req_to_out(col.requests.into_iter().next().unwrap(), "r1".into());
        assert_eq!(out.kind, "http");
        assert_eq!(out.method, "GET");
        assert_eq!(out.path, "/users");
        assert!(out.grpc.is_none());
    }

    #[test]
    fn http_request_survives_a_round_trip() {
        let col = parse(
            r#"
name: API
requests:
  - name: Create user
    kind: http
    method: POST
    path: https://api.example.com/users
    headers:
      Content-Type: application/json
    body: '{"name":"ana"}'
    body_type: json
    tests:
      - assert: status == 201
      - assert: json.id != null
"#,
        );

        let out = yaml_req_to_out(col.requests.into_iter().next().unwrap(), "r1".into());
        let back = out_to_yaml_req(out);

        assert_eq!(back.name, "Create user");
        assert_eq!(back.kind, "http");
        assert_eq!(back.method, "POST");
        assert_eq!(back.path, "https://api.example.com/users");
        assert_eq!(back.headers.get("Content-Type").map(String::as_str), Some("application/json"));
        assert_eq!(back.body.as_deref(), Some(r#"{"name":"ana"}"#));
        // Read from the old snake_case spelling via the serde alias.
        assert_eq!(back.body_type.as_deref(), Some("json"));
        assert_eq!(back.tests.len(), 2);
        assert_eq!(back.tests[0].assert, "status == 201");
        assert_eq!(back.tests[1].assert, "json.id != null");
    }

    #[test]
    fn grpc_request_survives_a_round_trip() {
        let col = parse(
            r#"
name: API
requests:
  - name: SayHello
    kind: grpc
    grpc:
      endpoint: localhost:50051
      service: helloworld.Greeter
      method: SayHello
      payload: '{"name":"ana"}'
      metadata:
        authorization: Bearer tok
      protoId: proto-1
      protoName: helloworld.proto
"#,
        );

        let out = yaml_req_to_out(col.requests.into_iter().next().unwrap(), "r1".into());
        assert_eq!(out.kind, "grpc");

        let g = out.grpc.as_ref().expect("grpc block should be preserved");
        assert_eq!(g.endpoint.as_deref(), Some("localhost:50051"));
        assert_eq!(g.service.as_deref(), Some("helloworld.Greeter"));
        assert_eq!(g.method.as_deref(), Some("SayHello"));
        assert_eq!(g.proto_id.as_deref(), Some("proto-1"));
        assert_eq!(g.metadata.get("authorization").map(String::as_str), Some("Bearer tok"));

        let yaml = serde_yaml::to_string(&out_to_yaml_req(out)).unwrap();
        assert!(yaml.contains("helloworld.Greeter"), "service missing from: {yaml}");
        assert!(yaml.contains("protoId"), "protoId missing from: {yaml}");
    }

    #[test]
    fn empty_optional_fields_are_not_written_back() {
        let col = parse(
            r#"
name: API
requests:
  - name: Ping
    method: GET
    path: /ping
"#,
        );
        let out = yaml_req_to_out(col.requests.into_iter().next().unwrap(), "r1".into());
        let yaml = serde_yaml::to_string(&out_to_yaml_req(out)).unwrap();

        assert!(!yaml.contains("headers"), "empty headers written: {yaml}");
        assert!(!yaml.contains("tests"), "empty tests written: {yaml}");
        assert!(!yaml.contains("grpc"), "absent grpc block written: {yaml}");
        assert!(!yaml.contains("body_type"), "absent body_type written: {yaml}");
    }

    #[test]
    fn collection_level_fields_parse() {
        let col = parse(
            r#"
name: Petstore
description: The pet store API
baseUrl: https://api.petstore.io
requests:
  - name: List
    method: GET
    path: /pets
folders:
  - name: Admin
    requests:
      - name: Delete
        method: DELETE
        path: /pets/1
"#,
        );

        assert_eq!(col.name, "Petstore");
        assert_eq!(col.description.as_deref(), Some("The pet store API"));
        assert_eq!(col.base_url.as_deref(), Some("https://api.petstore.io"));
        assert_eq!(col.requests.len(), 1);
        assert_eq!(col.folders.len(), 1);
        assert_eq!(col.folders[0].name, "Admin");
        assert_eq!(col.folders[0].requests.len(), 1);
    }

    /// The whole load → edit → save path, which is where `description` used to
    /// be silently dropped.
    fn round_trip(yaml: &str) -> YamlCollection {
        let parsed = parse(yaml);
        let out = CollectionOut {
            id: "col".into(),
            name: parsed.name,
            description: parsed.description,
            base_url: parsed.base_url,
            requests: load_requests(parsed.requests, "col"),
            folders: load_folders(parsed.folders, "col"),
            expanded: true,
            group: None,
        };
        let back = YamlCollection {
            name: out.name,
            description: out.description,
            base_url: out.base_url,
            requests: out.requests.into_iter().map(out_to_yaml_req).collect(),
            folders: save_folders(out.folders),
        };
        serde_yaml::from_str(&serde_yaml::to_string(&back).unwrap()).unwrap()
    }

    /// The point of request fidelity: everything the request panel holds has to
    /// come back after a save, not just the url and headers.
    #[test]
    fn a_full_request_survives_a_save() {
        let col = round_trip(
            r#"
name: API
requests:
  - name: Search users
    method: QUERY
    path: https://api.example.com/users
    headers:
      Content-Type: application/json
    params:
      page: "2"
    body: '{"q":"ana"}'
    bodyType: json
    auth:
      type: bearer
      token: "{{API_TOKEN}}"
    scripts:
      preRequest: pm.environment.set("t", "1");
      postResponse: pm.environment.set("id", pm.response.json().id);
    extractors:
      - path: $.data.token
        variable: token
    tests:
      - assert: status == 200
"#,
        );

        let r = &col.requests[0];
        assert_eq!(r.method, "QUERY");
        assert_eq!(r.params.get("page").map(String::as_str), Some("2"));
        assert_eq!(r.body_type.as_deref(), Some("json"));

        let auth = r.auth.as_ref().expect("auth preserved");
        assert_eq!(auth.auth_type, "bearer");
        assert_eq!(auth.token.as_deref(), Some("{{API_TOKEN}}"));

        let scripts = r.scripts.as_ref().expect("scripts preserved");
        assert!(scripts.pre_request.as_deref().unwrap().contains("pm.environment.set"));
        assert!(scripts.post_response.as_deref().unwrap().contains("pm.response.json()"));

        assert_eq!(r.extractors.len(), 1);
        assert_eq!(r.extractors[0].path, "$.data.token");
        assert_eq!(r.extractors[0].variable, "token");

        assert_eq!(r.tests.len(), 1);
        assert_eq!(r.tests[0].assert, "status == 200");
    }

    #[test]
    fn a_graphql_request_keeps_its_query_and_variables() {
        let col = round_trip(
            r#"
name: API
requests:
  - name: Users
    method: POST
    path: /graphql
    bodyType: graphql
    graphql:
      query: "query { users { id } }"
      variables: '{"limit":10}'
"#,
        );

        let gql = col.requests[0].graphql.as_ref().expect("graphql preserved");
        assert_eq!(gql.query.as_deref(), Some("query { users { id } }"));
        assert_eq!(gql.variables.as_deref(), Some(r#"{"limit":10}"#));
    }

    #[test]
    fn a_form_body_keeps_its_fields() {
        let col = round_trip(
            r#"
name: API
requests:
  - name: Login
    method: POST
    path: /login
    bodyType: form
    form:
      user: ana
      pass: "{{PASSWORD}}"
"#,
        );

        let form = &col.requests[0].form;
        assert_eq!(form.get("user").map(String::as_str), Some("ana"));
        assert_eq!(form.get("pass").map(String::as_str), Some("{{PASSWORD}}"));
    }

    #[test]
    fn every_auth_type_round_trips() {
        for (yaml, check) in [
            (
                "type: basic\n      username: ana\n      password: \"{{PASS}}\"",
                &["ana", "{{PASS}}"][..],
            ),
            (
                "type: apikey\n      key: X-API-Key\n      value: \"{{KEY}}\"\n      in: header",
                &["X-API-Key", "{{KEY}}", "header"][..],
            ),
            (
                "type: awssigv4\n      region: eu-west-1\n      service: execute-api\n      accessKeyId: \"{{AWS_ID}}\"",
                &["eu-west-1", "execute-api", "{{AWS_ID}}"][..],
            ),
            (
                "type: oauth2\n      grantType: client_credentials\n      clientId: \"{{CLIENT_ID}}\"\n      tokenUrl: https://auth.example.com/token",
                &["client_credentials", "{{CLIENT_ID}}", "https://auth.example.com/token"][..],
            ),
        ] {
            let col = round_trip(&format!(
                "name: API\nrequests:\n  - name: R\n    method: GET\n    path: /x\n    auth:\n      {yaml}\n"
            ));
            let written = serde_yaml::to_string(&col).unwrap();
            for needle in check {
                assert!(written.contains(needle), "{needle} missing from:\n{written}");
            }
        }
    }

    /// A request saved before these fields existed must still load, with the new
    /// ones simply absent rather than failing the whole collection.
    #[test]
    fn a_request_without_the_new_fields_still_loads() {
        let col = round_trip(
            r#"
name: Legacy
requests:
  - name: Ping
    method: GET
    path: /ping
"#,
        );
        let r = &col.requests[0];
        assert!(r.auth.is_none());
        assert!(r.scripts.is_none());
        assert!(r.graphql.is_none());
        assert!(r.extractors.is_empty());
        assert!(r.params.is_empty());
        assert!(r.form.is_empty());

        // And nothing empty is written back, so files stay readable.
        let written = serde_yaml::to_string(&col).unwrap();
        for absent in ["auth:", "scripts:", "graphql:", "extractors:", "params:", "form:"] {
            assert!(!written.contains(absent), "{absent} written into:\n{written}");
        }
    }

    #[test]
    fn description_survives_a_save() {
        let col = round_trip(
            r#"
name: API
description: What this collection is for
baseUrl: https://api.example.com
requests:
  - name: Ping
    method: GET
    path: /ping
"#,
        );
        assert_eq!(col.description.as_deref(), Some("What this collection is for"));
        assert_eq!(col.base_url.as_deref(), Some("https://api.example.com"));
    }

    #[test]
    fn ids_are_written_back_and_then_stable() {
        // First save assigns positional ids to a collection that had none.
        let first = round_trip(
            r#"
name: API
requests:
  - name: A
    method: GET
    path: /a
  - name: B
    method: GET
    path: /b
"#,
        );
        let ids: Vec<&str> = first.requests.iter().filter_map(|r| r.id.as_deref()).collect();
        assert_eq!(ids, vec!["col-0", "col-1"]);

        // Removing the first request must not renumber the second.
        let mut trimmed = first;
        trimmed.requests.remove(0);
        let yaml = serde_yaml::to_string(&trimmed).unwrap();
        let reloaded = load_requests(parse(&yaml).requests, "col");
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].id, "col-1", "surviving request kept its id");
        assert_eq!(reloaded[0].name, "B");
    }

    #[test]
    fn an_explicit_id_wins_over_the_positional_fallback() {
        let reqs = load_requests(
            parse(
                r#"
name: API
requests:
  - id: req-stable
    name: A
    method: GET
    path: /a
  - name: B
    method: GET
    path: /b
"#,
            )
            .requests,
            "col",
        );
        assert_eq!(reqs[0].id, "req-stable");
        assert_eq!(reqs[1].id, "col-1");
    }

    #[test]
    fn folders_nest() {
        let col = round_trip(
            r#"
name: API
folders:
  - name: Admin
    requests:
      - name: List
        method: GET
        path: /admin
    folders:
      - name: Users
        requests:
          - name: Get
            method: GET
            path: /admin/users
"#,
        );

        let admin = &col.folders[0];
        assert_eq!(admin.name, "Admin");
        assert_eq!(admin.requests.len(), 1);
        assert_eq!(admin.folders.len(), 1);

        let users = &admin.folders[0];
        assert_eq!(users.name, "Users");
        assert_eq!(users.requests[0].path, "/admin/users");
    }

    #[test]
    fn nested_folder_ids_are_scoped_to_their_parent() {
        let folders = load_folders(
            parse(
                r#"
name: API
folders:
  - name: Admin
    folders:
      - name: Users
        requests:
          - name: Get
            method: GET
            path: /x
"#,
            )
            .folders,
            "col",
        );
        assert_eq!(folders[0].id, "col-f0");
        assert_eq!(folders[0].folders[0].id, "col-f0-f0");
        assert_eq!(folders[0].folders[0].requests[0].id, "col-f0-f0-0");
    }

    #[test]
    fn a_collection_with_no_requests_parses() {
        let col = parse("name: Empty\n");
        assert_eq!(col.name, "Empty");
        assert!(col.requests.is_empty());
        assert!(col.folders.is_empty());
    }
}

//    Commands

/// Keeps the id written in the file when there is one; otherwise falls back to
/// the positional id used before ids existed, so old collections keep working.
fn load_requests(requests: Vec<YamlRequest>, prefix: &str) -> Vec<RequestOut> {
    requests
        .into_iter()
        .enumerate()
        .map(|(i, r)| {
            let id = r.id.clone().unwrap_or_else(|| format!("{}-{}", prefix, i));
            yaml_req_to_out(r, id)
        })
        .collect()
}

fn load_folders(folders: Vec<YamlFolder>, prefix: &str) -> Vec<FolderOut> {
    folders
        .into_iter()
        .enumerate()
        .map(|(fi, f)| {
            let fid = f.id.clone().unwrap_or_else(|| format!("{}-f{}", prefix, fi));
            FolderOut {
                requests: load_requests(f.requests, &fid),
                folders: load_folders(f.folders, &fid),
                id: fid,
                name: f.name,
                expanded: true,
            }
        })
        .collect()
}

fn save_folders(folders: Vec<FolderOut>) -> Vec<YamlFolder> {
    folders
        .into_iter()
        .map(|f| YamlFolder {
            id: Some(f.id),
            name: f.name,
            requests: f.requests.into_iter().map(out_to_yaml_req).collect(),
            folders: save_folders(f.folders),
        })
        .collect()
}

fn load_yaml_files_from(scan_path: &Path, group: Option<String>) -> Vec<CollectionOut> {
    let Ok(entries) = fs::read_dir(scan_path) else { return vec![] };
    let mut cols: Vec<CollectionOut> = entries
        .filter_map(|e| e.ok())
        .filter(|e| matches!(e.path().extension().and_then(|x| x.to_str()), Some("yaml") | Some("yml")))
        .filter_map(|e| {
            let p = e.path();
            let content = fs::read_to_string(&p).ok()?;
            let yaml: YamlCollection = serde_yaml::from_str(&content).ok()?;
            let id = p.file_stem()?.to_str()?.to_string();
            let full_id = if let Some(ref g) = group { format!("{}/{}", g, id) } else { id.clone() };

            let requests = load_requests(yaml.requests, &full_id);
            let folders = load_folders(yaml.folders, &full_id);

            Some(CollectionOut {
                id: full_id,
                name: yaml.name,
                description: yaml.description,
                base_url: yaml.base_url,
                requests,
                folders,
                expanded: true,
                group: group.clone(),
            })
        })
        .collect();
    cols.sort_by(|a, b| a.name.cmp(&b.name));
    cols
}

#[tauri::command]
pub fn load_collections(dir: String) -> Result<Vec<CollectionOut>, String> {
    let path = Path::new(&dir);
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir));
    }

    // Root yaml files (no group)
    let mut collections = load_yaml_files_from(path, None);

    // One level of subdirectories — each becomes a group
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let sub = entry.path();
            if sub.is_dir() {
                let group_name = sub.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                if !group_name.is_empty() {
                    collections.extend(load_yaml_files_from(&sub, Some(group_name)));
                }
            }
        }
    }

    Ok(collections)
}

#[tauri::command]
pub fn save_collection(dir: String, collection: CollectionOut) -> Result<(), String> {
    // id may be "Group/stem" for grouped collections: use only the last segment as filename
    let stem = collection.id.rsplit('/').next().unwrap_or(&collection.id);
    let base = if let Some(ref g) = collection.group {
        Path::new(&dir).join(g)
    } else {
        Path::new(&dir).to_path_buf()
    };
    let path = base.join(format!("{}.yaml", stem));

    let yaml = YamlCollection {
        name: collection.name,
        description: collection.description,
        base_url: collection.base_url,
        requests: collection.requests.into_iter().map(out_to_yaml_req).collect(),
        folders: save_folders(collection.folders),
    };

    let content = serde_yaml::to_string(&yaml).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}
