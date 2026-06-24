use thiserror::Error;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OperationProgress {
    pub completed_operations: usize,
    pub applied: usize,
    pub patched: usize,
    pub deleted: usize,
    pub status_patched: usize,
    pub events_recorded: usize,
    pub finalizers_mutated: usize,
    pub requeued: usize,
}

#[derive(Debug, Error)]
pub enum RuntimeBridgeError {
    #[error("invalid runtime payload: {0}")]
    InvalidPayload(String),
    #[error("handler returned error: {0}")]
    HandlerFailed(String),
    #[error("handler invocation timed out after {timeout_ms}ms")]
    HandlerTimedOut { timeout_ms: u64 },
    #[error("wasmtime configuration failed: {0}")]
    Wasmtime(#[from] wasmtime::Error),
    #[error("kubernetes API operation failed: {0}")]
    Kubernetes(#[from] kube::Error),
    #[error("runtime JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported operation: {0}")]
    UnsupportedOperation(String),
    #[error("handler component imports undeclared host function: {0}")]
    UndeclaredHostImport(String),
    #[error("operation {index} ({kind} {target}) failed: {cause}")]
    OperationFailed {
        index: usize,
        kind: String,
        target: String,
        field_manager: Option<String>,
        progress: OperationProgress,
        cause: String,
    },
}
