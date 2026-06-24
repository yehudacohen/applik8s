use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RUNTIME_CONTRACT_JSON: &str = include_str!("../generated/runtime-contract.json");
pub const CONTRACT_VERSION: &str = "applik8s.runtime-contract/v1alpha1";
pub const ABI_VERSION: &str = "applik8s.handler/v1alpha1";
pub const RUNTIME_ADAPTER_KIND: &str = "wasmComponent";

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeContract {
    pub contract_version: String,
    pub abi_version: String,
    pub runtime_adapter_kind: String,
    pub wit_package: String,
    pub world: String,
    pub wit_source: String,
    pub wire_format: WireFormat,
    pub canonical: CanonicalFunctions,
    pub payload_schema_kinds: Vec<String>,
    pub operation_kinds: Vec<String>,
    pub javascript_runtime_features: Vec<String>,
    pub payload_schemas: BTreeMap<String, Value>,
    pub generated_by: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WireFormat {
    pub input_encoding: String,
    pub output_encoding: String,
    pub error_encoding: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalFunctions {
    pub handle_export: String,
    pub capability_request_import: String,
    pub log_import: String,
    pub cancel_import: String,
}

pub fn runtime_contract() -> Result<RuntimeContract, serde_json::Error> {
    serde_json::from_str(RUNTIME_CONTRACT_JSON)
}

pub fn validate_payload_schema(kind: &str, payload: &Value) -> Result<(), String> {
    let contract = runtime_contract().map_err(|error| error.to_string())?;
    let schema = contract
        .payload_schemas
        .get(kind)
        .ok_or_else(|| format!("unknown payload schema kind: {kind}"))?;
    let validator = jsonschema::validator_for(schema).map_err(|error| error.to_string())?;

    validator
        .validate(payload)
        .map_err(|error| error.to_string())
}

pub fn decode_handler_input(payload: Value) -> Result<HandlerInput, String> {
    validate_payload_schema("handlerInput", &payload)?;
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

pub fn decode_normalized_operation_plan(payload: Value) -> Result<NormalizedOperationPlan, String> {
    validate_payload_schema("normalizedOperationPlan", &payload)?;
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandlerInput {
    pub abi_version: String,
    pub handler_id: String,
    pub event: HandlerEvent,
    pub object: KubernetesObject,
    pub previous: Option<KubernetesObject>,
    pub observed: Option<ObservedState>,
    pub config: Option<Value>,
    pub capabilities: Option<BTreeMap<String, CapabilityDescriptor>>,
    pub runtime: RuntimeInvocationMetadata,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum HandlerEvent {
    #[serde(rename = "reconcile")]
    Reconcile,
    #[serde(rename = "created")]
    Created,
    #[serde(rename = "updated")]
    Updated,
    #[serde(rename = "deleted")]
    Deleted,
    #[serde(rename = "finalize")]
    Finalize,
    #[serde(rename = "statusChanged")]
    StatusChanged,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesObject {
    pub api_version: String,
    pub kind: String,
    pub metadata: ObjectMeta,
    pub spec: Option<Value>,
    pub status: Option<Value>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectMeta {
    pub name: String,
    pub namespace: Option<String>,
    pub uid: Option<String>,
    pub resource_version: Option<String>,
    pub generation: Option<f64>,
    pub labels: Option<BTreeMap<String, String>>,
    pub annotations: Option<BTreeMap<String, String>>,
    pub finalizers: Option<Vec<String>>,
    pub deletion_timestamp: Option<String>,
    pub creation_timestamp: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRef {
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub namespace: Option<String>,
    pub uid: Option<String>,
    pub resource_version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObservedState {
    pub related_objects: Vec<KubernetesObject>,
    pub resource_version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInvocationMetadata {
    pub operator_name: String,
    pub reconcile_id: String,
    pub bundle_digest: String,
    pub runtime_version: String,
    pub started_at: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDescriptor {
    pub name: String,
    pub kind: String,
    pub endpoint: Option<String>,
    pub sensitive: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedOperationPlan {
    pub operations: Vec<Operation>,
    pub diagnostics: Option<Vec<Diagnostic>>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind")]
pub enum Operation {
    #[serde(rename = "apply")]
    Apply {
        resource: KubernetesObject,
        #[serde(rename = "fieldManager")]
        field_manager: Option<String>,
        force: Option<bool>,
        ownership: Option<ApplyOwnership>,
    },
    #[serde(rename = "patch")]
    Patch {
        #[serde(rename = "ref")]
        ref_: ObjectRef,
        patch: Vec<JsonPatchEntry>,
    },
    #[serde(rename = "delete")]
    Delete {
        #[serde(rename = "ref")]
        ref_: ObjectRef,
        options: Option<DeleteOptions>,
    },
    #[serde(rename = "status")]
    Status {
        status: Value,
        #[serde(rename = "ref")]
        ref_: Option<ObjectRef>,
    },
    #[serde(rename = "event")]
    Event {
        #[serde(rename = "type")]
        event_type: KubernetesEventType,
        reason: String,
        message: String,
        regarding: Option<ObjectRef>,
    },
    #[serde(rename = "finalizer")]
    Finalizer {
        operation: FinalizerOperation,
        finalizer: String,
    },
    #[serde(rename = "requeue")]
    Requeue { policy: RequeuePolicy },
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "mode")]
pub enum ApplyOwnership {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "none")]
    None,
    #[serde(rename = "reference")]
    Reference {
        #[serde(rename = "ref")]
        ref_: ObjectRef,
        #[serde(rename = "blockOwnerDeletion")]
        block_owner_deletion: Option<bool>,
    },
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub enum KubernetesEventType {
    Normal,
    Warning,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JsonPatchEntry {
    pub op: JsonPatchOperation,
    pub path: String,
    pub value: Option<Value>,
    pub from: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JsonPatchOperation {
    Add,
    Remove,
    Replace,
    Move,
    Copy,
    Test,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOptions {
    pub propagation_policy: Option<PropagationPolicy>,
    pub grace_period_seconds: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub enum PropagationPolicy {
    Foreground,
    Background,
    Orphan,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FinalizerOperation {
    Add,
    Remove,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequeuePolicy {
    pub after_seconds: Option<f64>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}
