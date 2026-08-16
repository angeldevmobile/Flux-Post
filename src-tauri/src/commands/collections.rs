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

#[derive(Debug, Deserialize, Serialize)]
struct YamlRequest {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    body_type: Option<String>,
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
    name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    requests: Vec<YamlRequest>,
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
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionOut {
    pub id: String,
    pub name: String,
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
        name: r.name,
        kind: r.kind,
        method: r.method,
        path: r.path,
        headers: r.headers,
        body: r.body,
        body_type: r.body_type,
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

    #[test]
    fn a_collection_with_no_requests_parses() {
        let col = parse("name: Empty\n");
        assert_eq!(col.name, "Empty");
        assert!(col.requests.is_empty());
        assert!(col.folders.is_empty());
    }
}

//    Commands

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

            let requests = yaml.requests.into_iter().enumerate()
                .map(|(i, r)| yaml_req_to_out(r, format!("{}-{}", full_id, i)))
                .collect();
            let folders = yaml.folders.into_iter().enumerate()
                .map(|(fi, f)| {
                    let fid = format!("{}-f{}", full_id, fi);
                    let freq = f.requests.into_iter().enumerate()
                        .map(|(ri, r)| yaml_req_to_out(r, format!("{}-{}", fid, ri)))
                        .collect();
                    FolderOut { id: fid, name: f.name, expanded: true, requests: freq }
                })
                .collect();

            Some(CollectionOut { id: full_id, name: yaml.name, base_url: yaml.base_url, requests, folders, expanded: true, group: group.clone() })
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
    // id may be "Group/stem" for grouped collections — use only the last segment as filename
    let stem = collection.id.rsplit('/').next().unwrap_or(&collection.id);
    let base = if let Some(ref g) = collection.group {
        Path::new(&dir).join(g)
    } else {
        Path::new(&dir).to_path_buf()
    };
    let path = base.join(format!("{}.yaml", stem));

    let yaml = YamlCollection {
        name: collection.name,
        description: None,
        base_url: collection.base_url,
        requests: collection.requests.into_iter().map(out_to_yaml_req).collect(),
        folders: collection.folders.into_iter().map(|f| YamlFolder {
            name: f.name,
            requests: f.requests.into_iter().map(out_to_yaml_req).collect(),
        }).collect(),
    };

    let content = serde_yaml::to_string(&yaml).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}
