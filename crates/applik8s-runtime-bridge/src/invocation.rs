use applik8s_runtime_contract::NormalizedOperationPlan;
use serde_json::Value;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};
use wasmtime_wasi_http::{
    WasiHttpCtx,
    p2::{HttpResult, WasiHttpCtxView, WasiHttpHooks, WasiHttpView},
};

use crate::error::RuntimeBridgeError;
use crate::payload::{
    decode_handler_output_plan_payload, validate_handler_input, validate_handler_output_plan,
};

pub struct HandlerInvocationPayload {
    pub input: Value,
    pub output_plan: Value,
}

pub type CapabilityRequestFuture = Pin<Box<dyn Future<Output = Result<String, String>> + Send>>;
pub type CapabilityRequestHandler = Arc<dyn Fn(String) -> CapabilityRequestFuture + Send + Sync>;
pub type KubernetesReadFuture = Pin<Box<dyn Future<Output = Result<String, String>> + Send>>;
pub type KubernetesReadHandler = Arc<dyn Fn(String) -> KubernetesReadFuture + Send + Sync>;

/// Host-owned Kubernetes transport policy for ordinary WASI HTTP clients.
/// The bearer identity is never included in the guest input or component.
#[derive(Clone)]
pub struct KubernetesHttpTransport {
    pub guest_endpoint: String,
    pub endpoint: String,
    pub bearer_token: Option<String>,
    pub bearer_token_file: Option<PathBuf>,
    pub ca_certificates: Vec<Vec<u8>>,
    pub tls_server_name: Option<String>,
}

struct InvocationHttpHooks {
    kubernetes: Option<KubernetesHttpTransport>,
}

struct InvocationState {
    capability_request: Option<CapabilityRequestHandler>,
    kubernetes_read: Option<KubernetesReadHandler>,
    wasi: WasiCtx,
    http: WasiHttpCtx,
    http_hooks: InvocationHttpHooks,
    table: ResourceTable,
}

impl InvocationState {
    fn new(
        capability_request: Option<CapabilityRequestHandler>,
        kubernetes_read: Option<KubernetesReadHandler>,
        kubernetes_http: Option<KubernetesHttpTransport>,
    ) -> Self {
        Self {
            capability_request,
            kubernetes_read,
            wasi: WasiCtx::builder().inherit_stderr().build(),
            http: WasiHttpCtx::new(),
            http_hooks: InvocationHttpHooks {
                kubernetes: kubernetes_http,
            },
            table: ResourceTable::new(),
        }
    }
}

impl WasiView for InvocationState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl WasiHttpView for InvocationState {
    fn http(&mut self) -> WasiHttpCtxView<'_> {
        WasiHttpCtxView {
            ctx: &mut self.http,
            table: &mut self.table,
            hooks: &mut self.http_hooks,
        }
    }
}

impl WasiHttpHooks for InvocationHttpHooks {
    fn send_request(
        &mut self,
        mut request: hyper::Request<wasmtime_wasi_http::p2::body::HyperOutgoingBody>,
        mut config: wasmtime_wasi_http::p2::types::OutgoingRequestConfig,
    ) -> HttpResult<wasmtime_wasi_http::p2::types::HostFutureIncomingResponse> {
        if let Some(kubernetes) = &self.kubernetes {
            let guest = kubernetes.guest_endpoint.trim_end_matches('/');
            let requested_origin = request.uri().authority().map(|authority| {
                format!(
                    "{}://{authority}",
                    request.uri().scheme_str().unwrap_or("http")
                )
            });
            if requested_origin.as_deref() != Some(guest) {
                return Err(
                    wasmtime_wasi_http::p2::bindings::http::types::ErrorCode::HttpRequestDenied
                        .into(),
                );
            }
            let path = request
                .uri()
                .path_and_query()
                .map(|value| value.as_str())
                .unwrap_or("/");
            let rewritten = format!("{}{}", kubernetes.endpoint.trim_end_matches('/'), path)
                .parse::<http::Uri>()
                .map_err(|_| {
                    wasmtime_wasi_http::p2::bindings::http::types::ErrorCode::HttpRequestUriInvalid
                })?;
            *request.uri_mut() = rewritten;
            config.use_tls = kubernetes.endpoint.starts_with("https://");
            let token = kubernetes.bearer_token.clone().or_else(|| {
                kubernetes
                    .bearer_token_file
                    .as_ref()
                    .and_then(|path| std::fs::read_to_string(path).ok())
                    .map(|value| value.trim().to_string())
            });
            if let Some(token) = token {
                let value =
                    http::HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| {
                        wasmtime_wasi_http::p2::bindings::http::types::ErrorCode::HttpProtocolError
                    })?;
                request
                    .headers_mut()
                    .insert(http::header::AUTHORIZATION, value);
            }
            if config.use_tls && !kubernetes.ca_certificates.is_empty() {
                return Ok(send_request_with_kubernetes_roots(
                    request,
                    config,
                    kubernetes.ca_certificates.clone(),
                    kubernetes.tls_server_name.clone(),
                ));
            }
        }
        Ok(wasmtime_wasi_http::p2::default_send_request(
            request, config,
        ))
    }
}

fn send_request_with_kubernetes_roots(
    request: hyper::Request<wasmtime_wasi_http::p2::body::HyperOutgoingBody>,
    config: wasmtime_wasi_http::p2::types::OutgoingRequestConfig,
    roots: Vec<Vec<u8>>,
    tls_server_name: Option<String>,
) -> wasmtime_wasi_http::p2::types::HostFutureIncomingResponse {
    let handle = wasmtime_wasi::runtime::spawn(async move {
        Ok(send_request_with_kubernetes_roots_async(request, config, roots, tls_server_name).await)
    });
    wasmtime_wasi_http::p2::types::HostFutureIncomingResponse::pending(handle)
}

async fn send_request_with_kubernetes_roots_async(
    mut request: hyper::Request<wasmtime_wasi_http::p2::body::HyperOutgoingBody>,
    config: wasmtime_wasi_http::p2::types::OutgoingRequestConfig,
    roots: Vec<Vec<u8>>,
    tls_server_name: Option<String>,
) -> Result<
    wasmtime_wasi_http::p2::types::IncomingResponse,
    wasmtime_wasi_http::p2::bindings::http::types::ErrorCode,
> {
    use http_body_util::BodyExt;
    use rustls::pki_types::{CertificateDer, ServerName};
    use tokio::net::TcpStream;
    use tokio::time::timeout;
    use wasmtime_wasi_http::p2::bindings::http::types::ErrorCode;

    let _ = rustls::crypto::ring::default_provider().install_default();

    let authority = request
        .uri()
        .authority()
        .ok_or(ErrorCode::HttpRequestUriInvalid)?;
    let address = authority.to_string();
    let address = if authority.port().is_some() {
        address
    } else {
        format!("{address}:443")
    };
    let tcp = timeout(config.connect_timeout, TcpStream::connect(address))
        .await
        .map_err(|_| ErrorCode::ConnectionTimeout)?
        .map_err(|_| ErrorCode::ConnectionRefused)?;
    let mut root_store = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.into(),
    };
    for root in roots {
        root_store
            .add(CertificateDer::from(root))
            .map_err(|_| ErrorCode::TlsProtocolError)?;
    }
    let tls = tokio_rustls::TlsConnector::from(std::sync::Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth(),
    ));
    let server_name = tls_server_name
        .or_else(|| request.uri().host().map(ToString::to_string))
        .ok_or(ErrorCode::HttpRequestUriInvalid)?;
    let stream = tls
        .connect(
            ServerName::try_from(server_name).map_err(|_| ErrorCode::HttpRequestUriInvalid)?,
            tcp,
        )
        .await
        .map_err(|_| ErrorCode::TlsProtocolError)?;
    let stream = wasmtime_wasi_http::io::TokioIo::new(stream);
    let (mut sender, connection) = timeout(
        config.connect_timeout,
        hyper::client::conn::http1::handshake(stream),
    )
    .await
    .map_err(|_| ErrorCode::ConnectionTimeout)?
    .map_err(|_| ErrorCode::HttpProtocolError)?;
    let worker = wasmtime_wasi::runtime::spawn(async move {
        let _ = connection.await;
    });
    if !request.headers().contains_key(http::header::HOST)
        && let Ok(host) = http::HeaderValue::from_str(authority.as_str())
    {
        request.headers_mut().insert(http::header::HOST, host);
    }
    *request.uri_mut() = http::Uri::builder()
        .path_and_query(
            request
                .uri()
                .path_and_query()
                .map(|value| value.as_str())
                .unwrap_or("/"),
        )
        .build()
        .map_err(|_| ErrorCode::HttpRequestUriInvalid)?;
    let response = timeout(config.first_byte_timeout, sender.send_request(request))
        .await
        .map_err(|_| ErrorCode::ConnectionReadTimeout)?
        .map_err(|_| ErrorCode::HttpProtocolError)?
        .map(|body| {
            body.map_err(|_| ErrorCode::HttpProtocolError)
                .boxed_unsync()
        });
    Ok(wasmtime_wasi_http::p2::types::IncomingResponse {
        resp: response,
        worker: Some(worker),
        between_bytes_timeout: config.between_bytes_timeout,
    })
}

pub trait WasmComponentInvoker {
    fn invoke(&self, input: Value) -> Result<Value, RuntimeBridgeError>;
}

pub fn validate_invocation_payload(
    payload: &HandlerInvocationPayload,
) -> Result<(), RuntimeBridgeError> {
    validate_handler_input(&payload.input)?;
    validate_handler_output_plan(&payload.output_plan)
}

pub fn invoke_handler_component_bytes(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    block_on_invocation(invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        &canonical_host_imports(),
        None,
        None,
        None,
        None,
    ))
}

pub fn invoke_handler_component_bytes_with_allowed_imports(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    block_on_invocation(invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        None,
        None,
        None,
        None,
    ))
}

pub fn invoke_handler_component_bytes_with_timeout(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Duration,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    block_on_invocation(invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        Some(timeout),
        None,
        None,
        None,
    ))
}

pub async fn invoke_handler_component_bytes_with_timeout_async(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Duration,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        Some(timeout),
        None,
        None,
        None,
    )
    .await
}

pub async fn invoke_handler_component_bytes_with_timeout_and_capabilities_async(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Duration,
    capability_request: CapabilityRequestHandler,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        Some(timeout),
        Some(capability_request),
        None,
        None,
    )
    .await
}

pub async fn invoke_handler_component_bytes_with_timeout_and_host_imports_async(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Duration,
    capability_request: CapabilityRequestHandler,
    kubernetes_read: KubernetesReadHandler,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        Some(timeout),
        Some(capability_request),
        Some(kubernetes_read),
        None,
    )
    .await
}

// This explicit host-boundary entrypoint keeps independent capability handlers
// visible to callers; collapsing them into an opaque options bag would weaken
// the security review surface.
#[allow(clippy::too_many_arguments)]
pub async fn invoke_handler_component_bytes_with_timeout_host_imports_and_kubernetes_http_async(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Duration,
    capability_request: CapabilityRequestHandler,
    kubernetes_read: KubernetesReadHandler,
    transport: KubernetesHttpTransport,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        Some(timeout),
        Some(capability_request),
        Some(kubernetes_read),
        Some(transport),
    )
    .await
}

pub async fn invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Duration,
    transport: KubernetesHttpTransport,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    invoke_handler_component_bytes_with_policy(
        engine,
        component_bytes,
        input,
        allowed_host_imports,
        Some(timeout),
        None,
        None,
        Some(transport),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn invoke_handler_component_bytes_with_policy(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Option<Duration>,
    capability_request: Option<CapabilityRequestHandler>,
    kubernetes_read: Option<KubernetesReadHandler>,
    kubernetes_http: Option<KubernetesHttpTransport>,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    validate_handler_input(&input)?;

    let component = Component::new(engine, component_bytes)?;
    validate_component_host_imports(engine, &component, allowed_host_imports)?;
    let mut linker = Linker::new(engine);
    wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
    wasmtime_wasi_http::p2::add_only_http_to_linker_async(&mut linker)?;
    define_canonical_host_imports(&mut linker)?;
    let mut store = Store::new(
        engine,
        InvocationState::new(capability_request, kubernetes_read, kubernetes_http),
    );
    configure_epoch_deadline(&mut store, timeout);
    let instance = linker.instantiate_async(&mut store, &component).await?;
    let handle = instance.get_func(&mut store, "handle").ok_or_else(|| {
        RuntimeBridgeError::InvalidPayload("component does not export handle".to_string())
    })?;
    let handle = handle.typed::<(&str,), (Result<String, String>,)>(&store)?;
    let input_json = serde_json::to_string(&input).map_err(|error| {
        RuntimeBridgeError::InvalidPayload(format!(
            "handler input is not JSON-serializable: {error}"
        ))
    })?;
    let call = handle.call_async(&mut store, (input_json.as_str(),));
    let output_json = match timeout {
        Some(timeout) => match tokio::time::timeout(timeout, call).await {
            Ok(Ok(result)) => result.0.map_err(RuntimeBridgeError::HandlerFailed)?,
            Ok(Err(error)) if is_epoch_deadline_trap(&error) => {
                return Err(RuntimeBridgeError::HandlerTimedOut {
                    timeout_ms: timeout.as_millis() as u64,
                });
            }
            Ok(Err(error)) => return Err(RuntimeBridgeError::HandlerTrap(error.to_string())),
            Err(_) => {
                return Err(RuntimeBridgeError::HandlerTimedOut {
                    timeout_ms: timeout.as_millis() as u64,
                });
            }
        },
        None => match call.await {
            Ok(result) => result.0.map_err(RuntimeBridgeError::HandlerFailed)?,
            Err(error) => return Err(RuntimeBridgeError::HandlerTrap(error.to_string())),
        },
    };
    let output = serde_json::from_str(&output_json).map_err(|error| {
        RuntimeBridgeError::InvalidPayload(format!("handler output is not valid JSON: {error}"))
    })?;

    decode_handler_output_plan_payload(output)
}

fn block_on_invocation(
    future: impl std::future::Future<Output = Result<NormalizedOperationPlan, RuntimeBridgeError>>,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .enable_io()
        .build()
        .map_err(|error| {
            RuntimeBridgeError::UnsupportedOperation(format!(
                "failed to create invocation runtime: {error}"
            ))
        })?
        .block_on(future)
}

fn configure_epoch_deadline(store: &mut Store<InvocationState>, timeout: Option<Duration>) {
    let ticks = timeout.map(timeout_ticks).unwrap_or(1_000_000_000);
    store.set_epoch_deadline(ticks);
    store.epoch_deadline_trap();
}

fn timeout_ticks(timeout: Duration) -> u64 {
    const EPOCH_TICK_MS: u128 = 10;
    let millis = timeout.as_millis().max(1);
    let ticks = millis.div_ceil(EPOCH_TICK_MS);
    ticks.min(u128::from(u64::MAX)) as u64
}

fn is_epoch_deadline_trap(error: &wasmtime::Error) -> bool {
    let message = format!("{error} {error:?}").to_ascii_lowercase();
    message.contains("epoch") || message.contains("interrupt")
}

pub fn component_host_imports(
    engine: &Engine,
    component: &Component,
) -> Result<Vec<String>, RuntimeBridgeError> {
    Ok(component
        .component_type()
        .imports(engine)
        .filter_map(|(name, item)| match item {
            ComponentItem::ComponentFunc(_) => Some(name.to_string()),
            ComponentItem::ComponentInstance(_) => Some(name.to_string()),
            _ => None,
        })
        .collect())
}

pub fn validate_component_host_imports(
    engine: &Engine,
    component: &Component,
    allowed_host_imports: &[String],
) -> Result<(), RuntimeBridgeError> {
    let imports = component_host_imports(engine, component)?;
    for import in imports {
        if !is_allowed_host_import(&import, allowed_host_imports) {
            return Err(RuntimeBridgeError::UndeclaredHostImport(import));
        }
    }
    Ok(())
}

fn is_allowed_host_import(import: &str, allowed_host_imports: &[String]) -> bool {
    allowed_host_imports.iter().any(|allowed| allowed == import)
        || (import == "applik8s:handler/capabilities"
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "capability-request"))
        || (import == "applik8s:handler/kubernetes"
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "kubernetes-read"))
        || (import.starts_with("wasi:cli/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:cli"))
        || (import.starts_with("wasi:clocks/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:clocks"))
        || (import.starts_with("wasi:filesystem/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:filesystem"))
        || (import.starts_with("wasi:io/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:io"))
        || (import.starts_with("wasi:random/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:random"))
        || (import.starts_with("wasi:http/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:http"))
        || (import.starts_with("wasi:sockets/")
            && allowed_host_imports
                .iter()
                .any(|allowed| allowed == "wasi:sockets"))
}

pub fn canonical_host_imports() -> Vec<String> {
    vec![
        "capability-request".to_string(),
        "kubernetes-read".to_string(),
        "log".to_string(),
        "cancel".to_string(),
        "wasi:cli".to_string(),
        "wasi:clocks".to_string(),
        "wasi:filesystem".to_string(),
        "wasi:io".to_string(),
        "wasi:random".to_string(),
        "wasi:http".to_string(),
        "wasi:sockets".to_string(),
    ]
}

pub fn capability_denied_payload() -> String {
    serde_json::json!({
        "code": "CAPABILITY_DENIED",
        "message": "Capability host imports are declared but live external capability execution is not implemented by this runtime host.",
        "retryable": false,
    })
    .to_string()
}

fn define_canonical_host_imports(
    linker: &mut Linker<InvocationState>,
) -> Result<(), RuntimeBridgeError> {
    linker.root().func_wrap_async(
        "capability-request",
        |mut store, (request_json,): (String,)| {
            Box::new(async move {
                let Some(handler) = store.data_mut().capability_request.clone() else {
                    return Ok((Err::<String, String>(capability_denied_payload()),));
                };
                Ok((handler(request_json).await,))
            })
        },
    )?;
    linker
        .instance("applik8s:handler/capabilities")?
        .func_wrap_async(
            "capability-request",
            |mut store, (request_json,): (String,)| {
                Box::new(async move {
                    let Some(handler) = store.data_mut().capability_request.clone() else {
                        return Ok((Err::<String, String>(capability_denied_payload()),));
                    };
                    Ok((handler(request_json).await,))
                })
            },
        )?;
    linker.root().func_wrap_async(
        "kubernetes-read",
        |mut store, (request_json,): (String,)| {
            Box::new(async move {
                let Some(handler) = store.data_mut().kubernetes_read.clone() else {
                    return Ok((Err::<String, String>(
                        "Kubernetes read host import is not implemented by this runtime host."
                            .to_string(),
                    ),));
                };
                Ok((handler(request_json).await,))
            })
        },
    )?;
    linker
        .instance("applik8s:handler/kubernetes")?
        .func_wrap_async(
            "kubernetes-read",
            |mut store, (request_json,): (String,)| {
                Box::new(async move {
                    let Some(handler) = store.data_mut().kubernetes_read.clone() else {
                        return Ok((Err::<String, String>(
                            "Kubernetes read host import is not implemented by this runtime host."
                                .to_string(),
                        ),));
                    };
                    Ok((handler(request_json).await,))
                })
            },
        )?;
    linker
        .root()
        .func_wrap_async("log", |_store, (_event_json,): (String,)| {
            Box::new(async move { Ok(()) })
        })?;
    linker
        .root()
        .func_wrap_async("cancel", |_store, (_reason_json,): (String,)| {
            Box::new(async move { Ok(()) })
        })?;

    Ok(())
}
