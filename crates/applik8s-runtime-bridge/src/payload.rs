use applik8s_runtime_contract::{
    ABI_VERSION, HandlerInput, NormalizedOperationPlan, decode_handler_input,
    decode_normalized_operation_plan, validate_payload_schema,
};
use serde_json::Value;

use crate::error::RuntimeBridgeError;

pub fn validate_handler_input(payload: &Value) -> Result<(), RuntimeBridgeError> {
    validate_payload_schema("handlerInput", payload).map_err(RuntimeBridgeError::InvalidPayload)
}

pub fn validate_handler_output_plan(payload: &Value) -> Result<(), RuntimeBridgeError> {
    validate_payload_schema("normalizedOperationPlan", payload)
        .map_err(RuntimeBridgeError::InvalidPayload)
}

pub fn decode_handler_input_payload(payload: Value) -> Result<HandlerInput, RuntimeBridgeError> {
    decode_handler_input(payload).map_err(RuntimeBridgeError::InvalidPayload)
}

pub fn decode_handler_output_plan_payload(
    payload: Value,
) -> Result<NormalizedOperationPlan, RuntimeBridgeError> {
    decode_normalized_operation_plan(payload).map_err(RuntimeBridgeError::InvalidPayload)
}

pub fn runtime_abi_version() -> &'static str {
    ABI_VERSION
}
