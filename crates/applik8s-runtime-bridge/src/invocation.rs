use applik8s_runtime_contract::NormalizedOperationPlan;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component, Linker};
use wasmtime::{Engine, Store};

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

#[derive(Clone, Default)]
struct InvocationState {
    capability_request: Option<CapabilityRequestHandler>,
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
    )
    .await
}

async fn invoke_handler_component_bytes_with_policy(
    engine: &Engine,
    component_bytes: &[u8],
    input: Value,
    allowed_host_imports: &[String],
    timeout: Option<Duration>,
    capability_request: Option<CapabilityRequestHandler>,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    validate_handler_input(&input)?;

    let component = Component::new(engine, component_bytes)?;
    validate_component_host_imports(engine, &component, allowed_host_imports)?;
    let mut linker = Linker::new(engine);
    define_canonical_host_imports(&mut linker)?;
    let mut store = Store::new(engine, InvocationState { capability_request });
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
            Ok(Err(error)) => return Err(RuntimeBridgeError::Wasmtime(error)),
            Err(_) => {
                return Err(RuntimeBridgeError::HandlerTimedOut {
                    timeout_ms: timeout.as_millis() as u64,
                });
            }
        },
        None => match call.await {
            Ok(result) => result.0.map_err(RuntimeBridgeError::HandlerFailed)?,
            Err(error) => return Err(RuntimeBridgeError::Wasmtime(error)),
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
}

pub fn canonical_host_imports() -> Vec<String> {
    vec![
        "capability-request".to_string(),
        "log".to_string(),
        "cancel".to_string(),
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
