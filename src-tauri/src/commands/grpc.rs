use bytes::{Buf, BufMut, Bytes};
use chrono::Utc;
use futures_util::stream;
use prost::Message as ProstMessage;
use prost_reflect::{Cardinality, DescriptorPool, DynamicMessage, Kind};
use prost_types::FileDescriptorProto;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{Ascii, MetadataKey, MetadataValue};
use tonic::transport::{Channel, ClientTlsConfig};
use tonic::Request;
use tonic_reflection::pb::v1::{
    server_reflection_client::ServerReflectionClient,
    server_reflection_request, server_reflection_response, ServerReflectionRequest,
};

// ── State ─────────────────────────────────────────────────────────────────────

// Each entry: (pool, serialized FileDescriptorSet bytes for persistence)
pub struct GrpcProtos(pub Mutex<HashMap<String, (DescriptorPool, Vec<u8>)>>);

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrpcField {
    pub name: String,
    pub kind: String,
    pub type_name: String,
    pub repeated: bool,
    pub optional: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrpcMethod {
    pub name: String,
    pub input_type: String,
    pub output_type: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
    pub input_fields: Vec<GrpcField>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrpcService {
    pub name: String,
    pub full_name: String,
    pub methods: Vec<GrpcMethod>,
}

#[derive(Serialize, Deserialize)]
pub struct ProtoInfo {
    pub id: String,
    pub services: Vec<GrpcService>,
}

#[derive(Serialize)]
pub struct GrpcResponse {
    pub body: String,
    pub duration_ms: u64,
    pub trailers: HashMap<String, String>,
}

// ── Proto Library ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedProtoMeta {
    pub id: String,
    pub name: String,
    pub source: String,
    pub services: Vec<GrpcService>,
    pub created_at: String,
}

fn protos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("protos");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_index(dir: &Path) -> Vec<SavedProtoMeta> {
    let Ok(content) = std::fs::read_to_string(dir.join("index.json")) else {
        return vec![];
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn write_index(dir: &Path, index: &[SavedProtoMeta]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("index.json"), content).map_err(|e| e.to_string())
}

// ── Raw-bytes codec for dynamic gRPC calls ────────────────────────────────────

#[derive(Clone, Default)]
struct BytesCodec;

struct BytesEncoder;
struct BytesDecoder;

impl Encoder for BytesEncoder {
    type Item = Bytes;
    type Error = tonic::Status;

    fn encode(&mut self, item: Bytes, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        dst.put(item);
        Ok(())
    }
}

impl Decoder for BytesDecoder {
    type Item = Bytes;
    type Error = tonic::Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let len = src.remaining();
        if len == 0 {
            return Ok(None);
        }
        Ok(Some(src.copy_to_bytes(len)))
    }
}

impl Codec for BytesCodec {
    type Encode = Bytes;
    type Decode = Bytes;
    type Encoder = BytesEncoder;
    type Decoder = BytesDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        BytesEncoder
    }
    fn decoder(&mut self) -> Self::Decoder {
        BytesDecoder
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn kind_name(k: &Kind) -> String {
    match k {
        Kind::Double => "double",
        Kind::Float => "float",
        Kind::Int32 => "int32",
        Kind::Int64 => "int64",
        Kind::Uint32 => "uint32",
        Kind::Uint64 => "uint64",
        Kind::Sint32 => "sint32",
        Kind::Sint64 => "sint64",
        Kind::Fixed32 => "fixed32",
        Kind::Fixed64 => "fixed64",
        Kind::Sfixed32 => "sfixed32",
        Kind::Sfixed64 => "sfixed64",
        Kind::Bool => "bool",
        Kind::String => "string",
        Kind::Bytes => "bytes",
        Kind::Message(_) => "message",
        Kind::Enum(_) => "enum",
    }
    .to_string()
}

fn extract_services(pool: &DescriptorPool) -> Vec<GrpcService> {
    pool.services()
        .map(|svc| {
            let methods = svc
                .methods()
                .map(|m| {
                    let input_desc = m.input();
                    let input_fields = input_desc
                        .fields()
                        .map(|f| {
                            let k = f.kind();
                            let type_name = match &k {
                                Kind::Message(msg) => msg.full_name().to_string(),
                                Kind::Enum(e) => e.full_name().to_string(),
                                _ => String::new(),
                            };
                            GrpcField {
                                name: f.name().to_string(),
                                kind: kind_name(&k),
                                type_name,
                                repeated: f.cardinality() == Cardinality::Repeated,
                                optional: f.cardinality() == Cardinality::Optional,
                            }
                        })
                        .collect();
                    GrpcMethod {
                        name: m.name().to_string(),
                        input_type: m.input().full_name().to_string(),
                        output_type: m.output().full_name().to_string(),
                        client_streaming: m.is_client_streaming(),
                        server_streaming: m.is_server_streaming(),
                        input_fields,
                    }
                })
                .collect();
            GrpcService {
                name: svc.name().to_string(),
                full_name: svc.full_name().to_string(),
                methods,
            }
        })
        .collect()
}

async fn build_channel(endpoint: &str, use_tls: bool) -> Result<Channel, String> {
    let ep = Channel::from_shared(endpoint.to_string()).map_err(|e| e.to_string())?;
    let ep = if use_tls {
        ep.tls_config(ClientTlsConfig::new().with_native_roots())
            .map_err(|e| e.to_string())?
    } else {
        ep
    };
    ep.connect().await.map_err(|e| e.to_string())
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grpc_import_proto(
    proto_content: String,
    state: State<'_, GrpcProtos>,
) -> Result<ProtoInfo, String> {
    let tmp = std::env::temp_dir().join("flux_grpc_input.proto");
    std::fs::write(&tmp, &proto_content).map_err(|e| e.to_string())?;

    let fds = protox::compile(["flux_grpc_input.proto"], [std::env::temp_dir()])
        .map_err(|e| e.to_string())?;

    let fds_bytes = prost::Message::encode_to_vec(&fds);
    let pool = DescriptorPool::from_file_descriptor_set(fds).map_err(|e| e.to_string())?;

    let services = extract_services(&pool);
    let id = uuid::Uuid::new_v4().to_string();
    state.0.lock().unwrap().insert(id.clone(), (pool, fds_bytes));

    Ok(ProtoInfo { id, services })
}

#[tauri::command]
pub async fn grpc_reflect(
    endpoint: String,
    use_tls: bool,
    state: State<'_, GrpcProtos>,
) -> Result<ProtoInfo, String> {
    let channel = build_channel(&endpoint, use_tls).await?;
    let mut client = ServerReflectionClient::new(channel.clone());

    // Step 1: list services
    let list_req = ServerReflectionRequest {
        host: String::new(),
        message_request: Some(server_reflection_request::MessageRequest::ListServices(
            String::new(),
        )),
    };
    let mut resp_stream = client
        .server_reflection_info(stream::iter(vec![list_req]))
        .await
        .map_err(|e| e.to_string())?
        .into_inner();

    let mut service_names: Vec<String> = vec![];
    while let Some(resp) = resp_stream
        .message()
        .await
        .map_err(|e| e.to_string())?
    {
        if let Some(server_reflection_response::MessageResponse::ListServicesResponse(list)) =
            resp.message_response
        {
            for svc in list.service {
                if !svc.name.starts_with("grpc.reflection") {
                    service_names.push(svc.name);
                }
            }
        }
    }

    if service_names.is_empty() {
        return Err("No services found via reflection".to_string());
    }

    // Step 2: get file descriptors for each service
    let desc_reqs: Vec<ServerReflectionRequest> = service_names
        .iter()
        .map(|s| ServerReflectionRequest {
            host: String::new(),
            message_request: Some(
                server_reflection_request::MessageRequest::FileContainingSymbol(s.clone()),
            ),
        })
        .collect();

    let mut client2 = ServerReflectionClient::new(channel);
    let mut resp_stream2 = client2
        .server_reflection_info(stream::iter(desc_reqs))
        .await
        .map_err(|e| e.to_string())?
        .into_inner();

    let mut pool = DescriptorPool::new();
    let mut protos: Vec<FileDescriptorProto> = vec![];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    while let Some(resp) = resp_stream2
        .message()
        .await
        .map_err(|e| e.to_string())?
    {
        if let Some(server_reflection_response::MessageResponse::FileDescriptorResponse(fdr)) =
            resp.message_response
        {
            for proto_bytes in fdr.file_descriptor_proto {
                let fdp = FileDescriptorProto::decode(Bytes::from(proto_bytes))
                    .map_err(|e| e.to_string())?;
                let name = fdp.name().to_string();
                if seen.insert(name) {
                    protos.push(fdp.clone());
                    pool.add_file_descriptor_proto(fdp)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Serialize pool as FileDescriptorSet for persistence
    let fds = prost_types::FileDescriptorSet { file: protos };
    let fds_bytes = prost::Message::encode_to_vec(&fds);

    let services = extract_services(&pool);
    let id = uuid::Uuid::new_v4().to_string();
    state.0.lock().unwrap().insert(id.clone(), (pool, fds_bytes));

    Ok(ProtoInfo { id, services })
}

#[tauri::command]
pub async fn grpc_invoke(
    endpoint: String,
    service: String,
    method: String,
    payload_json: String,
    metadata: HashMap<String, String>,
    use_tls: bool,
    proto_id: String,
    state: State<'_, GrpcProtos>,
) -> Result<GrpcResponse, String> {
    let start = std::time::Instant::now();

    let pool = {
        let guard = state.0.lock().unwrap();
        guard
            .get(&proto_id)
            .map(|(pool, _)| pool.clone())
            .ok_or_else(|| "Proto not loaded — import or reflect first".to_string())?
    };

    let service_desc = pool
        .get_service_by_name(&service)
        .ok_or_else(|| format!("Service '{}' not found in proto", service))?;

    let method_desc = service_desc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| format!("Method '{}' not found in service '{}'", method, service))?;

    // Deserialize JSON → DynamicMessage
    let input_desc = method_desc.input();
    let mut de = serde_json::Deserializer::from_str(&payload_json);
    use serde::de::DeserializeSeed;
    let dyn_msg: DynamicMessage = input_desc
        .deserialize(&mut de)
        .map_err(|e| format!("Failed to encode request: {}", e))?;

    let encoded = Bytes::from(dyn_msg.encode_to_vec());

    // Build channel
    let channel = build_channel(&endpoint, use_tls).await?;

    // Build request with metadata
    let mut request = Request::new(encoded);
    for (k, v) in &metadata {
        let key = MetadataKey::<Ascii>::from_bytes(k.as_bytes())
            .map_err(|e| format!("Invalid metadata key '{}': {}", k, e))?;
        let val = MetadataValue::<Ascii>::try_from(v.as_str())
            .map_err(|e| format!("Invalid metadata value: {}", e))?;
        request.metadata_mut().insert(key, val);
    }

    // Make unary call
    let path = format!("/{}/{}", service, method)
        .parse::<http::uri::PathAndQuery>()
        .map_err(|e| e.to_string())?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("Channel not ready: {}", e))?;

    let response = grpc
        .unary(request, path, BytesCodec::default())
        .await
        .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;

    // Decode response bytes → DynamicMessage → JSON
    let resp_bytes = response.into_inner();
    let output_desc = method_desc.output();
    let resp_msg = DynamicMessage::decode(output_desc, resp_bytes)
        .map_err(|e| format!("Failed to decode response: {}", e))?;

    let body = serde_json::to_string_pretty(&resp_msg)
        .map_err(|e| format!("Failed to serialize response: {}", e))?;

    Ok(GrpcResponse {
        body,
        duration_ms,
        trailers: HashMap::new(),
    })
}

// ── Proto Library Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn grpc_load_protos(app: AppHandle) -> Result<Vec<SavedProtoMeta>, String> {
    let dir = protos_dir(&app)?;
    Ok(read_index(&dir))
}

#[tauri::command]
pub async fn grpc_save_proto(
    name: String,
    source: String,
    proto_id: String,
    state: State<'_, GrpcProtos>,
    app: AppHandle,
) -> Result<SavedProtoMeta, String> {
    let (bytes, services) = {
        let guard = state.0.lock().unwrap();
        let (pool, bytes) = guard
            .get(&proto_id)
            .ok_or("Proto not in memory — import or reflect first")?;
        (bytes.clone(), extract_services(pool))
    };

    let dir = protos_dir(&app)?;
    let id = uuid::Uuid::new_v4().to_string();

    std::fs::write(dir.join(format!("{}.bin", id)), &bytes)
        .map_err(|e| e.to_string())?;

    let meta = SavedProtoMeta {
        id: id.clone(),
        name,
        source,
        services,
        created_at: Utc::now().to_rfc3339(),
    };

    let mut index = read_index(&dir);
    index.push(meta.clone());
    write_index(&dir, &index)?;

    Ok(meta)
}

#[tauri::command]
pub async fn grpc_delete_proto(id: String, app: AppHandle) -> Result<(), String> {
    let dir = protos_dir(&app)?;
    let bin = dir.join(format!("{}.bin", id));
    if bin.exists() {
        std::fs::remove_file(&bin).map_err(|e| e.to_string())?;
    }
    let mut index = read_index(&dir);
    index.retain(|m| m.id != id);
    write_index(&dir, &index)
}

#[tauri::command]
pub async fn grpc_load_proto_by_id(
    id: String,
    app: AppHandle,
    state: State<'_, GrpcProtos>,
) -> Result<ProtoInfo, String> {
    let dir = protos_dir(&app)?;
    let bytes = std::fs::read(dir.join(format!("{}.bin", id)))
        .map_err(|e| format!("Proto not found on disk: {}", e))?;

    let fds = prost_types::FileDescriptorSet::decode(Bytes::from(bytes.clone()))
        .map_err(|e| format!("Failed to decode proto: {}", e))?;
    let pool = DescriptorPool::from_file_descriptor_set(fds).map_err(|e| e.to_string())?;

    let services = extract_services(&pool);
    state.0.lock().unwrap().insert(id.clone(), (pool, bytes));

    Ok(ProtoInfo { id, services })
}
