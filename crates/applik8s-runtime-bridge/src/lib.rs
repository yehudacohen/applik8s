// RuntimeBridgeError is intentionally descriptive and carries complete
// fail-closed diagnostics. It is constructed only on error paths; boxing every
// public Result would make the bridge API noisier without improving hot-path
// behavior.
#![allow(clippy::result_large_err)]

pub mod applier;
pub mod engine;
pub mod error;
pub mod invocation;
pub mod kube;
pub mod payload;
mod remote_authority;

pub use applier::{AppliedOperationSummary, KubeOperationPlanApplier, validate_operation_plan};
pub use engine::{KubeRuntimeBridge, component_model_engine};
pub use error::{OperationProgress, RuntimeBridgeError};
pub use invocation::{
    CapabilityRequestFuture, CapabilityRequestHandler, HandlerInvocationPayload,
    KubernetesHttpTransport, KubernetesReadFuture, KubernetesReadHandler, WasmComponentInvoker,
    canonical_host_imports, capability_denied_payload, component_host_imports,
    invoke_handler_component_bytes, invoke_handler_component_bytes_with_allowed_imports,
    invoke_handler_component_bytes_with_timeout,
    invoke_handler_component_bytes_with_timeout_and_capabilities_async,
    invoke_handler_component_bytes_with_timeout_and_host_imports_async,
    invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async,
    invoke_handler_component_bytes_with_timeout_async,
    invoke_handler_component_bytes_with_timeout_host_imports_and_kubernetes_http_async,
    validate_component_host_imports,
};
pub use kube::retry_after;
pub use payload::{
    decode_handler_input_payload, decode_handler_output_plan_payload, runtime_abi_version,
    validate_handler_input, validate_handler_output_plan,
};
