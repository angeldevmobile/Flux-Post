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
    let stem = collection.id.split('/').last().unwrap_or(&collection.id);
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
