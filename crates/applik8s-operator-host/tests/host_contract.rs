use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

use applik8s_operator_host::{
    CapabilitySecretRef, HandlerRoute, KubeRuntimeControllerStrategy, LoadedOperatorBundle,
    OperatorHostError, OperatorHostPaths, OperatorMetrics, ReplayArtifactContext, RetryPolicy,
    RuntimeLeaderElectionConfig, RuntimeReadiness, StatusConvention, controller_framework,
    execute_capability_request, execute_capability_request_with_secret_resolver,
    execute_kubernetes_read_request, host_role, probe_response, reconcile_error_details,
    reconcile_error_details_with_source_map, reconcile_failure_status, reconcile_log_event,
    reconcile_metadata, reconcile_otel_attributes, reconcile_stale_status,
    reconcile_success_status, reconcile_trace_dimensions, replay_artifact, retry_decision,
    retry_exhausted_status, retry_log_event, validate_plan_finalizer_ownership,
    validate_plan_status_subresources, write_replay_artifact,
};
use applik8s_runtime_bridge::{
    AppliedOperationSummary, OperationProgress, RuntimeBridgeError, component_model_engine,
};
use applik8s_runtime_contract::{
    FinalizerOperation, KubernetesEventType, KubernetesObject, NormalizedOperationPlan, ObjectMeta,
    ObjectRef, Operation,
};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use flate2::Compression;
use flate2::write::GzEncoder;
use opentelemetry::KeyValue;

#[test]
fn documents_operator_host_responsibility() {
    assert_eq!(
        host_role(),
        "kube-rs operator host for applik8s WASM handlers"
    );
}

#[tokio::test]
async fn live_kubernetes_list_reads_preserve_objects_selectors_and_pagination() {
    if std::env::var("APPLIK8S_E2E_LIVE").as_deref() != Ok("1") {
        return;
    }
    use k8s_openapi::api::apps::v1::Deployment;
    use k8s_openapi::api::core::v1::Namespace;
    use kube::api::{Api, DeleteParams, PostParams};
    use kube::config::{KubeConfigOptions, Kubeconfig};
    use kube::{Client, Config};

    let _ = rustls::crypto::ring::default_provider().install_default();
    let context = std::env::var("APPLIK8S_E2E_CONTEXT").unwrap_or_else(|_| "orbstack".into());
    let config = Config::from_custom_kubeconfig(
        Kubeconfig::read().expect("read kubeconfig"),
        &KubeConfigOptions {
            context: Some(context),
            ..Default::default()
        },
    )
    .await
    .expect("load selected Kubernetes context");
    let client = Client::try_from(config).expect("create Kubernetes client");
    let namespace = format!("applik8s-list-read-{}", std::process::id());
    let namespaces: Api<Namespace> = Api::all(client.clone());
    let namespace_object: Namespace = serde_json::from_value(serde_json::json!({
        "apiVersion": "v1", "kind": "Namespace", "metadata": { "name": namespace }
    }))
    .expect("namespace object");
    namespaces
        .create(&PostParams::default(), &namespace_object)
        .await
        .expect("create test namespace");

    let deployments: Api<Deployment> = Api::namespaced(client.clone(), &namespace);
    for name in ["worker-a", "worker-b"] {
        let deployment: Deployment = serde_json::from_value(serde_json::json!({
            "apiVersion": "apps/v1", "kind": "Deployment",
            "metadata": { "name": name, "namespace": namespace, "labels": { "app": "list-proof" } },
            "spec": { "replicas": 0, "selector": { "matchLabels": { "app": name } }, "template": { "metadata": { "labels": { "app": name } }, "spec": { "containers": [{ "name": "pause", "image": "registry.k8s.io/pause:3.10" }] } } }
        })).expect("deployment object");
        deployments
            .create(&PostParams::default(), &deployment)
            .await
            .expect("create deployment");
    }

    let manifest = serde_json::json!({ "spec": {
        "readResources": [{ "apiVersion": "apps/v1", "kind": "Deployment", "plural": "deployments", "scope": "Namespaced", "namespaces": [namespace] }],
        "permissions": [{ "apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list"] }]
    }});
    let request = |query: serde_json::Value| {
        serde_json::json!({
        "operation": "list", "apiVersion": "apps/v1", "kind": "Deployment", "plural": "deployments", "scope": "Namespaced", "query": query
    }).to_string()
    };

    let first: serde_json::Value = serde_json::from_str(&execute_kubernetes_read_request(&manifest, client.clone(), &request(serde_json::json!({
        "namespace": namespace, "labels": { "app": "list-proof" }, "limit": 1, "orderBy": "metadata.name"
    }))).await.expect("execute first page")).expect("decode first page response");
    assert_eq!(first["value"]["items"].as_array().map(Vec::len), Some(1));
    let token = first["value"]["continueToken"]
        .as_str()
        .expect("continuation token");
    assert!(!token.is_empty());

    let second: serde_json::Value = serde_json::from_str(&execute_kubernetes_read_request(&manifest, client.clone(), &request(serde_json::json!({
        "namespace": namespace, "labelSelector": { "matchLabels": { "app": "list-proof" } }, "limit": 1, "continueToken": token
    }))).await.expect("execute second page")).expect("decode second page response");
    assert_eq!(second["value"]["items"].as_array().map(Vec::len), Some(1));

    let by_name: serde_json::Value = serde_json::from_str(
        &execute_kubernetes_read_request(
            &manifest,
            client.clone(),
            &request(serde_json::json!({
                "namespace": namespace, "fieldSelector": "metadata.name=worker-b"
            })),
        )
        .await
        .expect("execute field selector"),
    )
    .expect("decode field selector response");
    assert_eq!(by_name["value"]["items"][0]["metadata"]["name"], "worker-b");

    namespaces
        .delete(&namespace, &DeleteParams::default())
        .await
        .expect("delete test namespace");
}

#[test]
fn delegates_reconcile_scheduling_to_kube_runtime_controller_primitives() {
    let strategy = KubeRuntimeControllerStrategy::default();

    assert_eq!(controller_framework(), "kube-runtime::Controller");
    assert_eq!(strategy.framework, "kube-runtime::Controller");
    assert_eq!(strategy.max_concurrent_reconciles, 1);
    assert_eq!(
        strategy.requeue_after(Duration::from_secs(5)),
        kube::runtime::controller::Action::requeue(Duration::from_secs(5))
    );
}

#[test]
fn exposes_health_and_readiness_probe_response_contract() {
    let live = probe_response("/healthz", false);
    let not_ready = probe_response("/readyz", false);
    let ready = probe_response("/readyz", true);
    let missing = probe_response("/missing", true);

    assert_eq!(live.status_code, 200);
    assert_eq!(live.body["status"], "healthy");
    assert_eq!(not_ready.status_code, 503);
    assert_eq!(not_ready.body["status"], "notReady");
    assert_eq!(ready.status_code, 200);
    assert_eq!(ready.body["status"], "ready");
    assert_eq!(missing.status_code, 404);
}

#[test]
fn readiness_transitions_to_not_ready_during_shutdown() {
    let readiness = RuntimeReadiness::new();

    assert!(!readiness.is_ready());
    assert_eq!(readiness.probe_response("/readyz").status_code, 503);

    readiness.mark_ready();
    assert!(readiness.is_ready());
    assert_eq!(readiness.probe_response("/readyz").status_code, 200);

    readiness.begin_shutdown();
    assert!(!readiness.is_ready());
    assert_eq!(readiness.probe_response("/readyz").status_code, 503);
    assert_eq!(readiness.probe_response("/healthz").status_code, 200);
}

#[test]
fn records_otel_metrics_without_requiring_configured_exporter() {
    let metrics = OperatorMetrics::new();
    let route = HandlerRoute {
        handler_id: "ImageJob.reconcile.0".to_string(),
        event: "reconcile".to_string(),
    };

    metrics.record_reconcile_start("image-pipeline", &route);
    metrics.record_reconcile_success(
        "image-pipeline",
        &route,
        0.125,
        &AppliedOperationSummary {
            applied: 1,
            patched: 1,
            deleted: 1,
            status_patched: 1,
            events_recorded: 1,
            finalizers_mutated: 1,
            requeued: 1,
        },
    );
    metrics.record_reconcile_failure("image-pipeline", &route, 0.250, "ApplyFailed");
    metrics.record_retry("image-pipeline", 2, Duration::from_secs(10), false);
}

#[test]
fn builds_unique_reconcile_metadata_without_placeholder_timestamps() {
    let owner = image_job_ref();

    let (first_id, first_started_at) = reconcile_metadata(&owner);
    let (second_id, second_started_at) = reconcile_metadata(&owner);

    assert!(first_id.starts_with("ImageJob-media-hero-image-"));
    assert!(second_id.starts_with("ImageJob-media-hero-image-"));
    assert_ne!(first_id, "ImageJob-hero-image");
    assert_ne!(first_started_at, "1970-01-01T00:00:00Z");
    assert!(first_started_at.ends_with('Z'));
    assert!(second_started_at.ends_with('Z'));
    assert_ne!(first_id, second_id);
}

#[tokio::test]
async fn executes_live_auth_none_http_capability_requests() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener binds");
    let addr = listener.local_addr().expect("test listener has addr");
    let app = axum::Router::new().route(
        "/healthz",
        axum::routing::get(|| async { axum::Json(serde_json::json!({ "ready": true })) }),
    );
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let manifest = live_http_capability_manifest(&format!("http://{addr}"));

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/healthz",
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], true);
    assert_eq!(response["value"]["ready"], true);
    server.abort();
}

#[tokio::test]
async fn rejects_live_http_mutations_without_idempotency_key() {
    let manifest = live_http_capability_manifest("https://processor.example.test");

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "POST",
            "path": "/jobs",
            "body": { "source": "s3://bucket/hero.png" },
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], false);
    assert!(
        response["error"]["message"]
            .as_str()
            .expect("message is string")
            .contains("idempotencyKey")
    );
}

#[tokio::test]
async fn sends_idempotency_key_header_for_live_http_mutations() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener binds");
    let addr = listener.local_addr().expect("test listener has addr");
    let app = axum::Router::new().route(
        "/jobs",
        axum::routing::post(|headers: axum::http::HeaderMap| async move {
            let idempotency_key = headers
                .get("idempotency-key")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string();
            axum::Json(serde_json::json!({ "idempotencyKey": idempotency_key }))
        }),
    );
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let manifest = live_http_capability_manifest(&format!("http://{addr}"));

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "POST",
            "path": "/jobs",
            "body": { "source": "s3://bucket/hero.png" },
            "options": { "idempotencyKey": "job-123" },
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], true);
    assert_eq!(response["value"]["idempotencyKey"], "job-123");
    server.abort();
}

#[tokio::test]
async fn retries_live_http_capability_transient_failures() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener binds");
    let addr = listener.local_addr().expect("test listener has addr");
    let attempts = Arc::new(AtomicUsize::new(0));
    let route_attempts = Arc::clone(&attempts);
    let app = axum::Router::new().route(
        "/flaky",
        axum::routing::get(move || {
            let route_attempts = Arc::clone(&route_attempts);
            async move {
                let attempt = route_attempts.fetch_add(1, Ordering::SeqCst) + 1;
                if attempt == 1 {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        axum::Json(serde_json::json!({ "error": "try again" })),
                    )
                        .into_response();
                }
                axum::Json(serde_json::json!({ "attempt": attempt })).into_response()
            }
        }),
    );
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let mut manifest = live_http_capability_manifest(&format!("http://{addr}"));
    manifest["spec"]["capabilities"]["processor"]["policy"]["retry"] =
        serde_json::json!({ "maxAttempts": 2, "backoffMs": 1, "maxBackoffMs": 1 });

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/flaky",
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], true);
    assert_eq!(response["value"]["attempt"], 2);
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    server.abort();
}

#[tokio::test]
async fn rejects_invalid_live_http_capability_retry_policy() {
    let mut manifest = live_http_capability_manifest("https://processor.example.test");
    manifest["spec"]["capabilities"]["processor"]["policy"]["retry"] =
        serde_json::json!({ "maxAttempts": 6, "backoffMs": 1, "maxBackoffMs": 1 });

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/healthz",
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], false);
    assert!(
        response["error"]["message"]
            .as_str()
            .expect("message is string")
            .contains("retry.maxAttempts")
    );
}

#[tokio::test]
async fn rejects_invalid_live_http_capability_timeout_policy_before_request() {
    let mut manifest = live_http_capability_manifest("https://processor.example.test");
    manifest["spec"]["capabilities"]["processor"]["policy"]["timeoutMs"] = serde_json::json!(10);

    let too_large = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/healthz",
            "options": { "timeoutMs": 20 },
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let too_large: serde_json::Value = serde_json::from_str(&too_large).expect("response is JSON");

    assert_eq!(too_large["ok"], false);
    assert!(
        too_large["error"]["message"]
            .as_str()
            .expect("message is string")
            .contains("exceeds descriptor timeoutMs")
    );

    let zero = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/healthz",
            "options": { "timeoutMs": 0 },
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let zero: serde_json::Value = serde_json::from_str(&zero).expect("response is JSON");

    assert_eq!(zero["ok"], false);
    assert!(
        zero["error"]["message"]
            .as_str()
            .expect("message is string")
            .contains("timeoutMs must be between 1 and 30000")
    );
}

#[tokio::test]
async fn rejects_sensitive_live_http_capability_request_headers() {
    let manifest = live_http_capability_manifest("https://processor.example.test");

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/healthz",
            "options": { "headers": { "Authorization": "Bearer secret" } },
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], false);
    assert!(
        response["error"]["message"]
            .as_str()
            .expect("message is string")
            .contains("Authorization")
    );
}

#[tokio::test]
async fn injects_secret_ref_bearer_auth_for_live_http_capabilities() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test listener binds");
    let addr = listener.local_addr().expect("test listener has addr");
    let app = axum::Router::new().route(
        "/secure",
        axum::routing::get(|headers: axum::http::HeaderMap| async move {
            let authorization = headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string();
            axum::Json(serde_json::json!({ "authorization": authorization }))
        }),
    );
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let mut manifest = live_http_capability_manifest(&format!("http://{addr}"));
    manifest["spec"]["capabilities"]["processor"]["auth"] = serde_json::json!({
        "type": "secretRef",
        "secretRef": { "name": "processor-token", "namespace": "media", "key": "token" }
    });
    let secret_resolver = Arc::new(|secret_ref: CapabilitySecretRef| {
        Box::pin(async move {
            assert_eq!(secret_ref.name, "processor-token");
            assert_eq!(secret_ref.namespace.as_deref(), Some("media"));
            assert_eq!(secret_ref.key, "token");
            Ok("secret-token".to_string())
        }) as applik8s_operator_host::CapabilitySecretResolverFuture
    });

    let response = execute_capability_request_with_secret_resolver(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/secure",
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
        Some(secret_resolver),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], true);
    assert_eq!(response["value"]["authorization"], "Bearer secret-token");
    server.abort();
}

#[tokio::test]
async fn rejects_secret_ref_live_http_capability_without_secret_access() {
    let mut manifest = live_http_capability_manifest("https://processor.example.test");
    manifest["spec"]["capabilities"]["processor"]["auth"] = serde_json::json!({
        "type": "secretRef",
        "secretRef": { "name": "processor-token", "namespace": "media", "key": "token" }
    });

    let response = execute_capability_request(
        &manifest,
        &serde_json::json!({
            "capabilityName": "processor",
            "method": "GET",
            "path": "/healthz",
            "reconcileId": "ImageJob-hero-image"
        })
        .to_string(),
    )
    .await
    .expect("capability import returns response JSON");
    let response: serde_json::Value = serde_json::from_str(&response).expect("response is JSON");

    assert_eq!(response["ok"], false);
    assert!(
        response["error"]["message"]
            .as_str()
            .expect("message is string")
            .contains("requires Kubernetes Secret access")
    );
}

#[test]
fn computes_bounded_exponential_retry_decisions() {
    let policy = RetryPolicy {
        base_delay: Duration::from_secs(5),
        max_delay: Duration::from_secs(20),
        max_retries: Some(3),
    };

    assert_eq!(
        retry_decision(&policy, 1),
        applik8s_operator_host::RetryDecision {
            attempt: 1,
            delay: Duration::from_secs(5),
            exhausted: false,
        }
    );
    assert_eq!(
        retry_decision(&policy, 2),
        applik8s_operator_host::RetryDecision {
            attempt: 2,
            delay: Duration::from_secs(10),
            exhausted: false,
        }
    );
    assert_eq!(
        retry_decision(&policy, 3),
        applik8s_operator_host::RetryDecision {
            attempt: 3,
            delay: Duration::from_secs(20),
            exhausted: false,
        }
    );
    assert_eq!(
        retry_decision(&policy, 4),
        applik8s_operator_host::RetryDecision {
            attempt: 4,
            delay: Duration::from_secs(20),
            exhausted: true,
        }
    );
}

#[test]
fn emits_structured_retry_log_events() {
    let event = retry_log_event(
        "image-pipeline",
        "media.applik8s.dev/v1alpha1/ImageJob media/hero-image",
        &applik8s_operator_host::RetryDecision {
            attempt: 2,
            delay: Duration::from_secs(10),
            exhausted: false,
        },
        "runtime bridge failed: handler returned error",
    );

    assert_eq!(event["level"], "info");
    assert_eq!(event["message"], "reconcile retry scheduled");
    assert_eq!(event["operatorName"], "image-pipeline");
    assert_eq!(event["retry"]["attempt"], 2);
    assert_eq!(event["retry"]["delayMs"], 10_000);
    assert_eq!(event["retry"]["exhausted"], false);
    assert_eq!(event["handlerAbi"], "applik8s.handler/v1alpha1");

    let dimensions = reconcile_trace_dimensions(&event);
    assert_eq!(dimensions["operatorName"], "image-pipeline");
    assert_eq!(
        dimensions["objectKey"],
        "media.applik8s.dev/v1alpha1/ImageJob media/hero-image"
    );
    assert_eq!(
        dimensions["failureReason"],
        "runtime bridge failed: handler returned error"
    );
    assert_eq!(dimensions["retryAttempt"], 2);
    assert_eq!(dimensions["retryDelayMs"], 10_000);
    assert_eq!(dimensions["retryExhausted"], false);

    let attributes = reconcile_otel_attributes(&event);
    assert!(attributes.contains(&KeyValue::new("applik8s.operator.name", "image-pipeline")));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.object.key",
        "media.applik8s.dev/v1alpha1/ImageJob media/hero-image"
    )));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.failure.reason",
        "runtime bridge failed: handler returned error"
    )));
    assert!(attributes.contains(&KeyValue::new("applik8s.retry.attempt", 2_i64)));
    assert!(attributes.contains(&KeyValue::new("applik8s.retry.delay_ms", 10_000_i64)));
    assert!(attributes.contains(&KeyValue::new("applik8s.retry.exhausted", false)));
}

#[test]
fn builds_retry_exhausted_status_condition() {
    let status = retry_exhausted_status(
        &serde_json::json!({ "metadata": { "generation": 9 } }),
        &StatusConvention::default(),
        "runtime bridge failed: operation 0 apply failed",
        4,
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status["observedGeneration"], 9);
    assert_eq!(status["conditions"][0]["type"], "Ready");
    assert_eq!(status["conditions"][0]["status"], "False");
    assert_eq!(status["conditions"][0]["reason"], "RetryExhausted");
    assert_eq!(status["conditions"][0]["observedGeneration"], 9);
    assert!(
        status["conditions"][0]["message"]
            .as_str()
            .expect("message is string")
            .contains("Retry exhausted after 4 failed attempt(s)")
    );
}

fn live_http_capability_manifest(endpoint: &str) -> serde_json::Value {
    serde_json::json!({
        "apiVersion": "applik8s.operator/v1alpha1",
        "kind": "OperatorBundle",
        "metadata": { "name": "capability-pipeline" },
        "spec": {
            "capabilities": {
                "processor": {
                    "name": "processor",
                    "kind": "http",
                    "endpoint": endpoint,
                    "auth": { "type": "none" },
                    "policy": { "timeoutMs": 2000, "failureMode": "rejectPromiseWithApplik8sError" },
                    "execution": {
                        "liveExecution": "hostProtocol",
                        "protocol": "applik8s.capability/v1alpha1",
                        "audit": { "recordRequests": true, "recordResponses": true, "includePayloads": false },
                        "redaction": { "requestBody": "redacted", "responseBody": "redacted", "headers": "redacted", "errors": "publicMessageOnly" },
                        "idempotency": { "requiredForMutations": true, "keySource": "handlerProvided" }
                    }
                }
            }
        }
    })
}

#[test]
fn emits_structured_reconcile_log_events_with_operation_summary() {
    let event = reconcile_log_event(
        "info",
        "reconcile succeeded",
        "image-pipeline",
        &HandlerRoute {
            handler_id: "ImageJob.created.0".to_string(),
            event: "created".to_string(),
        },
        &ObjectRef {
            api_version: "media.applik8s.dev/v1alpha1".to_string(),
            kind: "ImageJob".to_string(),
            name: "hero-image".to_string(),
            namespace: Some("media".to_string()),
            uid: Some("uid-1".to_string()),
            resource_version: Some("42".to_string()),
        },
        "ImageJob-hero-image",
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0.1.0",
        Some(&AppliedOperationSummary {
            applied: 1,
            patched: 2,
            deleted: 3,
            status_patched: 4,
            events_recorded: 5,
            finalizers_mutated: 6,
            requeued: 7,
        }),
        None,
        None,
    );

    assert_eq!(event["level"], "info");
    assert_eq!(event["message"], "reconcile succeeded");
    assert_eq!(event["operatorName"], "image-pipeline");
    assert_eq!(event["handlerId"], "ImageJob.created.0");
    assert_eq!(event["event"], "created");
    assert_eq!(event["objectRef"]["name"], "hero-image");
    assert_eq!(event["reconcileId"], "ImageJob-hero-image");
    assert_eq!(event["handlerAbi"], "applik8s.handler/v1alpha1");
    assert_eq!(event["operationSummary"]["applied"], 1);
    assert_eq!(event["operationSummary"]["statusPatched"], 4);
    assert_eq!(event["operationSummary"]["finalizersMutated"], 6);
    assert_eq!(event["operationSummary"]["requeued"], 7);

    let dimensions = reconcile_trace_dimensions(&event);
    assert_eq!(dimensions["operatorName"], "image-pipeline");
    assert_eq!(dimensions["handlerId"], "ImageJob.created.0");
    assert_eq!(dimensions["handlerEvent"], "created");
    assert_eq!(dimensions["reconcileId"], "ImageJob-hero-image");
    assert_eq!(
        dimensions["bundleDigest"],
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert_eq!(dimensions["runtimeVersion"], "0.1.0");
    assert_eq!(dimensions["handlerAbi"], "applik8s.handler/v1alpha1");
    assert_eq!(
        dimensions["resourceApiVersion"],
        "media.applik8s.dev/v1alpha1"
    );
    assert_eq!(dimensions["resourceKind"], "ImageJob");
    assert_eq!(dimensions["resourceNamespace"], "media");
    assert_eq!(dimensions["resourceName"], "hero-image");
    assert_eq!(dimensions["operationsApplied"], 1);
    assert_eq!(dimensions["operationsPatched"], 2);
    assert_eq!(dimensions["operationsDeleted"], 3);
    assert_eq!(dimensions["operationsStatusPatched"], 4);
    assert_eq!(dimensions["operationsEventsRecorded"], 5);
    assert_eq!(dimensions["operationsFinalizersMutated"], 6);
    assert_eq!(dimensions["operationsRequeued"], 7);

    let attributes = reconcile_otel_attributes(&event);
    assert!(attributes.contains(&KeyValue::new("applik8s.operator.name", "image-pipeline")));
    assert!(attributes.contains(&KeyValue::new("applik8s.handler.id", "ImageJob.created.0")));
    assert!(attributes.contains(&KeyValue::new("applik8s.handler.event", "created")));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.reconcile.id",
        "ImageJob-hero-image"
    )));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.bundle.digest",
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )));
    assert!(attributes.contains(&KeyValue::new("applik8s.runtime.version", "0.1.0")));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.handler.abi",
        "applik8s.handler/v1alpha1"
    )));
    assert!(attributes.contains(&KeyValue::new(
        "k8s.resource.api_version",
        "media.applik8s.dev/v1alpha1"
    )));
    assert!(attributes.contains(&KeyValue::new("k8s.resource.kind", "ImageJob")));
    assert!(attributes.contains(&KeyValue::new("k8s.namespace.name", "media")));
    assert!(attributes.contains(&KeyValue::new("k8s.resource.name", "hero-image")));
    assert!(attributes.contains(&KeyValue::new("applik8s.operations.applied", 1_i64)));
    assert!(attributes.contains(&KeyValue::new("applik8s.operations.patched", 2_i64)));
    assert!(attributes.contains(&KeyValue::new("applik8s.operations.deleted", 3_i64)));
    assert!(attributes.contains(&KeyValue::new("applik8s.operations.status_patched", 4_i64)));
    assert!(attributes.contains(&KeyValue::new("applik8s.operations.events_recorded", 5_i64)));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.operations.finalizers_mutated",
        6_i64
    )));
    assert!(attributes.contains(&KeyValue::new("applik8s.operations.requeued", 7_i64)));
}

#[test]
fn emits_structured_operation_failure_details() {
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed {
        index: 2,
        kind: "apply".to_string(),
        target: "v1/ConfigMap media/hero-image-child".to_string(),
        field_manager: Some("applik8s".to_string()),
        progress: OperationProgress {
            completed_operations: 2,
            applied: 1,
            patched: 1,
            ..OperationProgress::default()
        },
        cause: "kubernetes API operation failed: conflict".to_string(),
    });
    let event = reconcile_log_event(
        "error",
        "reconcile failed",
        "image-pipeline",
        &HandlerRoute {
            handler_id: "ImageJob.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        },
        &ObjectRef {
            api_version: "media.applik8s.dev/v1alpha1".to_string(),
            kind: "ImageJob".to_string(),
            name: "hero-image".to_string(),
            namespace: Some("media".to_string()),
            uid: Some("uid-1".to_string()),
            resource_version: Some("42".to_string()),
        },
        "ImageJob-hero-image",
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0.1.0",
        None,
        Some(&error.to_string()),
        reconcile_error_details(&error),
    );

    assert_eq!(event["level"], "error");
    assert_eq!(event["message"], "reconcile failed");
    assert_eq!(event["handlerId"], "ImageJob.reconcile.0");
    assert_eq!(event["objectRef"]["name"], "hero-image");
    assert_eq!(event["errorDetails"]["type"], "operationFailed");
    assert_eq!(event["errorDetails"]["partialEffects"], true);
    assert_eq!(event["errorDetails"]["progress"]["completedOperations"], 2);
    assert_eq!(event["errorDetails"]["progress"]["applied"], 1);
    assert_eq!(event["errorDetails"]["progress"]["patched"], 1);
    assert_eq!(event["errorDetails"]["operation"]["index"], 2);
    assert_eq!(event["errorDetails"]["operation"]["kind"], "apply");
    assert_eq!(
        event["errorDetails"]["operation"]["target"],
        "v1/ConfigMap media/hero-image-child"
    );
    assert_eq!(
        event["errorDetails"]["operation"]["fieldManager"],
        "applik8s"
    );
    assert_eq!(
        event["errorDetails"]["cause"],
        "kubernetes API operation failed: conflict"
    );

    let dimensions = reconcile_trace_dimensions(&event);
    assert_eq!(dimensions["failureReason"], error.to_string());
    assert_eq!(dimensions["operationKind"], "apply");
    assert_eq!(dimensions["operationIndex"], 2);

    let attributes = reconcile_otel_attributes(&event);
    assert!(attributes.contains(&KeyValue::new("applik8s.failure.type", "operationFailed")));
    assert!(attributes.contains(&KeyValue::new("applik8s.failure.reason", error.to_string())));
    assert!(attributes.contains(&KeyValue::new("applik8s.operation.kind", "apply")));
    assert!(attributes.contains(&KeyValue::new("applik8s.operation.index", 2_i64)));
    assert!(attributes.contains(&KeyValue::new(
        "applik8s.operation.target",
        "v1/ConfigMap media/hero-image-child"
    )));
}

#[test]
fn emits_structured_handler_timeout_details() {
    let error =
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerTimedOut { timeout_ms: 30000 });

    let details = reconcile_error_details(&error).expect("timeout details");

    assert_eq!(details["type"], "handlerTimedOut");
    assert_eq!(details["timeoutMs"], 30000);
}

#[test]
fn emits_structured_handler_failure_stack_details() {
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerFailed(
        "image processor exploded\n    at failFromApplicationSource (src/handler.ts:2:9)\n    at handle (src/handler.ts:6:3)".to_string(),
    ));

    let details = reconcile_error_details(&error).expect("handler details");

    assert_eq!(details["type"], "handlerFailed");
    assert_eq!(details["message"], "image processor exploded");
    assert_eq!(details["sourceMapping"]["status"], "stackFramesPreserved");
    assert_eq!(
        details["sourceMapping"]["frames"][0],
        "at failFromApplicationSource (src/handler.ts:2:9)"
    );
}

#[test]
fn maps_handler_failure_stack_frames_with_source_map_artifact() {
    let directory =
        std::env::temp_dir().join(format!("applik8s-source-map-{}", std::process::id()));
    fs::create_dir_all(&directory).expect("temp source map dir");
    let source_map_path = directory.join("handler.js.map");
    fs::write(
        &source_map_path,
        serde_json::json!({
            "version": 3,
            "file": "handler.js",
            "sources": ["src/handler.ts"],
            "sourcesContent": [null],
            "names": ["failFromApplicationSource"],
            "mappings": "AAAAA"
        })
        .to_string(),
    )
    .expect("source map writes");
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerFailed(
        "source mapped boom\n    at failFromApplicationSource (/handler/handler.js:1:1)"
            .to_string(),
    ));

    let details = reconcile_error_details_with_source_map(&error, Some(&source_map_path))
        .expect("handler details");

    assert_eq!(details["sourceMapping"]["status"], "mapped");
    assert_eq!(
        details["sourceMapping"]["mappedFrames"][0]["source"],
        "src/handler.ts"
    );
    assert_eq!(details["sourceMapping"]["mappedFrames"][0]["line"], 1);
    assert_eq!(
        details["sourceMapping"]["mappedFrames"][0]["name"],
        "failFromApplicationSource"
    );
    let _ = fs::remove_dir_all(directory);
}

#[test]
fn redacts_handler_failure_stacks_in_metadata_only_replay_artifacts() {
    let route = HandlerRoute {
        handler_id: "ImageJob.reconcile.0".to_string(),
        event: "reconcile".to_string(),
    };
    let owner = image_job_ref();
    let input = serde_json::json!({
        "abiVersion": "applik8s.handler/v1alpha1",
        "handlerId": "ImageJob.reconcile.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "metadata": { "name": "hero-image", "namespace": "media" }
        },
        "runtime": {
            "operatorName": "image-pipeline",
            "reconcileId": "ImageJob-hero-image",
            "bundleDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "runtimeVersion": "0.1.0",
            "startedAt": "1970-01-01T00:00:00Z"
        }
    });
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerFailed(
        "secret failure detail\n    at failFromApplicationSource (src/handler.ts:2:9)".to_string(),
    ));

    let artifact = replay_artifact(&ReplayArtifactContext {
        operator_name: "image-pipeline",
        handler_route: &route,
        owner: &owner,
        reconcile_id: "ImageJob-hero-image",
        bundle_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runtime_version: "0.1.0",
        phase: "handlerInvocation",
        error: &error,
        input: &input,
        plan: None,
        bundle_artifacts: None,
        include_payloads: false,
        created_at: "2026-06-22T00:00:00Z",
    });

    assert_eq!(artifact["failure"]["details"]["type"], "handlerFailed");
    assert_eq!(artifact["failure"]["details"]["message"]["redacted"], true);
    assert_eq!(
        artifact["failure"]["details"]["sourceMapping"]["frames"]["redacted"],
        true
    );
    assert_eq!(
        artifact["failure"]["details"]["sourceMapping"]["mappedFrames"]["redacted"],
        true
    );
    assert_eq!(
        artifact["failure"]["details"]["sourceMapping"]["frameCount"],
        1
    );
}

#[test]
fn builds_redacted_replay_artifacts_by_default() {
    let route = HandlerRoute {
        handler_id: "ImageJob.reconcile.0".to_string(),
        event: "reconcile".to_string(),
    };
    let owner = image_job_ref();
    let input = serde_json::json!({
        "abiVersion": "applik8s.handler/v1alpha1",
        "handlerId": "ImageJob.reconcile.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "metadata": {
                "name": "hero-image",
                "namespace": "media",
                "uid": "uid-1",
                "resourceVersion": "42",
                "generation": 7,
                "annotations": { "secret.example/token": "s3cr3t" }
            },
            "spec": { "token": "s3cr3t" },
            "status": { "message": "contains s3cr3t" }
        },
        "runtime": {
            "operatorName": "image-pipeline",
            "reconcileId": "ImageJob-hero-image",
            "bundleDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "runtimeVersion": "0.1.0",
            "startedAt": "1970-01-01T00:00:00Z"
        }
    });
    let mut child = k8s_object("v1", "ConfigMap", "hero-child", Some("media"));
    child.spec = Some(serde_json::json!({ "token": "s3cr3t" }));
    let plan = NormalizedOperationPlan {
        operations: vec![
            Operation::Apply {
                resource: child,
                field_manager: Some("applik8s".to_string()),
                force: Some(false),
                ownership: None,
                connection: None,
                authority: None,
            },
            Operation::Status {
                status: serde_json::json!({ "message": "contains s3cr3t" }),
                ref_: None,
            },
        ],
        diagnostics: Some(vec![]),
    };
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed {
        index: 1,
        kind: "status".to_string(),
        target: "media.applik8s.dev/v1alpha1/ImageJob media/hero-image".to_string(),
        field_manager: Some("applik8s".to_string()),
        progress: OperationProgress {
            completed_operations: 1,
            applied: 1,
            ..OperationProgress::default()
        },
        cause: "kubernetes API operation failed: conflict with s3cr3t".to_string(),
    });

    let artifact = replay_artifact(&ReplayArtifactContext {
        operator_name: "image-pipeline",
        handler_route: &route,
        owner: &owner,
        reconcile_id: "ImageJob-hero-image",
        bundle_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runtime_version: "0.1.0",
        phase: "operationApplication",
        error: &error,
        input: &input,
        plan: Some(&plan),
        bundle_artifacts: Some(&serde_json::json!([
            { "kind": "javascript-bundle", "path": "bundle/handler.js", "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
            { "kind": "javascript-source-map", "path": "bundle/handler.js.map", "digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
            { "kind": "esbuild-metafile", "path": "bundle/handler.esbuild-meta.json", "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333" },
            { "kind": "wasm-component", "path": "wasm/handler.wasm", "digest": "sha256:4444444444444444444444444444444444444444444444444444444444444444" }
        ])),
        include_payloads: false,
        created_at: "2026-06-21T00:00:00Z",
    });

    assert_eq!(artifact["kind"], "ReplayArtifact");
    assert_eq!(artifact["metadata"]["redaction"]["policy"], "metadata-only");
    assert_eq!(artifact["runtime"]["reconcileId"], "ImageJob-hero-image");
    assert_eq!(artifact["failure"]["phase"], "operationApplication");
    assert_eq!(artifact["failure"]["reason"], "StatusPatchFailed");
    assert_eq!(artifact["failure"]["details"]["partialEffects"], true);
    assert_eq!(
        artifact["failure"]["details"]["progress"]["completedOperations"],
        1
    );
    assert_eq!(artifact["failure"]["details"]["progress"]["applied"], 1);
    assert_eq!(artifact["failure"]["details"]["cause"]["redacted"], true);
    assert_eq!(artifact["input"]["object"]["spec"]["redacted"], true);
    assert_eq!(artifact["input"]["object"]["status"]["redacted"], true);
    assert_eq!(
        artifact["input"]["object"]["metadata"]["annotations"]["redacted"],
        true
    );
    assert_eq!(
        artifact["plan"]["operations"][0]["resource"]["spec"]["redacted"],
        true
    );
    assert_eq!(
        artifact["plan"]["operations"][1]["status"]["redacted"],
        true
    );
    assert_eq!(
        artifact["debugArtifacts"]["sourceMapping"]["status"],
        "artifactIdentityOnly"
    );
    assert_eq!(
        artifact["debugArtifacts"]["sourceMapping"]["artifacts"]
            .as_array()
            .expect("debug artifacts")
            .len(),
        3
    );
    assert!(
        artifact["debugArtifacts"]["sourceMapping"]["artifacts"]
            .to_string()
            .contains("javascript-source-map")
    );
    assert!(
        !artifact["debugArtifacts"]["sourceMapping"]["artifacts"]
            .to_string()
            .contains("wasm-component")
    );
    assert!(!artifact.to_string().contains("s3cr3t"));
}

#[test]
fn can_write_replay_artifact_files_with_safe_names() {
    let route = HandlerRoute {
        handler_id: "ImageJob.reconcile.0".to_string(),
        event: "reconcile".to_string(),
    };
    let owner = image_job_ref();
    let input = serde_json::json!({
        "abiVersion": "applik8s.handler/v1alpha1",
        "handlerId": "ImageJob.reconcile.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "metadata": { "name": "hero-image", "namespace": "media" }
        },
        "runtime": { "operatorName": "image-pipeline", "reconcileId": "ImageJob-hero-image" }
    });
    let error =
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerTimedOut { timeout_ms: 30000 });
    let artifact = replay_artifact(&ReplayArtifactContext {
        operator_name: "image-pipeline",
        handler_route: &route,
        owner: &owner,
        reconcile_id: "ImageJob/hero-image",
        bundle_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runtime_version: "0.1.0",
        phase: "handlerInvocation",
        error: &error,
        input: &input,
        plan: None,
        bundle_artifacts: None,
        include_payloads: false,
        created_at: "2026-06-21T00:00:00Z",
    });
    let directory =
        std::env::temp_dir().join(format!("applik8s-replay-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);

    let path = write_replay_artifact(&directory, &artifact).expect("artifact writes");
    let persisted: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("artifact can be read"))
            .expect("artifact remains JSON");

    assert!(path.starts_with(&directory));
    assert!(!path.file_name().unwrap().to_string_lossy().contains('/'));
    assert_eq!(persisted["failure"]["reason"], "HandlerTimedOut");
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn accepts_operation_plans_with_declared_rbac_permissions() {
    let bundle = rbac_bundle(vec![
        serde_json::json!({ "apiGroups": [""], "resources": ["configmaps"], "verbs": ["patch"] }),
        serde_json::json!({ "apiGroups": [""], "resources": ["events"], "verbs": ["create"] }),
        serde_json::json!({ "apiGroups": ["media.applik8s.dev"], "resources": ["imagejobs/status", "imagejobs/finalizers"], "verbs": ["patch"] }),
    ]);
    let owner = ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero".to_string(),
        namespace: Some("media".to_string()),
        uid: None,
        resource_version: None,
    };
    let plan = NormalizedOperationPlan {
        operations: vec![
            Operation::Apply {
                resource: k8s_object("v1", "ConfigMap", "hero-child", Some("media")),
                field_manager: None,
                force: None,
                ownership: None,
                connection: None,
                authority: None,
            },
            Operation::Status {
                status: serde_json::json!({ "phase": "Ready" }),
                ref_: None,
            },
            Operation::Finalizer {
                operation: FinalizerOperation::Remove,
                finalizer: "media.applik8s.dev/imagejob".to_string(),
            },
            Operation::Event {
                event_type: KubernetesEventType::Normal,
                reason: "Reconciled".to_string(),
                message: "Done".to_string(),
                regarding: None,
            },
        ],
        diagnostics: None,
    };

    applik8s_operator_host::validate_plan_rbac(&bundle, &owner, &plan)
        .expect("declared permissions allow plan");
}

#[test]
fn remote_mutations_do_not_require_management_cluster_resource_rbac() {
    let bundle = rbac_bundle(vec![]);
    let owner = ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero".to_string(),
        namespace: Some("media".to_string()),
        uid: Some("source-uid".to_string()),
        resource_version: Some("10".to_string()),
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Apply {
            resource: k8s_object("v1", "ConfigMap", "hero-child", Some("destination")),
            field_manager: None,
            force: None,
            ownership: Some(applik8s_runtime_contract::ApplyOwnership::None),
            connection: Some("destination".to_string()),
            authority: Some(
                applik8s_runtime_contract::RemoteMutationAuthority::Managed {
                    identity: "imagejob/hero/config".to_string(),
                    source_uid: "source-uid".to_string(),
                },
            ),
        }],
        diagnostics: None,
    };

    applik8s_operator_host::validate_plan_rbac(&bundle, &owner, &plan)
        .expect("remote permission envelopes must not become management-cluster RBAC");
}

#[tokio::test]
async fn rejects_kubernetes_read_for_undeclared_resource_before_live_api() {
    let bundle = rbac_bundle(vec![serde_json::json!({
        "apiGroups": ["demo.applik8s.dev"],
        "resources": ["guestbookentries"],
        "verbs": ["list"]
    })]);

    let response = kubernetes_read_error(
        &bundle.manifest,
        serde_json::json!({
            "operation": "list",
            "apiVersion": "demo.applik8s.dev/v1alpha1",
            "kind": "GuestBookEntry",
            "plural": "guestbookentries",
            "scope": "Namespaced",
            "query": { "namespace": "demo" }
        }),
    )
    .await;

    assert_eq!(response["error"]["code"], "KUBERNETES_READ_DENIED");
    assert!(
        response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("not declared")
    );
}

#[tokio::test]
async fn authorizes_only_declared_external_read_resource_namespaces() {
    let manifest = serde_json::json!({
        "metadata": { "name": "external-reader", "annotations": { "applik8s.dev/namespace": "operators" } },
        "spec": {
            "permissions": [{ "apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list"] }],
            "ownedCrds": [],
            "readResources": [{
                "apiVersion": "apps/v1",
                "kind": "Deployment",
                "plural": "deployments",
                "scope": "Namespaced",
                "namespaces": ["destination"]
            }]
        }
    });
    let denied = kubernetes_read_error(
        &manifest,
        serde_json::json!({
            "operation": "list",
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "plural": "deployments",
            "scope": "Namespaced",
            "query": { "namespace": "other", "limit": 10, "continueToken": "next", "fieldSelector": "metadata.name=worker" }
        }),
    )
    .await;
    assert!(
        denied["error"]["message"]
            .as_str()
            .unwrap()
            .contains("not declared for namespace other")
    );

    let allowed = kubernetes_read_error(
        &manifest,
        serde_json::json!({
            "operation": "list",
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "plural": "deployments",
            "scope": "Namespaced",
            "query": { "namespace": "destination", "limit": 10, "continueToken": "next", "fieldSelector": "metadata.name=worker" }
        }),
    )
    .await;
    assert!(
        allowed["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Kubernetes list read failed")
    );
}

#[tokio::test]
async fn rejects_kubernetes_read_without_declared_rbac_before_live_api() {
    let bundle = rbac_bundle(vec![]);

    let response = kubernetes_read_error(
        &bundle.manifest,
        serde_json::json!({
            "operation": "list",
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "plural": "imagejobs",
            "scope": "Namespaced",
            "query": { "namespace": "media" }
        }),
    )
    .await;

    assert!(response["error"]["message"].as_str().unwrap().contains(
        "Kubernetes read requires undeclared RBAC permission: media.applik8s.dev/imagejobs/list."
    ));
}

#[tokio::test]
async fn rejects_namespaced_kubernetes_read_without_namespace_before_live_api() {
    let bundle = rbac_bundle(vec![serde_json::json!({
        "apiGroups": ["media.applik8s.dev"],
        "resources": ["imagejobs"],
        "verbs": ["get"]
    })]);

    let response = kubernetes_read_error(
        &bundle.manifest,
        serde_json::json!({
            "operation": "get",
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "plural": "imagejobs",
            "scope": "Namespaced",
            "query": { "name": "hero" }
        }),
    )
    .await;

    assert!(response["error"]["message"].as_str().unwrap().contains(
        "Kubernetes read for namespaced resource media.applik8s.dev/v1alpha1/ImageJob requires query.namespace."
    ));
}

#[tokio::test]
async fn rejects_cluster_kubernetes_read_with_namespace_before_live_api() {
    let bundle = rbac_bundle(vec![serde_json::json!({
        "apiGroups": ["media.applik8s.dev"],
        "resources": ["imagejobs"],
        "verbs": ["get"]
    })]);

    let response = kubernetes_read_error(
        &bundle.manifest,
        serde_json::json!({
            "operation": "get",
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "plural": "imagejobs",
            "scope": "Cluster",
            "query": { "name": "hero", "namespace": "media" }
        }),
    )
    .await;

    assert!(response["error"]["message"].as_str().unwrap().contains(
        "Kubernetes read for cluster-scoped resource media.applik8s.dev/v1alpha1/ImageJob must not set query.namespace."
    ));
}

#[tokio::test]
async fn rejects_unlowerable_kubernetes_read_label_selectors_before_live_api() {
    let bundle = rbac_bundle(vec![serde_json::json!({
        "apiGroups": ["media.applik8s.dev"],
        "resources": ["imagejobs"],
        "verbs": ["list"]
    })]);

    let response = kubernetes_read_error(
        &bundle.manifest,
        serde_json::json!({
            "operation": "list",
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "plural": "imagejobs",
            "scope": "Namespaced",
            "query": {
                "namespace": "media",
                "labelSelector": { "matchExpressions": [{ "key": "app", "operator": "Contains", "values": ["demo"] }] }
            }
        }),
    )
    .await;

    assert!(response["error"]["message"].as_str().unwrap().contains(
        "Kubernetes read query.labelSelector must lower to a Kubernetes label selector."
    ));
}

#[test]
fn accepts_declared_finalizer_mutations_before_effects() {
    let bundle = declared_finalizer_routing_bundle();
    let route = HandlerRoute {
        handler_id: "ImageJob.finalize.owned".to_string(),
        event: "finalize".to_string(),
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Finalizer {
            operation: FinalizerOperation::Remove,
            finalizer: "media.applik8s.dev/imagejob".to_string(),
        }],
        diagnostics: None,
    };

    validate_plan_finalizer_ownership(&bundle, &route, &plan)
        .expect("declared finalizer mutation is allowed");
}

#[test]
fn declared_finalize_handlers_register_missing_finalizers_before_reconcile() {
    let bundle = declared_finalizer_routing_bundle();
    let object = serde_json::json!({
        "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob",
        "metadata": { "name": "hero", "namespace": "media" }, "spec": {}
    });
    assert_eq!(
        bundle
            .missing_declared_finalizers("media.applik8s.dev/v1alpha1", "ImageJob", &object)
            .expect("discover finalizers"),
        vec!["media.applik8s.dev/imagejob"]
    );

    let present = serde_json::json!({
        "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob",
        "metadata": { "name": "hero", "namespace": "media", "finalizers": ["media.applik8s.dev/imagejob"] }, "spec": {}
    });
    assert!(
        bundle
            .missing_declared_finalizers("media.applik8s.dev/v1alpha1", "ImageJob", &present)
            .expect("discover finalizers")
            .is_empty()
    );
}

#[test]
fn rejects_undeclared_finalizer_mutations_before_effects() {
    let bundle = declared_finalizer_routing_bundle();
    let route = HandlerRoute {
        handler_id: "ImageJob.finalize.owned".to_string(),
        event: "finalize".to_string(),
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Finalizer {
            operation: FinalizerOperation::Remove,
            finalizer: "other.dev/finalizer".to_string(),
        }],
        diagnostics: None,
    };

    let error = validate_plan_finalizer_ownership(&bundle, &route, &plan)
        .expect_err("undeclared finalizer mutation fails");

    assert!(matches!(
        error,
        OperatorHostError::UndeclaredFinalizer { ref handler_id, ref finalizer }
            if handler_id == "ImageJob.finalize.owned" && finalizer == "other.dev/finalizer"
    ));
}

#[test]
fn preserves_legacy_finalizer_mutations_without_declared_handler_metadata() {
    let bundle = routing_bundle();
    let route = HandlerRoute {
        handler_id: "ImageJob.finalize.1".to_string(),
        event: "finalize".to_string(),
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Finalizer {
            operation: FinalizerOperation::Remove,
            finalizer: "media.applik8s.dev/imagejob".to_string(),
        }],
        diagnostics: None,
    };

    validate_plan_finalizer_ownership(&bundle, &route, &plan)
        .expect("legacy handlers without finalizer metadata remain allowed");
}

#[test]
fn rejects_operation_plans_with_undeclared_rbac_permissions_before_effects() {
    let bundle = rbac_bundle(vec![
        serde_json::json!({ "apiGroups": [""], "resources": ["configmaps"], "verbs": ["patch"] }),
    ]);
    let owner = ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero".to_string(),
        namespace: Some("media".to_string()),
        uid: None,
        resource_version: None,
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Apply {
            resource: k8s_object("v1", "Secret", "hero-secret", Some("media")),
            field_manager: None,
            force: None,
            ownership: None,
            connection: None,
            authority: None,
        }],
        diagnostics: None,
    };

    let error = applik8s_operator_host::validate_plan_rbac(&bundle, &owner, &plan)
        .expect_err("undeclared permission is rejected");

    assert!(matches!(
        error,
        OperatorHostError::UndeclaredPermission(ref message)
            if message.contains("resource=secrets") && message.contains("verb=patch")
    ));
    let details = reconcile_error_details(&error).expect("permission details");
    assert_eq!(details["type"], "undeclaredPermission");
}

#[test]
fn rejects_status_operations_for_owned_crds_without_status_subresource_before_effects() {
    let bundle = rbac_bundle(vec![]);
    let owner = ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero".to_string(),
        namespace: Some("media".to_string()),
        uid: None,
        resource_version: None,
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Status {
            status: serde_json::json!({ "phase": "Ready" }),
            ref_: None,
        }],
        diagnostics: None,
    };

    let error = validate_plan_status_subresources(&bundle, &owner, &plan)
        .expect_err("status subresource absence is rejected");

    assert!(matches!(
        error,
        OperatorHostError::StatusSubresourceUnsupported { ref api_version, ref kind }
            if api_version == "media.applik8s.dev/v1alpha1" && kind == "ImageJob"
    ));
    let details = reconcile_error_details(&error).expect("status details");
    assert_eq!(details["type"], "statusSubresourceUnsupported");
}

#[test]
fn accepts_status_operations_for_owned_crds_with_status_subresource() {
    let mut bundle = rbac_bundle(vec![]);
    bundle.manifest["spec"]["ownedCrds"][0]["statusSubresource"] = serde_json::json!(true);
    let owner = ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero".to_string(),
        namespace: Some("media".to_string()),
        uid: None,
        resource_version: None,
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Status {
            status: serde_json::json!({ "phase": "Ready" }),
            ref_: None,
        }],
        diagnostics: None,
    };

    validate_plan_status_subresources(&bundle, &owner, &plan)
        .expect("declared status subresource allows status operation");
}

#[test]
fn builds_reconcile_failure_status_condition_for_operation_failures() {
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed {
        index: 2,
        kind: "apply".to_string(),
        target: "v1/ConfigMap media/hero-image-child".to_string(),
        field_manager: Some("applik8s".to_string()),
        progress: OperationProgress::default(),
        cause: "kubernetes API operation failed: conflict".to_string(),
    });

    let status = reconcile_failure_status(
        &serde_json::json!({ "metadata": { "generation": 7 } }),
        &StatusConvention::default(),
        &error,
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status["observedGeneration"], 7);
    assert_eq!(status["conditions"][0]["type"], "Ready");
    assert_eq!(status["conditions"][0]["status"], "False");
    assert_eq!(status["conditions"][0]["reason"], "ApplyFailed");
    assert_eq!(status["conditions"][0]["observedGeneration"], 7);
    assert_eq!(
        status["conditions"][0]["lastTransitionTime"],
        "2026-06-21T00:00:00Z"
    );
    assert!(
        status["conditions"][0]["message"]
            .as_str()
            .expect("message is string")
            .contains("runtime bridge failed: operation 2")
    );
}

#[test]
fn builds_reconcile_failure_status_condition_for_partial_operation_failures() {
    let error = OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed {
        index: 2,
        kind: "status".to_string(),
        target: "media.applik8s.dev/v1alpha1/ImageJob media/hero-image".to_string(),
        field_manager: Some("applik8s".to_string()),
        progress: OperationProgress {
            completed_operations: 2,
            applied: 1,
            patched: 1,
            ..OperationProgress::default()
        },
        cause: "kubernetes API operation failed: status conflict".to_string(),
    });

    let status = reconcile_failure_status(
        &serde_json::json!({ "metadata": { "generation": 7 } }),
        &StatusConvention::default(),
        &error,
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status["conditions"][0]["reason"], "StatusPatchFailed");
    let message = status["conditions"][0]["message"]
        .as_str()
        .expect("message is string");
    assert!(message.contains("partial effects are visible"));
    assert!(message.contains("2 prior operation(s)"));
}

#[test]
fn builds_reconcile_failure_status_condition_for_handler_timeouts() {
    let error =
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerTimedOut { timeout_ms: 30000 });

    let status = reconcile_failure_status(
        &serde_json::json!({ "metadata": { "generation": 7 } }),
        &StatusConvention::default(),
        &error,
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status["conditions"][0]["type"], "Ready");
    assert_eq!(status["conditions"][0]["status"], "False");
    assert_eq!(status["conditions"][0]["reason"], "HandlerTimedOut");
    assert_eq!(status["conditions"][0]["observedGeneration"], 7);
    assert!(
        status["conditions"][0]["message"]
            .as_str()
            .expect("message is string")
            .contains("timed out after 30000ms")
    );
}

#[test]
fn truncates_reconcile_failure_status_messages() {
    let error =
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerFailed("x".repeat(2048)));

    let status = reconcile_failure_status(
        &serde_json::json!({ "metadata": { "name": "hero-image" } }),
        &StatusConvention::default(),
        &error,
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status.get("observedGeneration"), None);
    assert_eq!(status["conditions"][0]["reason"], "HandlerFailed");
    assert_eq!(
        status["conditions"][0]["message"]
            .as_str()
            .expect("message is string")
            .len(),
        1024
    );
}

#[test]
fn builds_reconcile_success_status_condition_after_successful_plan_application() {
    let status = reconcile_success_status(
        &serde_json::json!({
            "metadata": { "generation": 8 },
            "status": {
                "observedGeneration": 7,
                "conditions": [{
                    "type": "Ready",
                    "status": "False",
                    "lastTransitionTime": "2026-06-20T00:00:00Z"
                }]
            }
        }),
        &StatusConvention::default(),
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status["observedGeneration"], 8);
    assert_eq!(status["conditions"][0]["type"], "Ready");
    assert_eq!(status["conditions"][0]["status"], "True");
    assert_eq!(status["conditions"][0]["reason"], "ReconcileSucceeded");
    assert_eq!(status["conditions"][0]["observedGeneration"], 8);
    assert_eq!(
        status["conditions"][0]["lastTransitionTime"],
        "2026-06-21T00:00:00Z"
    );
}

#[test]
fn preserves_ready_last_transition_time_when_condition_status_is_unchanged() {
    let status = reconcile_success_status(
        &serde_json::json!({
            "metadata": { "generation": 8 },
            "status": {
                "observedGeneration": 8,
                "conditions": [{
                    "type": "Ready",
                    "status": "True",
                    "lastTransitionTime": "2026-06-20T00:00:00Z"
                }]
            }
        }),
        &StatusConvention::default(),
        "2026-06-21T00:00:00Z",
    );

    assert_eq!(status["conditions"][0]["status"], "True");
    assert_eq!(
        status["conditions"][0]["lastTransitionTime"],
        "2026-06-20T00:00:00Z"
    );
}

#[test]
fn builds_reconcile_stale_status_only_when_observed_generation_lags() {
    let stale = reconcile_stale_status(
        &serde_json::json!({
            "metadata": { "generation": 9 },
            "status": { "observedGeneration": 8 }
        }),
        &StatusConvention::default(),
        "2026-06-21T00:00:00Z",
    )
    .expect("stale status");

    assert_eq!(stale["observedGeneration"], 9);
    assert_eq!(stale["conditions"][0]["type"], "Ready");
    assert_eq!(stale["conditions"][0]["status"], "Unknown");
    assert_eq!(stale["conditions"][0]["reason"], "Reconciling");
    assert_eq!(stale["conditions"][0]["observedGeneration"], 9);

    let fresh = reconcile_stale_status(
        &serde_json::json!({
            "metadata": { "generation": 9 },
            "status": { "observedGeneration": 9 }
        }),
        &StatusConvention::default(),
        "2026-06-21T00:00:00Z",
    );

    assert!(fresh.is_none());
}

#[test]
fn loads_manifest_and_wasm_artifact_from_generated_runtime_paths() {
    let dir = std::env::temp_dir().join(format!("applik8s-host-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("create temp dir");
    let manifest_path = dir.join("operator-manifest.json");
    let handler_path = dir.join("handler.wasm");
    fs::write(
        &manifest_path,
        r#"{"apiVersion":"applik8s.operator/v1alpha1","kind":"OperatorBundle","metadata":{"name":"image-pipeline","annotations":{"applik8s.dev/namespace":"media"}},"spec":{"ownedCrds":[{"apiVersion":"media.applik8s.dev/v1alpha1","kind":"ImageJob","plural":"imagejobs","versions":["v1alpha1"],"storageVersion":"v1alpha1"}]}}"#,
    )
    .expect("write manifest");
    fs::write(&handler_path, [0, 97, 115, 109]).expect("write handler");

    let bundle = LoadedOperatorBundle::load(&OperatorHostPaths {
        manifest_path,
        handler_path,
        handler_chunks_dir: None,
    })
    .expect("load bundle");

    assert_eq!(bundle.manifest["kind"], "OperatorBundle");
    assert_eq!(bundle.handler_wasm, [0, 97, 115, 109]);
    assert_eq!(
        bundle.owned_resource_watches().expect("owned watches"),
        [applik8s_operator_host::OwnedResourceWatch {
            api_version: "media.applik8s.dev/v1alpha1".to_string(),
            kind: "ImageJob".to_string(),
            plural: "imagejobs".to_string(),
            scope: "Namespaced".to_string(),
            namespace: Some("media".to_string()),
            name: None,
            names: Vec::new(),
            label_selector: None,
            field_selector: None,
        }]
    );

    fs::remove_dir_all(dir).expect("cleanup temp dir");
}

#[test]
fn discovers_status_conventions_from_owned_crd_manifest_metadata() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "ownedCrds": [{
                    "apiVersion": "media.applik8s.dev/v1alpha1",
                    "kind": "ImageJob",
                    "plural": "imagejobs",
                    "scope": "Namespaced",
                    "versions": ["v1alpha1"],
                    "storageVersion": "v1alpha1",
                    "statusConvention": {
                        "ownership": "handlerAuthoritative",
                        "observedGenerationField": "observedGeneration",
                        "conditionsField": "conditions"
                    }
                }, {
                    "apiVersion": "media.applik8s.dev/v1alpha1",
                    "kind": "OtherJob",
                    "plural": "otherjobs",
                    "scope": "Namespaced",
                    "versions": ["v1alpha1"],
                    "storageVersion": "v1alpha1"
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    let convention = bundle
        .status_convention_for_object("media.applik8s.dev/v1alpha1", "ImageJob")
        .expect("status convention")
        .expect("ImageJob convention exists");
    assert_eq!(
        convention,
        StatusConvention {
            ownership: applik8s_operator_host::StatusOwnership::HandlerAuthoritative,
            ..StatusConvention::default()
        }
    );
    assert!(!convention.lifecycle_managed());
    assert_eq!(
        bundle
            .status_convention_for_object("media.applik8s.dev/v1alpha1", "OtherJob")
            .expect("no status convention"),
        None
    );
}

#[test]
fn discovers_status_subresource_support_from_owned_crd_manifest_metadata() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "ownedCrds": [{
                    "apiVersion": "media.applik8s.dev/v1alpha1",
                    "kind": "ImageJob",
                    "plural": "imagejobs",
                    "scope": "Namespaced",
                    "versions": ["v1alpha1"],
                    "storageVersion": "v1alpha1",
                    "statusSubresource": true
                }, {
                    "apiVersion": "media.applik8s.dev/v1alpha1",
                    "kind": "OtherJob",
                    "plural": "otherjobs",
                    "scope": "Namespaced",
                    "versions": ["v1alpha1"],
                    "storageVersion": "v1alpha1",
                    "statusSubresource": false
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert_eq!(
        bundle
            .status_subresource_for_object("media.applik8s.dev/v1alpha1", "ImageJob")
            .expect("status support"),
        Some(true)
    );
    assert_eq!(
        bundle
            .status_subresource_for_object("media.applik8s.dev/v1alpha1", "OtherJob")
            .expect("no status support"),
        Some(false)
    );
    assert_eq!(
        bundle
            .status_subresource_for_object("v1", "ConfigMap")
            .expect("unknown resource"),
        None
    );
}

#[test]
fn resolves_handler_timeout_from_manifest_runtime_config() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "runtime": { "handlerTimeoutSeconds": 12 },
                "ownedCrds": []
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert_eq!(
        bundle.handler_timeout().expect("handler timeout"),
        Duration::from_secs(12)
    );
}

#[test]
fn rejects_invalid_manifest_handler_timeout() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "runtime": { "handlerTimeoutSeconds": 0 },
                "ownedCrds": []
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        bundle.handler_timeout(),
        Err(OperatorHostError::InvalidRuntimeConfig(message))
            if message.contains("handlerTimeoutSeconds")
    ));
}

#[test]
fn resolves_retry_policy_from_manifest_runtime_config() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "runtime": {
                    "rateLimit": { "baseDelayMs": 250, "maxDelayMs": 4000, "maxRetries": 5 }
                },
                "ownedCrds": []
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert_eq!(
        bundle.retry_policy().expect("retry policy"),
        RetryPolicy {
            base_delay: Duration::from_millis(250),
            max_delay: Duration::from_millis(4000),
            max_retries: Some(5),
        }
    );
}

#[test]
fn rejects_invalid_manifest_retry_policy() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "runtime": {
                    "rateLimit": { "baseDelayMs": 5000, "maxDelayMs": 1000 }
                },
                "ownedCrds": []
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        bundle.retry_policy(),
        Err(OperatorHostError::InvalidRuntimeConfig(message))
            if message.contains("maxDelayMs")
    ));
}

#[test]
fn loads_gzip_handler_chunks_without_shell_unpacking() {
    let dir = std::env::temp_dir().join(format!("applik8s-host-chunks-{}", std::process::id()));
    let chunks_dir = dir.join("chunks");
    fs::create_dir_all(&chunks_dir).expect("create chunks dir");
    let manifest_path = dir.join("operator-manifest.json");
    let missing_handler_path = dir.join("handler.wasm");
    fs::write(
        &manifest_path,
        r#"{"apiVersion":"applik8s.operator/v1alpha1","kind":"OperatorBundle","metadata":{"name":"image-pipeline"},"spec":{"ownedCrds":[]}}"#,
    )
    .expect("write manifest");

    let wasm = [0, 97, 115, 109, 1, 2, 3, 4];
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&wasm).expect("write gzip input");
    let compressed = encoder.finish().expect("finish gzip");
    let midpoint = compressed.len() / 2;
    fs::write(chunks_dir.join("part-000"), &compressed[..midpoint]).expect("write first chunk");
    fs::write(chunks_dir.join("part-001"), &compressed[midpoint..]).expect("write second chunk");

    let bundle = LoadedOperatorBundle::load(&OperatorHostPaths {
        manifest_path,
        handler_path: missing_handler_path,
        handler_chunks_dir: Some(chunks_dir),
    })
    .expect("load bundle from chunks");

    assert_eq!(bundle.handler_wasm, wasm);

    fs::remove_dir_all(dir).expect("cleanup temp dir");
}

#[test]
fn validates_runtime_version_compatibility_against_manifest_requirement() {
    let bundle = compatibility_bundle("^0.1.0");

    bundle
        .validate_runtime_compatibility("0.1.7")
        .expect("compatible runtime is accepted");

    let error = bundle
        .validate_runtime_compatibility("0.2.0")
        .expect_err("incompatible runtime is rejected");

    assert!(matches!(
        error,
        OperatorHostError::IncompatibleRuntime { required, actual }
            if required == "^0.1.0" && actual == "0.2.0"
    ));
}

#[test]
fn rejects_missing_invalid_or_unsupported_manifest_versions() {
    let missing = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": "^0.1.0"
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let invalid = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": 42,
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": "^0.1.0"
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let unsupported = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v2alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": "^0.1.0"
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        missing.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidManifestVersion(message))
            if message.contains("apiVersion")
    ));
    assert!(matches!(
        invalid.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidManifestVersion(message))
            if message.contains("apiVersion")
    ));
    assert!(matches!(
        unsupported.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::UnsupportedManifestVersion { required, supported })
            if required == "applik8s.operator/v2alpha1" && supported == "applik8s.operator/v1alpha1"
    ));
}

#[test]
fn rejects_missing_or_invalid_runtime_compatibility_declarations() {
    let missing = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": { "handlerAbi": "applik8s.handler/v1alpha1" }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let invalid = compatibility_bundle("not a semver range");

    assert!(matches!(
        missing.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidRuntimeRequirement(message)) if message.contains("spec.requiresRuntime")
    ));
    assert!(matches!(
        invalid.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidRuntimeRequirement(message)) if message.contains("invalid")
    ));
}

#[test]
fn rejects_missing_or_unsupported_handler_abi_declarations() {
    let missing = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": { "requiresRuntime": "^0.1.0" }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let unsupported = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v2alpha1",
                "requiresRuntime": "^0.1.0"
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        missing.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidHandlerAbi(message)) if message.contains("spec.handlerAbi")
    ));
    assert!(matches!(
        unsupported.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::UnsupportedHandlerAbi { required, supported })
            if required == "applik8s.handler/v2alpha1" && supported == "applik8s.handler/v1alpha1"
    ));
}

#[test]
fn accepts_supported_leader_election_runtime_config() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": "^0.1.0",
                "runtime": {
                    "leaderElection": {
                        "enabled": true,
                        "leaseName": "image-pipeline",
                        "leaseNamespace": "media-system",
                        "leaseDurationSeconds": 15,
                        "renewDeadlineSeconds": 10,
                        "retryPeriodSeconds": 2
                    }
                }
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(bundle.validate_runtime_compatibility("0.1.0").is_ok());
    assert_eq!(
        bundle.leader_election_config().unwrap(),
        Some(RuntimeLeaderElectionConfig {
            lease_name: "image-pipeline".to_string(),
            lease_namespace: Some("media-system".to_string()),
            lease_duration_seconds: 15,
            renew_deadline_seconds: 10,
            retry_period_seconds: 2,
        })
    );
}

#[test]
fn rejects_invalid_leader_election_timing() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": "^0.1.0",
                "runtime": {
                    "leaderElection": {
                        "enabled": true,
                        "leaseName": "image-pipeline",
                        "leaseDurationSeconds": 10,
                        "renewDeadlineSeconds": 10,
                        "retryPeriodSeconds": 2
                    }
                }
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        bundle.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidRuntimeConfig(message))
            if message.contains("leaseDurationSeconds")
    ));
}

#[test]
fn rejects_unsupported_runtime_concurrency_until_controller_policy_exists() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": "^0.1.0",
                "runtime": {
                    "leaderElection": { "enabled": false },
                    "concurrency": {
                        "workerCount": 2,
                        "maxInFlightPerResource": 1
                    }
                }
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        bundle.validate_runtime_compatibility("0.1.0"),
        Err(OperatorHostError::InvalidRuntimeConfig(message))
            if message.contains("concurrency.workerCount")
    ));
}

#[test]
fn rejects_connection_capable_bundle_on_older_host_before_invocation() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline", "annotations": { "applik8s.dev/namespace": "media" } },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": ">=0.1.1, <0.2.0",
                "permissions": [{ "apiGroups": [""], "resources": ["secrets"], "verbs": ["get"], "resourceNames": ["destination-kubeconfig"] }],
                "capabilities": { "destination": {
                    "name": "destination", "kind": "kubernetes",
                    "permissions": [{ "apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get"], "namespaces": ["payments"] }],
                    "kubernetesConnection": { "endpointPolicy": "workload-cluster-apis" },
                    "execution": { "protocol": "applik8s.kubernetes-connection/v1alpha1" }
                }},
                "kubernetesConnectionBindings": { "destination": {
                    "kubeconfigSecretRef": { "name": "destination-kubeconfig", "namespace": "media", "key": "kubeconfig" },
                    "context": "destination",
                    "endpointPolicy": { "name": "workload-cluster-apis", "version": "1", "scheme": "https", "hosts": ["destination.example.test"], "ports": [6443], "redirects": "deny" }
                }}
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    let error = bundle
        .validate_runtime_compatibility("0.4.3")
        .expect_err("older host must reject");
    assert!(
        matches!(error, OperatorHostError::IncompatibleRuntime { .. }),
        "unexpected error: {error:?}"
    );
}

#[test]
fn accepts_connection_capable_bundle_on_the_built_host_protocol_version() {
    let bundle = compatibility_bundle(">=0.1.1, <0.2.0");

    bundle
        .validate_runtime_compatibility(env!("CARGO_PKG_VERSION"))
        .expect("the built host accepts the connection protocol it ships");
}

#[test]
fn parses_declared_host_import_allowlist_from_manifest() {
    let bundle = compatibility_bundle("^0.1.0");

    assert_eq!(
        bundle.allowed_host_imports().expect("host imports parse"),
        vec![
            "capability-request".to_string(),
            "log".to_string(),
            "cancel".to_string(),
            "wasi:cli".to_string(),
            "wasi:clocks".to_string(),
            "wasi:filesystem".to_string(),
            "wasi:io".to_string(),
            "wasi:random".to_string(),
            "wasi:http".to_string(),
            "wasi:sockets".to_string()
        ]
    );
}

#[test]
fn rejects_missing_or_invalid_host_import_allowlist_declarations() {
    let missing = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": { "requiresRuntime": "^0.1.0", "handlerAbi": "applik8s.handler/v1alpha1" }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let invalid = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "requiresRuntime": "^0.1.0",
                "handlerAbi": "applik8s.handler/v1alpha1",
                "adapterRequirements": { "hostImports": ["log", 42] }
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        missing.allowed_host_imports(),
        Err(OperatorHostError::InvalidRuntimeAdapterRequirement(message))
            if message.contains("hostImports is required")
    ));
    assert!(matches!(
        invalid.allowed_host_imports(),
        Err(OperatorHostError::InvalidRuntimeAdapterRequirement(message))
            if message.contains("hostImports[1]")
    ));
}

#[test]
fn validates_handler_wasm_imports_against_declared_allowlist() {
    let engine = component_model_engine().expect("component engine configures");
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "requiresRuntime": "^0.1.0",
                "handlerAbi": "applik8s.handler/v1alpha1",
                "adapterRequirements": { "hostImports": ["log"] }
            }
        }),
        handler_wasm: wat::parse_str(r#"(component (import "log" (func)))"#)
            .expect("component fixture parses"),
    };

    bundle
        .validate_handler_host_imports(&engine)
        .expect("declared handler import is accepted");
}

#[test]
fn rejects_handler_wasm_imports_missing_from_declared_allowlist() {
    let engine = component_model_engine().expect("component engine configures");
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "requiresRuntime": "^0.1.0",
                "handlerAbi": "applik8s.handler/v1alpha1",
                "adapterRequirements": { "hostImports": ["log"] }
            }
        }),
        handler_wasm: wat::parse_str(r#"(component (import "capability-request" (func)))"#)
            .expect("component fixture parses"),
    };

    assert!(matches!(
        bundle.validate_handler_host_imports(&engine),
        Err(OperatorHostError::RuntimeBridge(RuntimeBridgeError::UndeclaredHostImport(import)))
            if import == "capability-request"
    ));
}

#[test]
fn validates_persisted_generated_bundle_fixture_against_current_host() {
    let manifest: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/bundles/v0.1.0/operator-manifest.json"
    ))
    .expect("fixture manifest is valid JSON");
    let bundle = LoadedOperatorBundle {
        manifest,
        handler_wasm: vec![0, 97, 115, 109],
    };

    bundle
        .validate_runtime_compatibility(env!("CARGO_PKG_VERSION"))
        .expect("persisted bundle is compatible with current host");
    assert_eq!(
        bundle.owned_resource_watches().expect("owned watches"),
        [applik8s_operator_host::OwnedResourceWatch {
            api_version: "media.applik8s.dev/v1alpha1".to_string(),
            kind: "ImageJob".to_string(),
            plural: "imagejobs".to_string(),
            scope: "Namespaced".to_string(),
            namespace: Some("media".to_string()),
            name: None,
            names: Vec::new(),
            label_selector: None,
            field_selector: None,
        }]
    );
    assert_eq!(
        bundle
            .handler_route_for_object(
                "media.applik8s.dev/v1alpha1",
                "ImageJob",
                &serde_json::json!({ "metadata": { "name": "hero" } }),
            )
            .expect("handler route resolves"),
        HandlerRoute {
            handler_id: "ImageJob.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        }
    );
}

#[test]
fn loads_scoped_manifest_watches_for_external_resources() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "platform-controller" },
            "spec": {
                "ownedCrds": [],
                "watches": [{
                    "apiVersion": "apps/v1",
                    "kind": "Deployment",
                    "plural": "deployments",
                    "scope": "Namespaced",
                    "namespace": "apps",
                    "fieldSelector": "metadata.name=api",
                    "labelSelector": { "matchLabels": { "app.kubernetes.io/part-of": "platform" } },
                    "events": ["updated"],
                    "handlers": ["Deployment.updated.0"]
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert_eq!(
        bundle
            .manifest_resource_watches()
            .expect("manifest watches parse"),
        [applik8s_operator_host::OwnedResourceWatch {
            api_version: "apps/v1".to_string(),
            kind: "Deployment".to_string(),
            plural: "deployments".to_string(),
            scope: "Namespaced".to_string(),
            namespace: Some("apps".to_string()),
            name: None,
            names: Vec::new(),
            label_selector: Some(
                serde_json::json!({ "matchLabels": { "app.kubernetes.io/part-of": "platform" } })
            ),
            field_selector: Some("metadata.name=api".to_string()),
        }]
    );
}

#[tokio::test]
async fn constructs_secondary_source_controllers_with_explicit_target_mapping() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1", "kind": "OperatorBundle",
            "metadata": { "name": "replica-controller", "annotations": { "applik8s.dev/namespace": "replicas" } },
            "spec": {
                "ownedCrds": [{ "apiVersion": "sync.applik8s.dev/v1alpha1", "kind": "Replica", "plural": "replicas", "scope": "Namespaced" }],
                "watches": [{ "apiVersion": "sync.applik8s.dev/v1alpha1", "kind": "Replica", "plural": "replicas", "scope": "Namespaced", "events": ["reconcile"], "handlers": ["Replica.reconcile.0"] }],
                "secondaryWatches": [{
                    "source": { "apiVersion": "apps/v1", "kind": "Deployment", "plural": "deployments", "scope": "Namespaced" },
                    "target": { "apiVersion": "sync.applik8s.dev/v1alpha1", "kind": "Replica", "plural": "replicas", "scope": "Namespaced" },
                    "watch": { "namespace": "sources", "labelSelector": { "matchLabels": { "sync": "enabled" } } },
                    "mapper": { "mode": "all", "namespace": "operator" }
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let controllers = bundle
        .controllers(mock_kube_client())
        .expect("construct controllers");
    assert_eq!(controllers.len(), 2);
    let secondary = controllers
        .iter()
        .find(|controller| controller.secondary.is_some())
        .expect("secondary controller");
    assert_eq!(secondary.watch.kind, "Deployment");
    assert_eq!(secondary.watch.namespace.as_deref(), Some("sources"));
}

#[tokio::test]
async fn constructs_exact_secondary_source_controller_from_annotation_mapping() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1", "kind": "OperatorBundle",
            "metadata": { "name": "dns-controller", "annotations": { "applik8s.dev/namespace": "dns-system" } },
            "spec": {
                "ownedCrds": [{ "apiVersion": "platform.applik8s.dev/v1alpha1", "kind": "PublicationOwner", "plural": "publicationowners", "scope": "Namespaced" }],
                "watches": [{ "apiVersion": "platform.applik8s.dev/v1alpha1", "kind": "PublicationOwner", "plural": "publicationowners", "scope": "Namespaced", "events": ["reconcile"], "handlers": ["PublicationOwner.reconcile.0"] }],
                "secondaryWatches": [{
                    "source": { "apiVersion": "externaldns.k8s.io/v1alpha1", "kind": "DNSEndpoint", "plural": "dnsendpoints", "scope": "Namespaced" },
                    "target": { "apiVersion": "platform.applik8s.dev/v1alpha1", "kind": "PublicationOwner", "plural": "publicationowners", "scope": "Namespaced" },
                    "watch": { "namespace": "dns-system" },
                    "mapper": { "mode": "targetNameFromSourceField", "source": { "kind": "annotation", "key": "dns.applik8s.dev/source-name" }, "namespace": "source" }
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let controllers = bundle
        .controllers(mock_kube_client())
        .expect("construct exact secondary controller");
    let secondary = controllers
        .iter()
        .find(|controller| controller.secondary.is_some())
        .expect("exact secondary controller");
    assert_eq!(secondary.watch.kind, "DNSEndpoint");
    assert_eq!(secondary.watch.namespace.as_deref(), Some("dns-system"));
    assert_eq!(
        secondary
            .secondary
            .as_ref()
            .and_then(|value| value.pointer("/mapper/mode"))
            .and_then(serde_json::Value::as_str),
        Some("targetNameFromSourceField")
    );
}

#[test]
fn defaults_namespaced_manifest_watches_to_operator_namespace() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": {
                "name": "html-renderer",
                "annotations": { "applik8s.dev/namespace": "sites" }
            },
            "spec": {
                "ownedCrds": [],
                "watches": [{
                    "apiVersion": "ssr.applik8s.dev/v1alpha1",
                    "kind": "HtmlSite",
                    "plural": "htmlsites",
                    "scope": "Namespaced",
                    "events": ["reconcile"],
                    "handlers": ["HtmlSite.reconcile.0"]
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert_eq!(
        bundle
            .manifest_resource_watches()
            .expect("manifest watches parse"),
        [applik8s_operator_host::OwnedResourceWatch {
            api_version: "ssr.applik8s.dev/v1alpha1".to_string(),
            kind: "HtmlSite".to_string(),
            plural: "htmlsites".to_string(),
            scope: "Namespaced".to_string(),
            namespace: Some("sites".to_string()),
            name: None,
            names: Vec::new(),
            label_selector: None,
            field_selector: None,
        }]
    );
}

#[test]
fn validates_persisted_bundle_compatibility_matrix() {
    let entries = persisted_compatibility_matrix();
    let engine = component_model_engine().expect("component engine configures");

    for entry in entries.as_array().expect("matrix entries") {
        let name = entry["name"].as_str().expect("entry name");
        let runtime_version = entry["runtimeVersion"]
            .as_str()
            .expect("entry runtimeVersion");
        let manifest = entry["manifest"].clone();
        let component_imports = entry
            .get("componentImports")
            .and_then(serde_json::Value::as_array)
            .map(|imports| {
                imports
                    .iter()
                    .map(|import| import.as_str().expect("component import string"))
                    .collect::<Vec<_>>()
            });
        let bundle = LoadedOperatorBundle {
            manifest,
            handler_wasm: component_imports
                .as_ref()
                .map(|imports| wasm_component_with_imports(imports))
                .unwrap_or_else(|| vec![0, 97, 115, 109]),
        };

        assert_runtime_compatibility_expectation(name, &bundle, runtime_version, entry);
        assert_host_import_expectation(name, &bundle, entry);
        if component_imports.is_some() {
            assert_component_import_expectation(name, &bundle, &engine, entry);
        }
        assert_status_plan_expectation(name, &bundle, entry);
    }
}

#[test]
fn validates_handler_abi_v1_fixture_without_optional_runtime_fields() {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/abi/v1alpha1-minimal-runtime.json"))
            .expect("fixture manifest is valid JSON");
    let bundle = LoadedOperatorBundle {
        manifest,
        handler_wasm: vec![0, 97, 115, 109],
    };

    bundle
        .validate_runtime_compatibility(env!("CARGO_PKG_VERSION"))
        .expect("v1alpha1 ABI fixture with omitted optional runtime fields is compatible");
    assert_eq!(
        bundle.allowed_host_imports().expect("host imports parse"),
        vec!["log".to_string()]
    );
}

#[test]
fn validates_handler_abi_v1_timeout_and_cancellation_fixture() {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/abi/v1alpha1-timeout-cancel.json"))
            .expect("fixture manifest is valid JSON");
    let bundle = LoadedOperatorBundle {
        manifest,
        handler_wasm: wat::parse_str(r#"(component (import "cancel" (func)))"#)
            .expect("component fixture parses"),
    };
    let engine = component_model_engine().expect("component engine configures");

    bundle
        .validate_runtime_compatibility(env!("CARGO_PKG_VERSION"))
        .expect("v1alpha1 ABI fixture with timeout and cancellation is compatible");
    assert_eq!(
        bundle.handler_timeout().expect("handler timeout"),
        Duration::from_secs(7)
    );
    bundle
        .validate_handler_host_imports(&engine)
        .expect("declared cancel import is accepted");
}

#[test]
fn rejects_incompatible_handler_abi_evolution_fixture() {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/abi/v2alpha1-incompatible.json"))
            .expect("fixture manifest is valid JSON");
    let bundle = LoadedOperatorBundle {
        manifest,
        handler_wasm: vec![0, 97, 115, 109],
    };

    assert!(matches!(
        bundle.validate_runtime_compatibility(env!("CARGO_PKG_VERSION")),
        Err(OperatorHostError::UnsupportedHandlerAbi { required, supported })
            if required == "applik8s.handler/v2alpha1" && supported == "applik8s.handler/v1alpha1"
    ));
}

#[test]
fn routes_deletion_timestamp_objects_to_finalize_handler_when_registered() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero", "deletionTimestamp": "2026-06-21T00:00:00Z", "finalizers": ["media.applik8s.dev/imagejob"] } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.finalize.1".to_string(),
            event: "finalize".to_string(),
        }
    );
}

#[test]
fn routes_deletion_timestamp_objects_to_deleted_handler_when_registered() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero", "deletionTimestamp": "2026-06-21T00:00:00Z", "finalizers": [] } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.deleted.4".to_string(),
            event: "deleted".to_string(),
        }
    );
}

#[test]
fn routes_normal_objects_and_missing_finalize_to_reconcile_handler() {
    let bundle = routing_bundle();

    let normal_route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero" } }),
        )
        .expect("handler route resolves");
    let fallback_route = bundle
        .handler_route_for_object(
            "billing.applik8s.dev/v1alpha1",
            "Invoice",
            &serde_json::json!({ "metadata": { "name": "invoice", "deletionTimestamp": "2026-06-21T00:00:00Z" } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        normal_route,
        HandlerRoute {
            handler_id: "ImageJob.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        }
    );
    assert_eq!(
        fallback_route,
        HandlerRoute {
            handler_id: "Invoice.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        }
    );
}

#[test]
fn routes_deletion_timestamp_objects_to_declared_matching_finalizer_handler() {
    let bundle = declared_finalizer_routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({
                "metadata": {
                    "name": "hero",
                    "deletionTimestamp": "2026-06-21T00:00:00Z",
                    "finalizers": ["media.applik8s.dev/imagejob"]
                }
            }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.finalize.owned".to_string(),
            event: "finalize".to_string(),
        }
    );
}

#[test]
fn routes_readme_style_lifecycle_events_to_the_registered_runtime_listeners() {
    let bundle = readme_lifecycle_routing_bundle();

    let reconcile = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero-image", "namespace": "media", "generation": 1 } }),
        )
        .expect("reconcile listener resolves");
    let updated_fallback = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero-image", "namespace": "media", "generation": 2 } }),
        )
        .expect("updated generation falls back to reconcile listener");
    let finalize = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({
                "metadata": {
                    "name": "hero-image",
                    "namespace": "media",
                    "generation": 2,
                    "deletionTimestamp": "2026-06-21T00:00:00Z",
                    "finalizers": ["media.applik8s.dev/imagejob"]
                }
            }),
        )
        .expect("finalize listener resolves");

    assert_eq!(
        reconcile,
        HandlerRoute {
            handler_id: "ImageJob.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        }
    );
    assert_eq!(
        updated_fallback,
        HandlerRoute {
            handler_id: "ImageJob.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        }
    );
    assert_eq!(
        finalize,
        HandlerRoute {
            handler_id: "ImageJob.finalize.1".to_string(),
            event: "finalize".to_string(),
        }
    );
}

#[test]
fn skips_declared_finalize_handlers_when_object_has_only_foreign_finalizers() {
    let bundle = declared_finalizer_routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({
                "metadata": {
                    "name": "hero",
                    "deletionTimestamp": "2026-06-21T00:00:00Z",
                    "finalizers": ["other.dev/finalizer"]
                }
            }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.deleted.0".to_string(),
            event: "deleted".to_string(),
        }
    );
}

#[test]
fn routes_generation_one_objects_to_created_handler_when_registered() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero", "generation": 1 } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.created.2".to_string(),
            event: "created".to_string(),
        }
    );
}

#[test]
fn routes_generation_greater_than_one_objects_to_updated_handler_when_registered() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero", "generation": 2 } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.updated.3".to_string(),
            event: "updated".to_string(),
        }
    );
}

#[test]
fn routes_observed_status_objects_to_status_changed_handler_when_registered() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({
                "metadata": { "name": "hero", "generation": 2 },
                "status": { "observedGeneration": 2, "phase": "Ready" }
            }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.statusChanged.5".to_string(),
            event: "statusChanged".to_string(),
        }
    );
}

#[test]
fn routes_external_status_objects_without_observed_generation_to_status_changed_handler() {
    let bundle = external_generationless_routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "v1",
            "Service",
            &serde_json::json!({
                "metadata": { "name": "api", "namespace": "apps", "generation": 3 },
                "status": { "loadBalancer": { "ingress": [{ "ip": "127.0.0.1" }] } }
            }),
        )
        .expect("external status route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "Service.statusChanged.0".to_string(),
            event: "statusChanged".to_string(),
        }
    );
}

#[test]
fn routes_stale_status_objects_to_generation_handler_before_status_changed() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({
                "metadata": { "name": "hero", "generation": 2 },
                "status": { "observedGeneration": 1, "phase": "Processing" }
            }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.updated.3".to_string(),
            event: "updated".to_string(),
        }
    );
}

#[test]
fn routes_generation_events_to_reconcile_when_specific_event_handler_is_missing() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "billing.applik8s.dev/v1alpha1",
            "Invoice",
            &serde_json::json!({ "metadata": { "name": "invoice", "generation": 2 } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "Invoice.reconcile.0".to_string(),
            event: "reconcile".to_string(),
        }
    );
}

#[test]
fn routes_deletion_timestamp_objects_to_deleted_before_generation_events() {
    let bundle = routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero", "generation": 1, "deletionTimestamp": "2026-06-21T00:00:00Z", "finalizers": [] } }),
        )
        .expect("handler route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.deleted.4".to_string(),
            event: "deleted".to_string(),
        }
    );
}

#[test]
fn routes_manifest_watch_handlers_only_when_scope_matches_object() {
    let bundle = scoped_watch_routing_bundle();
    let matching = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": "api",
            "namespace": "apps",
            "generation": 2,
            "labels": { "app.kubernetes.io/part-of": "platform" }
        }
    });
    let wrong_name = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": "other",
            "namespace": "apps",
            "generation": 2,
            "labels": { "app.kubernetes.io/part-of": "platform" }
        }
    });
    let wrong_label = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": "api",
            "namespace": "apps",
            "generation": 2,
            "labels": { "app.kubernetes.io/part-of": "other" }
        }
    });

    let route = bundle
        .handler_route_for_object("apps/v1", "Deployment", &matching)
        .expect("matching scoped watch route resolves");

    assert!(
        bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &matching)
            .expect("matching watch preflight resolves")
    );
    assert!(
        !bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &wrong_name)
            .expect("wrong-name watch preflight resolves")
    );
    assert!(
        !bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &wrong_label)
            .expect("wrong-label watch preflight resolves")
    );
    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "Deployment.updated.0".to_string(),
            event: "updated".to_string(),
        }
    );
    assert!(matches!(
        bundle.handler_route_for_object("apps/v1", "Deployment", &wrong_name,),
        Err(OperatorHostError::HandlerNotFound { .. })
    ));
    assert!(matches!(
        bundle.handler_route_for_object("apps/v1", "Deployment", &wrong_label,),
        Err(OperatorHostError::HandlerNotFound { .. })
    ));
}

#[test]
fn identifies_external_events_outside_declared_watch_event_interest_before_handler_routing() {
    let bundle = scoped_watch_routing_bundle();
    let initial_list_object = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": "api",
            "namespace": "apps",
            "generation": 1,
            "labels": { "app.kubernetes.io/part-of": "platform" }
        }
    });
    let updated_object = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": "api",
            "namespace": "apps",
            "generation": 2,
            "labels": { "app.kubernetes.io/part-of": "platform" }
        }
    });

    assert!(
        bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &initial_list_object)
            .expect("initial object watch preflight resolves")
    );
    assert!(bundle.object_is_outside_external_event_interest(
        "apps/v1",
        "Deployment",
        &initial_list_object
    ));
    assert!(!bundle.object_is_outside_external_event_interest(
        "apps/v1",
        "Deployment",
        &updated_object
    ));
    assert!(matches!(
        bundle.handler_route_for_object("apps/v1", "Deployment", &initial_list_object,),
        Err(OperatorHostError::HandlerNotFound { .. })
    ));
}

#[test]
fn identifies_objects_outside_finite_names_watch_scope_before_handler_routing() {
    let bundle = LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "platform-controller" },
            "spec": {
                "ownedCrds": [],
                "handlerExports": [
                    { "handlerId": "Deployment.updated.0", "event": "updated", "resource": { "apiVersion": "apps/v1", "kind": "Deployment" } }
                ],
                "watches": [{
                    "apiVersion": "apps/v1",
                    "kind": "Deployment",
                    "plural": "deployments",
                    "scope": "Namespaced",
                    "namespace": "apps",
                    "names": ["api", "worker"],
                    "events": ["updated"],
                    "handlers": ["Deployment.updated.0"]
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    };
    let api = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": { "name": "api", "namespace": "apps", "generation": 2 }
    });
    let worker = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": { "name": "worker", "namespace": "apps", "generation": 2 }
    });
    let database = serde_json::json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": { "name": "database", "namespace": "apps", "generation": 2 }
    });

    assert!(
        bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &api)
            .expect("api watch preflight resolves")
    );
    assert!(
        bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &worker)
            .expect("worker watch preflight resolves")
    );
    assert!(
        !bundle
            .object_matches_runtime_watch("apps/v1", "Deployment", &database)
            .expect("database watch preflight resolves")
    );
}

#[test]
fn routes_owned_crd_handlers_when_manifest_also_has_unrelated_external_watches() {
    let bundle = mixed_external_watch_and_owned_crd_routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "media.applik8s.dev/v1alpha1",
            "ImageJob",
            &serde_json::json!({ "metadata": { "name": "hero", "generation": 2 } }),
        )
        .expect("owned CRD route resolves independently of unrelated watches");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ImageJob.updated.0".to_string(),
            event: "updated".to_string(),
        }
    );
}

#[test]
fn routes_generationless_external_objects_to_updated_handler_when_registered() {
    let bundle = external_generationless_routing_bundle();

    let route = bundle
        .handler_route_for_object(
            "v1",
            "ConfigMap",
            &serde_json::json!({
                "metadata": { "name": "settings", "namespace": "apps", "resourceVersion": "12" },
                "data": { "mode": "active" }
            }),
        )
        .expect("generationless external route resolves");

    assert_eq!(
        route,
        HandlerRoute {
            handler_id: "ConfigMap.updated.0".to_string(),
            event: "updated".to_string(),
        }
    );
}

#[test]
fn rejects_ambiguous_runtime_routes_when_multiple_watch_scopes_match() {
    let bundle = ambiguous_scoped_watch_routing_bundle();

    let error = bundle
        .handler_route_for_object(
            "apps/v1",
            "Deployment",
            &serde_json::json!({
                "metadata": {
                    "name": "api",
                    "namespace": "apps",
                    "generation": 2,
                    "labels": { "app.kubernetes.io/part-of": "platform" }
                }
            }),
        )
        .expect_err("overlapping watches fail closed");

    assert!(matches!(
        error,
        OperatorHostError::AmbiguousHandlerRoute { ref api_version, ref kind, ref event, ref handler_ids }
            if api_version == "apps/v1"
                && kind == "Deployment"
                && event == "updated"
                && handler_ids == &vec!["Deployment.updated.exact".to_string(), "Deployment.updated.selector".to_string()]
    ));
    let details = reconcile_error_details(&error).expect("ambiguous route details");
    assert_eq!(details["type"], "ambiguousHandlerRoute");
    assert_eq!(details["apiVersion"], "apps/v1");
    assert_eq!(details["kind"], "Deployment");
    assert_eq!(details["event"], "updated");
    assert_eq!(
        details["handlerIds"],
        serde_json::json!(["Deployment.updated.exact", "Deployment.updated.selector"])
    );
}

fn image_job_ref() -> ObjectRef {
    ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero-image".to_string(),
        namespace: Some("media".to_string()),
        uid: Some("uid-1".to_string()),
        resource_version: Some("42".to_string()),
    }
}

fn persisted_compatibility_matrix() -> serde_json::Value {
    serde_json::from_str(include_str!("fixtures/compatibility/matrix.json"))
        .expect("compatibility matrix fixture is valid JSON")
}

fn assert_runtime_compatibility_expectation(
    name: &str,
    bundle: &LoadedOperatorBundle,
    runtime_version: &str,
    entry: &serde_json::Value,
) {
    let expectation = entry["expectedRuntime"]
        .as_str()
        .expect("expectedRuntime string");
    let result = bundle.validate_runtime_compatibility(runtime_version);
    match expectation {
        "compatible" => result
            .unwrap_or_else(|error| panic!("{name}: expected runtime compatibility, got {error}")),
        "unsupportedManifestVersion" => assert!(
            matches!(
                result,
                Err(OperatorHostError::UnsupportedManifestVersion { .. })
            ),
            "{name}: expected unsupported manifest version, got {result:?}"
        ),
        "unsupportedHandlerAbi" => assert!(
            matches!(result, Err(OperatorHostError::UnsupportedHandlerAbi { .. })),
            "{name}: expected unsupported handler ABI, got {result:?}"
        ),
        "incompatibleRuntime" => assert!(
            matches!(result, Err(OperatorHostError::IncompatibleRuntime { .. })),
            "{name}: expected incompatible runtime, got {result:?}"
        ),
        other => panic!("{name}: unsupported expectedRuntime {other}"),
    }
}

fn assert_host_import_expectation(
    name: &str,
    bundle: &LoadedOperatorBundle,
    entry: &serde_json::Value,
) {
    let Some(expectation) = entry.get("expectedHostImports") else {
        return;
    };
    if expectation.as_str() == Some("invalidHostImports") {
        assert!(
            matches!(
                bundle.allowed_host_imports(),
                Err(OperatorHostError::InvalidRuntimeAdapterRequirement(_))
            ),
            "{name}: expected invalid host imports"
        );
        return;
    }
    let expected = expectation
        .as_array()
        .expect("expectedHostImports array")
        .iter()
        .map(|value| value.as_str().expect("host import string").to_string())
        .collect::<Vec<_>>();

    assert_eq!(
        bundle.allowed_host_imports().expect("host imports parse"),
        expected,
        "{name}: host import allowlist mismatch"
    );
}

fn assert_component_import_expectation(
    name: &str,
    bundle: &LoadedOperatorBundle,
    engine: &wasmtime::Engine,
    entry: &serde_json::Value,
) {
    let expectation = entry["expectedComponentImports"]
        .as_str()
        .expect("expectedComponentImports string");
    let result = bundle.validate_handler_host_imports(engine);
    match expectation {
        "compatible" => result.unwrap_or_else(|error| {
            panic!("{name}: expected component imports to be compatible, got {error}")
        }),
        "undeclaredHostImport" => assert!(
            matches!(
                result,
                Err(OperatorHostError::RuntimeBridge(
                    RuntimeBridgeError::UndeclaredHostImport(_)
                ))
            ),
            "{name}: expected undeclared host import, got {result:?}"
        ),
        other => panic!("{name}: unsupported expectedComponentImports {other}"),
    }
}

fn assert_status_plan_expectation(
    name: &str,
    bundle: &LoadedOperatorBundle,
    entry: &serde_json::Value,
) {
    let Some(expectation) = entry
        .get("expectedStatusPlan")
        .and_then(serde_json::Value::as_str)
    else {
        return;
    };
    let owner = ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero".to_string(),
        namespace: Some("media".to_string()),
        uid: None,
        resource_version: None,
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Status {
            status: serde_json::json!({ "phase": "Ready" }),
            ref_: None,
        }],
        diagnostics: None,
    };
    let result = validate_plan_status_subresources(bundle, &owner, &plan);
    match expectation {
        "compatible" => result.unwrap_or_else(|error| {
            panic!("{name}: expected status plan compatibility, got {error}")
        }),
        "statusSubresourceUnsupported" => assert!(
            matches!(
                result,
                Err(OperatorHostError::StatusSubresourceUnsupported { .. })
            ),
            "{name}: expected unsupported status subresource, got {result:?}"
        ),
        other => panic!("{name}: unsupported expectedStatusPlan {other}"),
    }
}

fn wasm_component_with_imports(imports: &[&str]) -> Vec<u8> {
    let imports = imports
        .iter()
        .map(|import| format!(r#"(import "{import}" (func))"#))
        .collect::<Vec<_>>()
        .join(" ");
    wat::parse_str(format!("(component {imports})")).expect("component fixture parses")
}

fn compatibility_bundle(requires_runtime: &str) -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerAbi": "applik8s.handler/v1alpha1",
                "requiresRuntime": requires_runtime,
                "adapterRequirements": {
                    "hostImports": ["capability-request", "log", "cancel", "wasi:cli", "wasi:clocks", "wasi:filesystem", "wasi:io", "wasi:random", "wasi:http", "wasi:sockets"]
                }
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn rbac_bundle(permissions: Vec<serde_json::Value>) -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "permissions": permissions,
                "ownedCrds": [{
                    "apiVersion": "media.applik8s.dev/v1alpha1",
                    "kind": "ImageJob",
                    "plural": "imagejobs",
                    "versions": ["v1alpha1"],
                    "storageVersion": "v1alpha1",
                    "statusSubresource": false
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

async fn kubernetes_read_error(
    manifest: &serde_json::Value,
    request: serde_json::Value,
) -> serde_json::Value {
    let response =
        execute_kubernetes_read_request(manifest, mock_kube_client(), &request.to_string())
            .await
            .expect("read validation returns structured host response");
    let parsed: serde_json::Value =
        serde_json::from_str(&response).expect("valid read response JSON");
    assert_eq!(parsed["ok"], false);
    parsed
}

fn mock_kube_client() -> kube::Client {
    let service = tower::service_fn(|_request: http::Request<kube::client::Body>| async move {
        Err::<http::Response<kube::client::Body>, tower::BoxError>(
            std::io::Error::other("mock kube client should not be called by validation-only tests")
                .into(),
        )
    });
    kube::Client::new(service, "default")
}

fn k8s_object(
    api_version: &str,
    kind: &str,
    name: &str,
    namespace: Option<&str>,
) -> KubernetesObject {
    KubernetesObject {
        api_version: api_version.to_string(),
        kind: kind.to_string(),
        metadata: ObjectMeta {
            name: name.to_string(),
            namespace: namespace.map(str::to_string),
            uid: None,
            resource_version: None,
            generation: None,
            labels: None,
            annotations: None,
            finalizers: None,
            deletion_timestamp: None,
            creation_timestamp: None,
            extra: BTreeMap::new(),
        },
        spec: Some(serde_json::json!({})),
        status: None,
        extra: BTreeMap::new(),
    }
}

fn routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "ownedCrds": [{ "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob", "plural": "imagejobs", "scope": "Namespaced" }],
                "handlerExports": [
                    { "handlerId": "ImageJob.reconcile.0", "event": "reconcile", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.finalize.1", "event": "finalize", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.created.2", "event": "created", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.updated.3", "event": "updated", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.deleted.4", "event": "deleted", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.statusChanged.5", "event": "statusChanged", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "Invoice.reconcile.0", "event": "reconcile", "resource": { "apiVersion": "billing.applik8s.dev/v1alpha1", "kind": "Invoice" } }
                ]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn declared_finalizer_routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "ownedCrds": [{ "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob", "plural": "imagejobs", "scope": "Namespaced" }],
                "handlerExports": [
                    { "handlerId": "ImageJob.reconcile.0", "event": "reconcile", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.finalize.owned", "event": "finalize", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" }, "finalizers": ["media.applik8s.dev/imagejob"] },
                    { "handlerId": "ImageJob.deleted.0", "event": "deleted", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } }
                ]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn readme_lifecycle_routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "image-pipeline" },
            "spec": {
                "handlerExports": [
                    { "handlerId": "ImageJob.reconcile.0", "event": "reconcile", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "ImageJob.finalize.1", "event": "finalize", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" }, "finalizers": ["media.applik8s.dev/imagejob"] }
                ]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn scoped_watch_routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "platform-controller" },
            "spec": {
                "handlerExports": [
                    { "handlerId": "Deployment.updated.0", "event": "updated", "resource": { "apiVersion": "apps/v1", "kind": "Deployment" } }
                ],
                "watches": [{
                    "apiVersion": "apps/v1",
                    "kind": "Deployment",
                    "plural": "deployments",
                    "scope": "Namespaced",
                    "namespace": "apps",
                    "fieldSelector": "metadata.name=api",
                    "labelSelector": { "matchLabels": { "app.kubernetes.io/part-of": "platform" } },
                    "events": ["updated"],
                    "handlers": ["Deployment.updated.0"]
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn mixed_external_watch_and_owned_crd_routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "mixed-controller" },
            "spec": {
                "handlerExports": [
                    { "handlerId": "ImageJob.updated.0", "event": "updated", "resource": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob" } },
                    { "handlerId": "Deployment.updated.0", "event": "updated", "resource": { "apiVersion": "apps/v1", "kind": "Deployment" } }
                ],
                "ownedCrds": [{
                    "apiVersion": "media.applik8s.dev/v1alpha1",
                    "kind": "ImageJob",
                    "plural": "imagejobs",
                    "scope": "Namespaced",
                    "versions": ["v1alpha1"],
                    "storageVersion": "v1alpha1",
                    "conversionStrategy": "none",
                    "versioning": {
                        "multiVersion": "singleVersion",
                        "conversionWebhook": "notConfigured",
                        "storageMigration": "notRequired",
                        "rollbackSafety": "schemaCompatibleOnly"
                    },
                    "statusSubresource": true
                }],
                "watches": [{
                    "apiVersion": "apps/v1",
                    "kind": "Deployment",
                    "plural": "deployments",
                    "scope": "Namespaced",
                    "namespace": "apps",
                    "name": "api",
                    "events": ["updated"],
                    "handlers": ["Deployment.updated.0"]
                }]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn external_generationless_routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "external-controller" },
            "spec": {
                "handlerExports": [
                    { "handlerId": "ConfigMap.updated.0", "event": "updated", "resource": { "apiVersion": "v1", "kind": "ConfigMap" } },
                    { "handlerId": "Service.statusChanged.0", "event": "statusChanged", "resource": { "apiVersion": "v1", "kind": "Service" } }
                ],
                "ownedCrds": [],
                "watches": [
                    {
                        "apiVersion": "v1",
                        "kind": "ConfigMap",
                        "plural": "configmaps",
                        "scope": "Namespaced",
                        "namespace": "apps",
                        "name": "settings",
                        "events": ["updated"],
                        "handlers": ["ConfigMap.updated.0"]
                    },
                    {
                        "apiVersion": "v1",
                        "kind": "Service",
                        "plural": "services",
                        "scope": "Namespaced",
                        "namespace": "apps",
                        "name": "api",
                        "events": ["statusChanged"],
                        "handlers": ["Service.statusChanged.0"]
                    }
                ]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}

fn ambiguous_scoped_watch_routing_bundle() -> LoadedOperatorBundle {
    LoadedOperatorBundle {
        manifest: serde_json::json!({
            "apiVersion": "applik8s.operator/v1alpha1",
            "kind": "OperatorBundle",
            "metadata": { "name": "platform-controller" },
            "spec": {
                "handlerExports": [
                    { "handlerId": "Deployment.updated.exact", "event": "updated", "resource": { "apiVersion": "apps/v1", "kind": "Deployment" } },
                    { "handlerId": "Deployment.updated.selector", "event": "updated", "resource": { "apiVersion": "apps/v1", "kind": "Deployment" } }
                ],
                "watches": [
                    {
                        "apiVersion": "apps/v1",
                        "kind": "Deployment",
                        "plural": "deployments",
                        "scope": "Namespaced",
                        "namespace": "apps",
                        "name": "api",
                        "events": ["updated"],
                        "handlers": ["Deployment.updated.exact"]
                    },
                    {
                        "apiVersion": "apps/v1",
                        "kind": "Deployment",
                        "plural": "deployments",
                        "scope": "Namespaced",
                        "namespace": "apps",
                        "labelSelector": { "matchLabels": { "app.kubernetes.io/part-of": "platform" } },
                        "events": ["updated"],
                        "handlers": ["Deployment.updated.selector"]
                    }
                ]
            }
        }),
        handler_wasm: vec![0, 97, 115, 109],
    }
}
