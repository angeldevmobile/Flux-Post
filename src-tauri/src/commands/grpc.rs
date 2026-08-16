use bytes::{Buf, BufMut, Bytes};
use chrono::Utc;
use futures_util::stream;
use prost::Message as ProstMessage;
use prost_reflect::{Cardinality, DescriptorPool, DynamicMessage, Kind, MessageDescriptor};
use prost_types::FileDescriptorProto;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{Ascii, MetadataKey, MetadataValue};
use tonic::transport::{Channel, ClientTlsConfig};
use tonic::Request;
use tonic_reflection::pb::v1::{
    server_reflection_client::ServerReflectionClient,
    server_reflection_request, server_reflection_response, ServerReflectionRequest,
};

//    State                                                                      

// Each entry: (pool, serialized FileDescriptorSet bytes for persistence)
pub struct GrpcProtos(pub Mutex<HashMap<String, (DescriptorPool, Vec<u8>)>>);

//    DTOs                                                                       

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcField {
    pub name: String,
    pub kind: String,
    pub type_name: String,
    pub repeated: bool,
    pub optional: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethod {
    pub name: String,
    pub input_type: String,
    pub output_type: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
    pub input_fields: Vec<GrpcField>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcService {
    pub name: String,
    pub full_name: String,
    pub methods: Vec<GrpcMethod>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoInfo {
    pub id: String,
    pub services: Vec<GrpcService>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcResponse {
    pub body: String,
    pub duration_ms: u64,
    pub trailers: HashMap<String, String>,
}

//    Proto Library                                                              

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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

//    Raw-bytes codec for dynamic gRPC calls                                     

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

//    Helpers                                                                    

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

/// JSON → protobuf wire bytes, against the method's input descriptor.
fn encode_from_json(desc: &MessageDescriptor, json: &str) -> Result<Bytes, String> {
    use serde::de::DeserializeSeed;
    let mut de = serde_json::Deserializer::from_str(json);
    let msg: DynamicMessage = desc
        .clone()
        .deserialize(&mut de)
        .map_err(|e| format!("Failed to encode request: {}", e))?;
    Ok(Bytes::from(msg.encode_to_vec()))
}

/// Protobuf wire bytes → pretty JSON, against the method's output descriptor.
fn decode_to_json(desc: &MessageDescriptor, bytes: Bytes) -> Result<String, String> {
    let msg = DynamicMessage::decode(desc.clone(), bytes)
        .map_err(|e| format!("Failed to decode response: {}", e))?;
    serde_json::to_string_pretty(&msg).map_err(|e| format!("Failed to serialize response: {}", e))
}

fn apply_metadata<T>(req: &mut Request<T>, metadata: &HashMap<String, String>) -> Result<(), String> {
    for (k, v) in metadata {
        let key = MetadataKey::<Ascii>::from_bytes(k.as_bytes())
            .map_err(|e| format!("Invalid metadata key '{}': {}", k, e))?;
        let val = MetadataValue::<Ascii>::try_from(v.as_str())
            .map_err(|e| format!("Invalid metadata value: {}", e))?;
        req.metadata_mut().insert(key, val);
    }
    Ok(())
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

//    Commands                                                                   

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

    if method_desc.is_client_streaming() || method_desc.is_server_streaming() {
        return Err(format!(
            "'{}' is a streaming method — open it with grpc_stream_open instead",
            method
        ));
    }

    let encoded = encode_from_json(&method_desc.input(), &payload_json)?;

    // Build channel
    let channel = build_channel(&endpoint, use_tls).await?;

    // Build request with metadata
    let mut request = Request::new(encoded);
    apply_metadata(&mut request, &metadata)?;

    // Make unary call
    let path = format!("/{}/{}", service, method)
        .parse::<http::uri::PathAndQuery>()
        .map_err(|e| e.to_string())?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("Channel not ready: {}", e))?;

    let response = grpc
        .unary(request, path, BytesCodec)
        .await
        .map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as u64;

    let body = decode_to_json(&method_desc.output(), response.into_inner())?;

    Ok(GrpcResponse {
        body,
        duration_ms,
        trailers: HashMap::new(),
    })
}

//    Streaming

/// One frame of a streaming call, pushed to the UI as a Tauri event.
/// `payload` carries the decoded JSON message, or the error/close reason.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStreamEvent {
    pub stream_id: String,
    pub payload: String,
    pub seq: u64,
}

pub struct GrpcStreamHandle {
    cancel: Option<oneshot::Sender<()>>,
    /// Present only for client-streaming and bidi calls. Dropping it is what
    /// signals end-of-stream to the server, so `close_send` just takes it.
    outbound: Option<mpsc::UnboundedSender<Bytes>>,
    input: MessageDescriptor,
}

pub struct GrpcStreams(pub Mutex<HashMap<String, GrpcStreamHandle>>);

impl GrpcStreams {
    pub fn new() -> Self {
        GrpcStreams(Mutex::new(HashMap::new()))
    }
}

impl Default for GrpcStreams {
    fn default() -> Self {
        Self::new()
    }
}

fn emit_stream(app: &AppHandle, event: &str, stream_id: &str, payload: String, seq: u64) {
    let _ = app.emit(
        event,
        GrpcStreamEvent {
            stream_id: stream_id.to_string(),
            payload,
            seq,
        },
    );
}

/// Drains an inbound response stream into `grpc-stream-message` events until the
/// server completes it, it errors, or the user cancels. Shared by server-streaming
/// and bidi calls, which differ only in how the request side is built.
async fn pump_responses(
    app: AppHandle,
    stream_id: String,
    mut inbound: tonic::Streaming<Bytes>,
    output: MessageDescriptor,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let mut seq = 0u64;
    loop {
        tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                emit_stream(&app, "grpc-stream-closed", &stream_id, "cancelled".into(), seq);
                return;
            }
            msg = inbound.message() => {
                match msg {
                    Ok(Some(bytes)) => match decode_to_json(&output, bytes) {
                        Ok(json) => {
                            emit_stream(&app, "grpc-stream-message", &stream_id, json, seq);
                            seq += 1;
                        }
                        Err(e) => {
                            emit_stream(&app, "grpc-stream-error", &stream_id, e, seq);
                            return;
                        }
                    },
                    Ok(None) => {
                        emit_stream(&app, "grpc-stream-closed", &stream_id, "completed".into(), seq);
                        return;
                    }
                    Err(e) => {
                        emit_stream(&app, "grpc-stream-error", &stream_id, e.to_string(), seq);
                        return;
                    }
                }
            }
        }
    }
}

/// Opens a streaming call and returns its id. Messages arrive as
/// `grpc-stream-message` events; the call ends with `grpc-stream-closed` or
/// `grpc-stream-error`. For client-streaming and bidi methods, `payload_json`
/// seeds the first message (may be empty) and further ones go through
/// `grpc_stream_send`.
#[tauri::command]
pub async fn grpc_stream_open(
    endpoint: String,
    service: String,
    method: String,
    payload_json: String,
    metadata: HashMap<String, String>,
    use_tls: bool,
    proto_id: String,
    app: AppHandle,
    state: State<'_, GrpcProtos>,
    streams: State<'_, GrpcStreams>,
) -> Result<String, String> {
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

    let client_streaming = method_desc.is_client_streaming();
    let server_streaming = method_desc.is_server_streaming();
    if !client_streaming && !server_streaming {
        return Err(format!("'{}' is unary — send it with grpc_invoke instead", method));
    }

    let input_desc = method_desc.input();
    let output_desc = method_desc.output();

    // Encode the seed message before anything is registered, so a malformed
    // payload fails the command outright rather than opening a dead stream.
    let seed = if payload_json.trim().is_empty() {
        None
    } else {
        Some(encode_from_json(&input_desc, &payload_json)?)
    };

    if !client_streaming && seed.is_none() {
        return Err("This method needs a request message".to_string());
    }

    let path = format!("/{}/{}", service, method)
        .parse::<http::uri::PathAndQuery>()
        .map_err(|e| e.to_string())?;

    let channel = build_channel(&endpoint, use_tls).await?;

    let stream_id = uuid::Uuid::new_v4().to_string();
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

    let outbound_rx = if client_streaming {
        let (tx, rx) = mpsc::unbounded_channel::<Bytes>();
        if let Some(first) = seed.clone() {
            let _ = tx.send(first);
        }
        streams.0.lock().unwrap().insert(
            stream_id.clone(),
            GrpcStreamHandle {
                cancel: Some(cancel_tx),
                outbound: Some(tx),
                input: input_desc.clone(),
            },
        );
        Some(rx)
    } else {
        streams.0.lock().unwrap().insert(
            stream_id.clone(),
            GrpcStreamHandle {
                cancel: Some(cancel_tx),
                outbound: None,
                input: input_desc.clone(),
            },
        );
        None
    };

    let app_task = app.clone();
    let sid = stream_id.clone();

    tokio::spawn(async move {
        let mut grpc = tonic::client::Grpc::new(channel);
        if let Err(e) = grpc.ready().await {
            emit_stream(&app_task, "grpc-stream-error", &sid, format!("Channel not ready: {}", e), 0);
            app_task.state::<GrpcStreams>().0.lock().unwrap().remove(&sid);
            return;
        }

        match (client_streaming, server_streaming) {
            // Server streaming: one request, many responses.
            (false, true) => {
                let mut req = Request::new(seed.expect("seed checked above"));
                if let Err(e) = apply_metadata(&mut req, &metadata) {
                    emit_stream(&app_task, "grpc-stream-error", &sid, e, 0);
                    app_task.state::<GrpcStreams>().0.lock().unwrap().remove(&sid);
                    return;
                }
                match grpc.server_streaming(req, path, BytesCodec).await {
                    Ok(resp) => {
                        pump_responses(app_task.clone(), sid.clone(), resp.into_inner(), output_desc, cancel_rx).await
                    }
                    Err(e) => emit_stream(&app_task, "grpc-stream-error", &sid, e.to_string(), 0),
                }
            }

            // Client streaming: many requests, a single response.
            (true, false) => {
                let rx = outbound_rx.expect("outbound channel built for client streaming");
                let mut req = Request::new(UnboundedReceiverStream::new(rx));
                if let Err(e) = apply_metadata(&mut req, &metadata) {
                    emit_stream(&app_task, "grpc-stream-error", &sid, e, 0);
                    app_task.state::<GrpcStreams>().0.lock().unwrap().remove(&sid);
                    return;
                }
                let mut cancel_rx = cancel_rx;
                tokio::select! {
                    biased;
                    _ = &mut cancel_rx => {
                        emit_stream(&app_task, "grpc-stream-closed", &sid, "cancelled".into(), 0);
                    }
                    res = grpc.client_streaming(req, path, BytesCodec) => match res {
                        Ok(resp) => match decode_to_json(&output_desc, resp.into_inner()) {
                            Ok(json) => {
                                emit_stream(&app_task, "grpc-stream-message", &sid, json, 0);
                                emit_stream(&app_task, "grpc-stream-closed", &sid, "completed".into(), 1);
                            }
                            Err(e) => emit_stream(&app_task, "grpc-stream-error", &sid, e, 0),
                        },
                        Err(e) => emit_stream(&app_task, "grpc-stream-error", &sid, e.to_string(), 0),
                    }
                }
            }

            // Bidirectional: many requests, many responses.
            (true, true) => {
                let rx = outbound_rx.expect("outbound channel built for client streaming");
                let mut req = Request::new(UnboundedReceiverStream::new(rx));
                if let Err(e) = apply_metadata(&mut req, &metadata) {
                    emit_stream(&app_task, "grpc-stream-error", &sid, e, 0);
                    app_task.state::<GrpcStreams>().0.lock().unwrap().remove(&sid);
                    return;
                }
                match grpc.streaming(req, path, BytesCodec).await {
                    Ok(resp) => {
                        pump_responses(app_task.clone(), sid.clone(), resp.into_inner(), output_desc, cancel_rx).await
                    }
                    Err(e) => emit_stream(&app_task, "grpc-stream-error", &sid, e.to_string(), 0),
                }
            }

            (false, false) => unreachable!("unary rejected above"),
        }

        // The call is over either way — drop the handle so the map does not grow
        // across a long session.
        app_task.state::<GrpcStreams>().0.lock().unwrap().remove(&sid);
    });

    Ok(stream_id)
}

/// Pushes another message into an open client-streaming or bidi call.
#[tauri::command]
pub async fn grpc_stream_send(
    stream_id: String,
    payload_json: String,
    streams: State<'_, GrpcStreams>,
) -> Result<(), String> {
    let (tx, input) = {
        let guard = streams.0.lock().unwrap();
        let handle = guard
            .get(&stream_id)
            .ok_or_else(|| "Stream is not open".to_string())?;
        let tx = handle
            .outbound
            .clone()
            .ok_or_else(|| "This method does not accept client messages".to_string())?;
        (tx, handle.input.clone())
    };

    let bytes = encode_from_json(&input, &payload_json)?;
    tx.send(bytes)
        .map_err(|_| "Stream already closed".to_string())
}

/// Signals end-of-stream on the request side, letting the server finish.
/// Only meaningful for client-streaming and bidi calls.
#[tauri::command]
pub async fn grpc_stream_close_send(
    stream_id: String,
    streams: State<'_, GrpcStreams>,
) -> Result<(), String> {
    let mut guard = streams.0.lock().unwrap();
    let handle = guard
        .get_mut(&stream_id)
        .ok_or_else(|| "Stream is not open".to_string())?;
    // Dropping the sender closes the request stream.
    handle.outbound.take();
    Ok(())
}

/// Aborts a streaming call in either direction.
#[tauri::command]
pub async fn grpc_stream_cancel(
    stream_id: String,
    streams: State<'_, GrpcStreams>,
) -> Result<(), String> {
    if let Some(mut handle) = streams.0.lock().unwrap().remove(&stream_id) {
        if let Some(tx) = handle.cancel.take() {
            let _ = tx.send(());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROTO: &str = r#"
syntax = "proto3";
package test;

message Hello {
  string name = 1;
  int32 count = 2;
}

message Reply {
  string text = 1;
}

service Greeter {
  rpc Unary (Hello) returns (Reply) {}
  rpc ServerStream (Hello) returns (stream Reply) {}
  rpc ClientStream (stream Hello) returns (Reply) {}
  rpc BidiStream (stream Hello) returns (stream Reply) {}
}
"#;

    fn pool() -> DescriptorPool {
        let dir = std::env::temp_dir().join(format!("flux_grpc_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("test.proto"), PROTO).unwrap();
        let fds = protox::compile(["test.proto"], [&dir]).expect("proto should compile");
        std::fs::remove_dir_all(&dir).ok();
        DescriptorPool::from_file_descriptor_set(fds).unwrap()
    }

    fn message(name: &str) -> MessageDescriptor {
        pool().get_message_by_name(name).expect("message should exist")
    }

    #[test]
    fn extract_services_reports_each_streaming_mode() {
        let services = extract_services(&pool());
        let greeter = services
            .iter()
            .find(|s| s.full_name == "test.Greeter")
            .expect("service should be found");

        let kinds: HashMap<&str, (bool, bool)> = greeter
            .methods
            .iter()
            .map(|m| (m.name.as_str(), (m.client_streaming, m.server_streaming)))
            .collect();

        assert_eq!(kinds["Unary"], (false, false));
        assert_eq!(kinds["ServerStream"], (false, true));
        assert_eq!(kinds["ClientStream"], (true, false));
        assert_eq!(kinds["BidiStream"], (true, true));
    }

    #[test]
    fn extract_services_lists_input_fields() {
        let services = extract_services(&pool());
        let greeter = services.iter().find(|s| s.full_name == "test.Greeter").unwrap();
        let unary = greeter.methods.iter().find(|m| m.name == "Unary").unwrap();

        assert_eq!(unary.input_type, "test.Hello");
        assert_eq!(unary.output_type, "test.Reply");

        let names: Vec<&str> = unary.input_fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["name", "count"]);
        assert_eq!(unary.input_fields[0].kind, "string");
        assert_eq!(unary.input_fields[1].kind, "int32");
    }

    #[test]
    fn json_survives_an_encode_decode_round_trip() {
        let desc = message("test.Hello");
        let bytes = encode_from_json(&desc, r#"{"name":"ana","count":7}"#).unwrap();
        let json = decode_to_json(&desc, bytes).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["name"], "ana");
        assert_eq!(value["count"], 7);
    }

    #[test]
    fn an_empty_message_encodes_to_no_bytes() {
        let desc = message("test.Hello");
        assert!(encode_from_json(&desc, "{}").unwrap().is_empty());
    }

    #[test]
    fn malformed_json_is_rejected_rather_than_panicking() {
        let desc = message("test.Hello");
        assert!(encode_from_json(&desc, "not json").is_err());
        assert!(encode_from_json(&desc, r#"{"name":"#).is_err());
    }

    #[test]
    fn an_unknown_field_is_rejected() {
        let desc = message("test.Hello");
        assert!(encode_from_json(&desc, r#"{"nope":1}"#).is_err());
    }

    #[test]
    fn metadata_keys_are_validated() {
        let mut req = Request::new(Bytes::new());
        let mut md = HashMap::new();
        md.insert("authorization".to_string(), "Bearer tok".to_string());
        assert!(apply_metadata(&mut req, &md).is_ok());
        assert_eq!(
            req.metadata().get("authorization").unwrap().to_str().unwrap(),
            "Bearer tok"
        );

        let mut bad = HashMap::new();
        bad.insert("invalid key!".to_string(), "x".to_string());
        assert!(apply_metadata(&mut Request::new(Bytes::new()), &bad).is_err());
    }
}

//    Proto Library Commands

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
pub async fn grpc_rename_proto(id: String, name: String, app: AppHandle) -> Result<(), String> {
    let dir = protos_dir(&app)?;
    let mut index = read_index(&dir);
    if let Some(entry) = index.iter_mut().find(|m| m.id == id) {
        entry.name = name;
    }
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
