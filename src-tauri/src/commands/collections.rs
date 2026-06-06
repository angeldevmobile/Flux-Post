use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

// ── YAML schema ───────────────────────────────────────────────────────────────

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

// ── Output DTOs (sent to / received from TypeScript) ─────────────────────────

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
}

// ── Conversions ───────────────────────────────────────────────────────────────

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

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_collections(dir: String) -> Result<Vec<CollectionOut>, String> {
    let path = Path::new(&dir);
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir));
    }

    let mut collections: Vec<CollectionOut> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            matches!(p.extension().and_then(|x| x.to_str()), Some("yaml") | Some("yml"))
        })
        .filter_map(|e| {
            let p = e.path();
            let content = fs::read_to_string(&p).ok()?;
            let yaml: YamlCollection = serde_yaml::from_str(&content).ok()?;
            let id = p.file_stem()?.to_str()?.to_string();

            let requests = yaml.requests.into_iter().enumerate()
                .map(|(i, r)| yaml_req_to_out(r, format!("{}-{}", id, i)))
                .collect();

            let folders = yaml.folders.into_iter().enumerate()
                .map(|(fi, f)| {
                    let fid = format!("{}-f{}", id, fi);
                    let freq = f.requests.into_iter().enumerate()
                        .map(|(ri, r)| yaml_req_to_out(r, format!("{}-{}", fid, ri)))
                        .collect();
                    FolderOut { id: fid, name: f.name, expanded: true, requests: freq }
                })
                .collect();

            Some(CollectionOut { id, name: yaml.name, base_url: yaml.base_url, requests, folders, expanded: true })
        })
        .collect();

    collections.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(collections)
}

#[tauri::command]
pub fn save_collection(dir: String, collection: CollectionOut) -> Result<(), String> {
    let path = Path::new(&dir).join(format!("{}.yaml", collection.id));

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
