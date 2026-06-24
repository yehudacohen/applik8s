use applik8s_runtime_contract::{
    ABI_VERSION, CONTRACT_VERSION, HandlerEvent, Operation, RUNTIME_ADAPTER_KIND,
    decode_handler_input, decode_normalized_operation_plan, runtime_contract,
    validate_payload_schema,
};

const VALID_DIGEST: &str =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";

#[test]
fn generated_contract_matches_rust_constants() {
    let contract = runtime_contract().expect("generated runtime contract parses");

    assert_eq!(contract.contract_version, CONTRACT_VERSION);
    assert_eq!(contract.abi_version, ABI_VERSION);
    assert_eq!(contract.runtime_adapter_kind, RUNTIME_ADAPTER_KIND);
    assert_eq!(contract.generated_by, "@applik8s/runtime-contract");
    assert!(contract.wit_source.contains("export handle"));
    assert_eq!(contract.wire_format.input_encoding, "jsonString");
    assert_eq!(contract.wire_format.output_encoding, "jsonString");
    assert_eq!(contract.wire_format.error_encoding, "jsonString");
    assert_eq!(contract.canonical.handle_export, "handle");
    assert!(
        contract
            .payload_schema_kinds
            .contains(&"handlerInput".to_owned())
    );
    assert!(
        contract
            .payload_schema_kinds
            .contains(&"normalizedOperationPlan".to_owned())
    );
    assert!(contract.operation_kinds.contains(&"apply".to_owned()));
    assert!(contract.operation_kinds.contains(&"status".to_owned()));
    assert!(
        contract
            .javascript_runtime_features
            .contains(&"es6Proxy".to_owned())
    );
    assert!(contract.payload_schemas.contains_key("handlerInput"));
    assert!(
        contract
            .payload_schemas
            .contains_key("normalizedOperationPlan")
    );
}

#[test]
fn generated_handler_input_schema_validates_payload_shape() {
    let payload = serde_json::json!({
        "abiVersion": ABI_VERSION,
        "handlerId": "ImageJob.reconcile.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "metadata": { "name": "hero-image", "namespace": "media" },
            "spec": { "sourceUrl": "s3://bucket/hero.png" }
        },
        "runtime": {
            "operatorName": "image-pipeline",
            "reconcileId": "reconcile-1",
            "bundleDigest": VALID_DIGEST,
            "runtimeVersion": "0.1.0",
            "startedAt": "2026-06-19T00:00:00Z"
        }
    });

    validate_payload_schema("handlerInput", &payload).expect("handler input validates");
    let decoded = decode_handler_input(payload).expect("handler input decodes after validation");

    assert_eq!(decoded.abi_version, ABI_VERSION);
    assert_eq!(decoded.event, HandlerEvent::Reconcile);
    assert_eq!(decoded.object.metadata.name, "hero-image");

    let invalid = serde_json::json!({
        "handlerId": "missing-required-fields"
    });

    assert!(validate_payload_schema("handlerInput", &invalid).is_err());

    let extra_field = serde_json::json!({
        "abiVersion": ABI_VERSION,
        "handlerId": "ImageJob.reconcile.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "metadata": { "name": "hero-image" }
        },
        "runtime": {
            "operatorName": "image-pipeline",
            "reconcileId": "reconcile-1",
            "bundleDigest": VALID_DIGEST,
            "runtimeVersion": "0.1.0",
            "startedAt": "2026-06-19T00:00:00Z"
        },
        "ambient": "not part of the ABI"
    });

    assert!(validate_payload_schema("handlerInput", &extra_field).is_err());
}

#[test]
fn generated_operation_plan_schema_validates_operation_variants() {
    let payload = serde_json::json!({
        "operations": [
            {
                "kind": "apply",
                "resource": {
                    "apiVersion": "batch/v1",
                    "kind": "Job",
                    "metadata": { "name": "hero-image-proxy", "namespace": "media" },
                    "spec": {}
                },
                "ownership": {
                    "mode": "reference",
                    "ref": {
                        "apiVersion": "infra.applik8s.dev/v1alpha1",
                        "kind": "MediaPipeline",
                        "name": "pipeline",
                        "uid": "pipeline-uid"
                    },
                    "blockOwnerDeletion": true
                }
            },
            { "kind": "status", "status": { "phase": "Processing" } }
        ]
    });

    validate_payload_schema("normalizedOperationPlan", &payload).expect("operation plan validates");
    let decoded =
        decode_normalized_operation_plan(payload).expect("operation plan decodes after validation");

    assert_eq!(decoded.operations.len(), 2);
    assert!(matches!(
        decoded.operations[0],
        Operation::Apply {
            ownership: Some(applik8s_runtime_contract::ApplyOwnership::Reference { .. }),
            ..
        }
    ));
    assert!(matches!(decoded.operations[1], Operation::Status { .. }));

    let invalid = serde_json::json!({
        "operations": [{ "kind": "ambientClusterMutation" }]
    });

    assert!(validate_payload_schema("normalizedOperationPlan", &invalid).is_err());

    let extra_operation_field = serde_json::json!({
        "operations": [{
            "kind": "apply",
            "resource": {
                "apiVersion": "batch/v1",
                "kind": "Job",
                "metadata": { "name": "hero-image-proxy" },
                "spec": {}
            },
            "rawClientMutation": true
        }]
    });

    assert!(validate_payload_schema("normalizedOperationPlan", &extra_operation_field).is_err());
}

#[test]
fn generated_capability_request_schema_requires_reconcile_id() {
    let payload = serde_json::json!({
        "capabilityName": "processor",
        "method": "POST",
        "path": "/jobs",
        "body": { "source": "s3://bucket/hero.png" },
        "options": { "idempotencyKey": "reconcile-1:submit" },
        "reconcileId": "reconcile-1"
    });

    validate_payload_schema("capabilityRequest", &payload).expect("capability request validates");

    let missing_reconcile_id = serde_json::json!({
        "capabilityName": "processor",
        "method": "GET",
        "path": "/healthz"
    });

    assert!(validate_payload_schema("capabilityRequest", &missing_reconcile_id).is_err());
}
