use applik8s_runtime_bridge::{
    AppliedOperationSummary, KubeOperationPlanApplier, KubeRuntimeBridge, OperationProgress,
    RuntimeBridgeError, component_model_engine,
    invoke_handler_component_bytes_with_timeout_and_capabilities_async,
    validate_component_host_imports,
};
use applik8s_runtime_contract::{ApplyOwnership, NormalizedOperationPlan, ObjectRef, Operation};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use backoff::{ExponentialBackoffBuilder, backoff::Backoff};
use chrono::{SecondsFormat, Utc};
use flate2::read::GzDecoder;
use futures::{FutureExt, StreamExt, future::join_all};
use k8s_openapi::api::core::v1::Secret;
use kube::Client;
use kube::api::{Api, DynamicObject};
use kube::core::dynamic::ApiResource;
use kube::core::gvk::GroupVersionKind;
use kube::runtime::controller::{Action, Controller};
use kube::runtime::watcher;
use kube_lease_manager::{LeaseManagerBuilder, LeaseManagerError};
use opentelemetry::global::BoxedSpan;
use opentelemetry::metrics::{Counter, Histogram};
use opentelemetry::trace::{Span as OtelSpan, Status as OtelStatus, Tracer};
use opentelemetry::{KeyValue, global};
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::trace::SdkTracerProvider;
use semver::{Version, VersionReq};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::io::Read;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;
use std::time::Instant;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::{Level, event};
use tracing_subscriber::EnvFilter;

const SUPPORTED_HANDLER_ABI: &str = "applik8s.handler/v1alpha1";
const SUPPORTED_OPERATOR_MANIFEST_VERSION: &str = "applik8s.operator/v1alpha1";
static RECONCILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct OperatorHostConfig {
    pub runtime_version: String,
    pub metrics_enabled: bool,
    pub health_enabled: bool,
    pub replay_artifact_dir: Option<PathBuf>,
    pub replay_include_payloads: bool,
}

pub struct OperatorHostPaths {
    pub manifest_path: PathBuf,
    pub handler_path: PathBuf,
    pub handler_chunks_dir: Option<PathBuf>,
}

#[derive(Clone)]
pub struct LoadedOperatorBundle {
    pub manifest: Value,
    pub handler_wasm: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnedResourceWatch {
    pub api_version: String,
    pub kind: String,
    pub plural: String,
    pub scope: String,
    pub namespace: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandlerRoute {
    pub handler_id: String,
    pub event: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusConvention {
    pub observed_generation_field: String,
    pub conditions_field: String,
}

impl Default for StatusConvention {
    fn default() -> Self {
        Self {
            observed_generation_field: "observedGeneration".to_string(),
            conditions_field: "conditions".to_string(),
        }
    }
}

pub struct RuntimeController {
    pub watch: OwnedResourceWatch,
    pub controller: Controller<DynamicObject>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeLeaderElectionConfig {
    pub lease_name: String,
    pub lease_namespace: Option<String>,
    pub lease_duration_seconds: u64,
    pub renew_deadline_seconds: u64,
    pub retry_period_seconds: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetryPolicy {
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub max_retries: Option<u32>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            base_delay: Duration::from_secs(5),
            max_delay: Duration::from_secs(300),
            max_retries: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetryDecision {
    pub attempt: u32,
    pub delay: Duration,
    pub exhausted: bool,
}

pub struct ReplayArtifactContext<'a> {
    pub operator_name: &'a str,
    pub handler_route: &'a HandlerRoute,
    pub owner: &'a ObjectRef,
    pub reconcile_id: &'a str,
    pub bundle_digest: &'a str,
    pub runtime_version: &'a str,
    pub phase: &'a str,
    pub error: &'a OperatorHostError,
    pub input: &'a Value,
    pub plan: Option<&'a NormalizedOperationPlan>,
    pub bundle_artifacts: Option<&'a Value>,
    pub include_payloads: bool,
    pub created_at: &'a str,
}

#[derive(Clone)]
pub struct OperatorMetrics {
    reconcile_total: Counter<u64>,
    reconcile_failures_total: Counter<u64>,
    reconcile_duration_seconds: Histogram<f64>,
    operation_total: Counter<u64>,
    retry_total: Counter<u64>,
}

impl OperatorMetrics {
    pub fn new() -> Self {
        let meter = global::meter("applik8s.operator_host");
        Self {
            reconcile_total: meter
                .u64_counter("applik8s_reconcile_total")
                .with_description("Total reconciliations observed by the operator host.")
                .build(),
            reconcile_failures_total: meter
                .u64_counter("applik8s_reconcile_failures_total")
                .with_description("Total failed reconciliations observed by the operator host.")
                .build(),
            reconcile_duration_seconds: meter
                .f64_histogram("applik8s_reconcile_duration_seconds")
                .with_description("Reconcile duration in seconds.")
                .with_unit("s")
                .build(),
            operation_total: meter
                .u64_counter("applik8s_operations_total")
                .with_description("Total Kubernetes operation effects applied by kind.")
                .build(),
            retry_total: meter
                .u64_counter("applik8s_reconcile_retries_total")
                .with_description("Total reconcile retries scheduled by the operator host.")
                .build(),
        }
    }

    pub fn record_reconcile_start(&self, operator_name: &str, handler_route: &HandlerRoute) {
        self.reconcile_total
            .add(1, &metric_attrs(operator_name, handler_route, "started"));
    }

    pub fn record_reconcile_success(
        &self,
        operator_name: &str,
        handler_route: &HandlerRoute,
        duration_seconds: f64,
        summary: &AppliedOperationSummary,
    ) {
        let attrs = metric_attrs(operator_name, handler_route, "succeeded");
        self.reconcile_duration_seconds
            .record(duration_seconds, &attrs);
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "apply",
            summary.applied,
        );
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "patch",
            summary.patched,
        );
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "delete",
            summary.deleted,
        );
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "status",
            summary.status_patched,
        );
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "event",
            summary.events_recorded,
        );
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "finalizer",
            summary.finalizers_mutated,
        );
        record_operation_count(
            &self.operation_total,
            operator_name,
            handler_route,
            "requeue",
            summary.requeued,
        );
    }

    pub fn record_reconcile_failure(
        &self,
        operator_name: &str,
        handler_route: &HandlerRoute,
        duration_seconds: f64,
        reason: &str,
    ) {
        let attrs = metric_attrs(operator_name, handler_route, "failed");
        self.reconcile_duration_seconds
            .record(duration_seconds, &attrs);
        self.reconcile_failures_total.add(
            1,
            &[
                KeyValue::new("operator", operator_name.to_string()),
                KeyValue::new("handler_id", handler_route.handler_id.clone()),
                KeyValue::new("event", handler_route.event.clone()),
                KeyValue::new("reason", reason.to_string()),
            ],
        );
    }

    pub fn record_retry(
        &self,
        operator_name: &str,
        attempt: u32,
        delay: Duration,
        exhausted: bool,
    ) {
        self.retry_total.add(
            1,
            &[
                KeyValue::new("operator", operator_name.to_string()),
                KeyValue::new("attempt", i64::from(attempt)),
                KeyValue::new("delay_ms", delay.as_millis() as i64),
                KeyValue::new("exhausted", exhausted),
            ],
        );
    }
}

impl Default for OperatorMetrics {
    fn default() -> Self {
        Self::new()
    }
}

fn metric_attrs(operator_name: &str, handler_route: &HandlerRoute, result: &str) -> Vec<KeyValue> {
    vec![
        KeyValue::new("operator", operator_name.to_string()),
        KeyValue::new("handler_id", handler_route.handler_id.clone()),
        KeyValue::new("event", handler_route.event.clone()),
        KeyValue::new("result", result.to_string()),
    ]
}

fn record_operation_count(
    counter: &Counter<u64>,
    operator_name: &str,
    handler_route: &HandlerRoute,
    kind: &str,
    count: usize,
) {
    if count == 0 {
        return;
    }
    counter.add(
        count as u64,
        &[
            KeyValue::new("operator", operator_name.to_string()),
            KeyValue::new("handler_id", handler_route.handler_id.clone()),
            KeyValue::new("event", handler_route.event.clone()),
            KeyValue::new("kind", kind.to_string()),
        ],
    );
}

#[derive(Debug, Error)]
pub enum OperatorHostError {
    #[error("failed to read {path}: {source}")]
    ReadFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("operator manifest JSON is invalid: {0}")]
    InvalidManifestJson(serde_json::Error),
    #[error("operator manifest must be kind OperatorBundle")]
    InvalidManifestKind,
    #[error("operator manifest version declaration is invalid: {0}")]
    InvalidManifestVersion(String),
    #[error("operator bundle requires manifest version {required}, but host supports {supported}")]
    UnsupportedManifestVersion { required: String, supported: String },
    #[error("handler artifact is empty")]
    EmptyHandlerArtifact,
    #[error("handler artifact chunks directory is invalid: {0}")]
    InvalidHandlerChunks(String),
    #[error("operator manifest is missing spec.ownedCrds")]
    MissingOwnedCrds,
    #[error("owned CRD entry is invalid: {0}")]
    InvalidOwnedCrd(String),
    #[error("no reconcile handler is registered for {api_version}/{kind}")]
    HandlerNotFound { api_version: String, kind: String },
    #[error("operator bundle requires runtime {required}, but host runtime is {actual}")]
    IncompatibleRuntime { required: String, actual: String },
    #[error("operator bundle runtime compatibility declaration is invalid: {0}")]
    InvalidRuntimeRequirement(String),
    #[error("operator bundle handler ABI declaration is invalid: {0}")]
    InvalidHandlerAbi(String),
    #[error("operator bundle requires handler ABI {required}, but host supports {supported}")]
    UnsupportedHandlerAbi { required: String, supported: String },
    #[error("operator bundle runtime adapter requirement is invalid: {0}")]
    InvalidRuntimeAdapterRequirement(String),
    #[error("operator bundle runtime configuration is invalid: {0}")]
    InvalidRuntimeConfig(String),
    #[error("operation plan requires undeclared RBAC permission: {0}")]
    UndeclaredPermission(String),
    #[error("handler {handler_id} attempted to mutate undeclared finalizer {finalizer}")]
    UndeclaredFinalizer {
        handler_id: String,
        finalizer: String,
    },
    #[error("status subresource is not declared for {api_version}/{kind}")]
    StatusSubresourceUnsupported { api_version: String, kind: String },
    #[error("runtime bridge failed: {0}")]
    RuntimeBridge(#[from] RuntimeBridgeError),
    #[error("runtime JSON conversion failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("kubernetes client failed: {0}")]
    Kubernetes(#[from] kube::Error),
    #[error("leader election failed: {0}")]
    LeaderElection(#[from] LeaseManagerError),
    #[error("controller stopped while leadership was held")]
    ControllerStopped,
    #[error("operator health server failed: {0}")]
    HealthServer(std::io::Error),
}

pub struct KubeRuntimeControllerStrategy {
    pub framework: &'static str,
}

#[derive(Clone)]
pub struct OperatorHost {
    bridge: KubeRuntimeBridge,
    config: OperatorHostConfig,
    metrics: OperatorMetrics,
    retry_attempts: Arc<Mutex<HashMap<String, u32>>>,
}

impl OperatorHost {
    pub fn new(bridge: KubeRuntimeBridge, config: OperatorHostConfig) -> Self {
        Self {
            bridge,
            config,
            metrics: OperatorMetrics::new(),
            retry_attempts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn bridge(&self) -> &KubeRuntimeBridge {
        &self.bridge
    }

    pub fn config(&self) -> &OperatorHostConfig {
        &self.config
    }

    pub fn controller_strategy(&self) -> KubeRuntimeControllerStrategy {
        KubeRuntimeControllerStrategy::default()
    }

    pub fn retry_action(
        &self,
        bundle: &LoadedOperatorBundle,
        object: &DynamicObject,
        error: &OperatorHostError,
    ) -> Action {
        let operator_name = bundle
            .manifest
            .pointer("/metadata/name")
            .and_then(Value::as_str)
            .unwrap_or("applik8s-operator");
        let object_json = match serde_json::to_value(object) {
            Ok(object_json) => object_json,
            Err(error) => {
                emit_log_event(retry_log_event(
                    operator_name,
                    "unknown",
                    &RetryDecision {
                        attempt: 1,
                        delay: Duration::from_secs(30),
                        exhausted: false,
                    },
                    &format!("failed to serialize object for retry policy: {error}"),
                ));
                return Action::requeue(Duration::from_secs(30));
            }
        };
        let owner = match object_ref_from_value(&object_json) {
            Ok(owner) => owner,
            Err(error) => {
                emit_log_event(retry_log_event(
                    operator_name,
                    "unknown",
                    &RetryDecision {
                        attempt: 1,
                        delay: Duration::from_secs(30),
                        exhausted: false,
                    },
                    &format!("failed to resolve object ref for retry policy: {error}"),
                ));
                return Action::requeue(Duration::from_secs(30));
            }
        };
        let policy = match bundle.retry_policy() {
            Ok(policy) => policy,
            Err(error) => {
                emit_log_event(retry_log_event(
                    operator_name,
                    &retry_state_key(&owner),
                    &RetryDecision {
                        attempt: 1,
                        delay: Duration::from_secs(30),
                        exhausted: false,
                    },
                    &format!("invalid retry policy, using safe fallback: {error}"),
                ));
                RetryPolicy::default()
            }
        };
        let decision = self.record_retry_attempt(&owner, &policy);
        self.metrics.record_retry(
            operator_name,
            decision.attempt,
            decision.delay,
            decision.exhausted,
        );
        emit_log_event(retry_log_event(
            operator_name,
            &retry_state_key(&owner),
            &decision,
            &error.to_string(),
        ));
        if decision.exhausted {
            let retry_key = retry_state_key(&owner);
            if let Err(report_error) = self.spawn_retry_exhausted_status_report(
                bundle,
                object_json,
                copy_object_ref(&owner),
                error.to_string(),
                decision.attempt,
            ) {
                event!(
                    Level::WARN,
                    error = %report_error,
                    retry_key = retry_key,
                    "failed to schedule retry exhaustion status report"
                );
            }
            Action::await_change()
        } else {
            Action::requeue(decision.delay)
        }
    }

    fn spawn_retry_exhausted_status_report(
        &self,
        bundle: &LoadedOperatorBundle,
        object_json: Value,
        owner: ObjectRef,
        error_message: String,
        attempt: u32,
    ) -> Result<(), OperatorHostError> {
        let api_version = object_json
            .get("apiVersion")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidOwnedCrd("object missing apiVersion".to_string())
            })?;
        let kind = object_json
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| OperatorHostError::InvalidOwnedCrd("object missing kind".to_string()))?;
        let Some(status_convention) = bundle.status_convention_for_object(api_version, kind)?
        else {
            return Ok(());
        };
        let watches = bundle.owned_resource_watches()?;
        let client = self.bridge.client().clone();
        tokio::spawn(async move {
            let mut applier = KubeOperationPlanApplier::new(client, "applik8s-status-lifecycle")
                .with_force_status(true);
            for watch in watches {
                applier = applier.with_resource_plural(watch.api_version, watch.kind, watch.plural);
            }
            let status = retry_exhausted_status(
                &object_json,
                &status_convention,
                &error_message,
                attempt,
                &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            );
            let plan = NormalizedOperationPlan {
                operations: vec![Operation::Status { status, ref_: None }],
                diagnostics: None,
            };
            if let Err(error) = applier.apply_plan(&owner, &plan).await {
                event!(
                    Level::WARN,
                    error = %error,
                    owner = retry_state_key(&owner),
                    "failed to write retry exhaustion status"
                );
            }
        });
        Ok(())
    }

    fn record_retry_attempt(&self, owner: &ObjectRef, policy: &RetryPolicy) -> RetryDecision {
        let key = retry_state_key(owner);
        let mut attempts = self
            .retry_attempts
            .lock()
            .expect("retry state lock poisoned");
        let attempt = attempts.get(&key).copied().unwrap_or(0).saturating_add(1);
        attempts.insert(key, attempt);
        retry_decision(policy, attempt)
    }

    fn clear_retry_state(&self, owner: &ObjectRef) {
        let key = retry_state_key(owner);
        if let Ok(mut attempts) = self.retry_attempts.lock() {
            attempts.remove(&key);
        }
    }

    fn emit_replay_artifact(&self, context: ReplayArtifactContext<'_>) {
        let Some(directory) = &self.config.replay_artifact_dir else {
            return;
        };
        let artifact = replay_artifact(&context);
        match write_replay_artifact(directory, &artifact) {
            Ok(path) => emit_log_event(serde_json::json!({
                "level": "warn",
                "message": "reconcile replay artifact written",
                "operatorName": context.operator_name,
                "handlerId": context.handler_route.handler_id,
                "event": context.handler_route.event,
                "objectRef": context.owner,
                "reconcileId": context.reconcile_id,
                "bundleDigest": context.bundle_digest,
                "runtimeVersion": context.runtime_version,
                "handlerAbi": SUPPORTED_HANDLER_ABI,
                "replayArtifactPath": path.display().to_string(),
            })),
            Err(error) => event!(
                Level::WARN,
                error = %error,
                reconcile_id = context.reconcile_id,
                handler_abi = SUPPORTED_HANDLER_ABI,
                "failed to write reconcile replay artifact"
            ),
        }
    }

    pub async fn reconcile_dynamic_object(
        &self,
        bundle: &LoadedOperatorBundle,
        object: DynamicObject,
    ) -> Result<Action, OperatorHostError> {
        bundle.validate_runtime_compatibility(&self.config.runtime_version)?;
        let object_json = serde_json::to_value(&object)?;
        let api_version = object_json
            .get("apiVersion")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidOwnedCrd("object missing apiVersion".to_string())
            })?;
        let kind = object_json
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| OperatorHostError::InvalidOwnedCrd("object missing kind".to_string()))?;
        let owner = object_ref_from_value(&object_json)?;
        let handler_route = bundle.handler_route_for_object(api_version, kind, &object_json)?;
        let status_convention = bundle.status_convention_for_object(api_version, kind)?;
        let operator_name = bundle
            .manifest
            .pointer("/metadata/name")
            .and_then(Value::as_str)
            .unwrap_or("applik8s-operator");
        let bundle_digest = bundle
            .manifest
            .pointer("/spec/bundle/digest")
            .and_then(Value::as_str)
            .unwrap_or("sha256:0000000000000000000000000000000000000000000000000000000000000000");
        let (reconcile_id, reconcile_started_at_timestamp) = reconcile_metadata(&owner);
        let reconcile_started_at = Instant::now();
        self.metrics
            .record_reconcile_start(operator_name, &handler_route);
        let start_event = reconcile_log_event(
            "info",
            "reconcile started",
            operator_name,
            &handler_route,
            &owner,
            &reconcile_id,
            bundle_digest,
            &self.config.runtime_version,
            None,
            None,
            None,
        );
        let mut reconcile_span = start_reconcile_otel_span(&start_event);
        emit_log_event(start_event);
        let mut applier = KubeOperationPlanApplier::new(self.bridge.client().clone(), "applik8s");
        for watch in bundle.owned_resource_watches()? {
            applier = applier.with_resource_plural(watch.api_version, watch.kind, watch.plural);
        }
        let status_applier = applier
            .with_field_manager("applik8s-status-lifecycle")
            .with_force_status(true);
        if let Some(status_convention) = status_convention.as_ref() {
            report_reconcile_stale_status(
                &status_applier,
                &owner,
                &object_json,
                status_convention,
                operator_name,
                &handler_route,
                &reconcile_id,
                bundle_digest,
                &self.config.runtime_version,
            )
            .await;
        }
        let input = serde_json::json!({
            "abiVersion": SUPPORTED_HANDLER_ABI,
            "handlerId": handler_route.handler_id,
            "event": handler_route.event,
            "object": object_json.clone(),
            "capabilities": bundle.manifest.pointer("/spec/capabilities").cloned().unwrap_or_else(|| serde_json::json!({})),
            "runtime": {
                "operatorName": operator_name,
                "reconcileId": reconcile_id,
                "bundleDigest": bundle_digest,
                "runtimeVersion": self.config.runtime_version.as_str(),
                "startedAt": reconcile_started_at_timestamp
            }
        });
        let allowed_host_imports = bundle.allowed_host_imports()?;
        let handler_timeout = bundle.handler_timeout()?;
        let source_map_path = handler_source_map_path(&bundle.manifest);
        let capability_manifest = bundle.manifest.clone();
        let capability_secret_resolver = kubernetes_secret_resolver(
            self.bridge.client().clone(),
            std::env::var("APPLIK8S_POD_NAMESPACE").ok(),
        );
        let capability_handler = Arc::new(move |request_json: String| {
            let manifest = capability_manifest.clone();
            let secret_resolver = Arc::clone(&capability_secret_resolver);
            Box::pin(async move {
                execute_capability_request_with_secret_resolver(
                    &manifest,
                    &request_json,
                    Some(secret_resolver),
                )
                .await
            }) as applik8s_runtime_bridge::CapabilityRequestFuture
        });
        record_reconcile_otel_phase(&mut reconcile_span, "handler.invoke");
        let plan = match invoke_handler_component_bytes_with_timeout_and_capabilities_async(
            self.bridge.engine(),
            &bundle.handler_wasm,
            input.clone(),
            &allowed_host_imports,
            handler_timeout,
            capability_handler,
        )
        .await
        {
            Ok(plan) => {
                record_reconcile_otel_phase(&mut reconcile_span, "handler.succeeded");
                plan
            }
            Err(error) => {
                let error = OperatorHostError::from(error);
                self.metrics.record_reconcile_failure(
                    operator_name,
                    &handler_route,
                    reconcile_started_at.elapsed().as_secs_f64(),
                    reconcile_failure_reason(&error),
                );
                let failure_event = reconcile_log_event(
                    "error",
                    "reconcile failed",
                    operator_name,
                    &handler_route,
                    &owner,
                    &reconcile_id,
                    bundle_digest,
                    &self.config.runtime_version,
                    None,
                    Some(&error.to_string()),
                    reconcile_error_details_with_source_map(&error, source_map_path.as_deref()),
                );
                finish_reconcile_otel_span(&mut reconcile_span, &failure_event, "handler.failed");
                emit_log_event(failure_event);
                self.emit_replay_artifact(ReplayArtifactContext {
                    operator_name,
                    handler_route: &handler_route,
                    owner: &owner,
                    reconcile_id: &reconcile_id,
                    bundle_digest,
                    runtime_version: &self.config.runtime_version,
                    phase: "handlerInvocation",
                    error: &error,
                    input: &input,
                    plan: None,
                    bundle_artifacts: bundle.manifest.pointer("/spec/bundle/artifacts"),
                    include_payloads: self.config.replay_include_payloads,
                    created_at: &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
                });
                if let Some(status_convention) = status_convention.as_ref() {
                    report_reconcile_failure_status(
                        &status_applier,
                        &owner,
                        &object_json,
                        status_convention,
                        &error,
                        operator_name,
                        &handler_route,
                        &reconcile_id,
                        bundle_digest,
                        &self.config.runtime_version,
                    )
                    .await;
                }
                return Err(error);
            }
        };
        record_reconcile_otel_phase(&mut reconcile_span, "plan.validate");
        if let Err(error) = validate_plan_status_subresources(bundle, &owner, &plan)
            .and_then(|_| validate_plan_finalizer_ownership(bundle, &handler_route, &plan))
            .and_then(|_| validate_plan_rbac(bundle, &owner, &plan))
        {
            self.metrics.record_reconcile_failure(
                operator_name,
                &handler_route,
                reconcile_started_at.elapsed().as_secs_f64(),
                reconcile_failure_reason(&error),
            );
            let failure_event = reconcile_log_event(
                "error",
                "reconcile failed",
                operator_name,
                &handler_route,
                &owner,
                &reconcile_id,
                bundle_digest,
                &self.config.runtime_version,
                None,
                Some(&error.to_string()),
                reconcile_error_details_with_source_map(&error, source_map_path.as_deref()),
            );
            finish_reconcile_otel_span(&mut reconcile_span, &failure_event, "plan.invalid");
            emit_log_event(failure_event);
            self.emit_replay_artifact(ReplayArtifactContext {
                operator_name,
                handler_route: &handler_route,
                owner: &owner,
                reconcile_id: &reconcile_id,
                bundle_digest,
                runtime_version: &self.config.runtime_version,
                phase: "planValidation",
                error: &error,
                input: &input,
                plan: Some(&plan),
                bundle_artifacts: bundle.manifest.pointer("/spec/bundle/artifacts"),
                include_payloads: self.config.replay_include_payloads,
                created_at: &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            });
            if let Some(status_convention) = status_convention.as_ref() {
                report_reconcile_failure_status(
                    &status_applier,
                    &owner,
                    &object_json,
                    status_convention,
                    &error,
                    operator_name,
                    &handler_route,
                    &reconcile_id,
                    bundle_digest,
                    &self.config.runtime_version,
                )
                .await;
            }
            return Err(error);
        }
        record_reconcile_otel_phase(&mut reconcile_span, "plan.validated");
        record_reconcile_otel_phase(&mut reconcile_span, "operations.apply");
        let summary = match applier.apply_plan(&owner, &plan).await {
            Ok(summary) => {
                record_reconcile_otel_phase(&mut reconcile_span, "operations.applied");
                summary
            }
            Err(error) => {
                let error = OperatorHostError::from(error);
                self.metrics.record_reconcile_failure(
                    operator_name,
                    &handler_route,
                    reconcile_started_at.elapsed().as_secs_f64(),
                    reconcile_failure_reason(&error),
                );
                let failure_event = reconcile_log_event(
                    "error",
                    "reconcile failed",
                    operator_name,
                    &handler_route,
                    &owner,
                    &reconcile_id,
                    bundle_digest,
                    &self.config.runtime_version,
                    None,
                    Some(&error.to_string()),
                    reconcile_error_details_with_source_map(&error, source_map_path.as_deref()),
                );
                finish_reconcile_otel_span(
                    &mut reconcile_span,
                    &failure_event,
                    "operations.failed",
                );
                emit_log_event(failure_event);
                self.emit_replay_artifact(ReplayArtifactContext {
                    operator_name,
                    handler_route: &handler_route,
                    owner: &owner,
                    reconcile_id: &reconcile_id,
                    bundle_digest,
                    runtime_version: &self.config.runtime_version,
                    phase: "operationApplication",
                    error: &error,
                    input: &input,
                    plan: Some(&plan),
                    bundle_artifacts: bundle.manifest.pointer("/spec/bundle/artifacts"),
                    include_payloads: self.config.replay_include_payloads,
                    created_at: &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
                });
                if let Some(status_convention) = status_convention.as_ref() {
                    report_reconcile_failure_status(
                        &status_applier,
                        &owner,
                        &object_json,
                        status_convention,
                        &error,
                        operator_name,
                        &handler_route,
                        &reconcile_id,
                        bundle_digest,
                        &self.config.runtime_version,
                    )
                    .await;
                }
                return Err(error);
            }
        };
        if let Some(status_convention) = status_convention.as_ref() {
            report_reconcile_success_status(
                &status_applier,
                &owner,
                &object_json,
                status_convention,
                operator_name,
                &handler_route,
                &reconcile_id,
                bundle_digest,
                &self.config.runtime_version,
            )
            .await;
        }
        let success_event = reconcile_log_event(
            "info",
            "reconcile succeeded",
            operator_name,
            &handler_route,
            &owner,
            &reconcile_id,
            bundle_digest,
            &self.config.runtime_version,
            Some(&summary),
            None,
            None,
        );
        finish_reconcile_otel_span(&mut reconcile_span, &success_event, "succeeded");
        emit_log_event(success_event);
        self.metrics.record_reconcile_success(
            operator_name,
            &handler_route,
            reconcile_started_at.elapsed().as_secs_f64(),
            &summary,
        );
        self.clear_retry_state(&owner);

        Ok(action_for_plan(&plan))
    }
}

pub fn reconcile_log_event(
    level: &str,
    message: &str,
    operator_name: &str,
    handler_route: &HandlerRoute,
    owner: &ObjectRef,
    reconcile_id: &str,
    bundle_digest: &str,
    runtime_version: &str,
    summary: Option<&AppliedOperationSummary>,
    error: Option<&str>,
    error_details: Option<Value>,
) -> Value {
    let mut event = serde_json::json!({
        "level": level,
        "message": message,
        "operatorName": operator_name,
        "handlerId": handler_route.handler_id,
        "event": handler_route.event,
        "objectRef": owner,
        "reconcileId": reconcile_id,
        "bundleDigest": bundle_digest,
        "runtimeVersion": runtime_version,
        "handlerAbi": SUPPORTED_HANDLER_ABI,
    });
    if let Some(summary) = summary {
        event["operationSummary"] = serde_json::json!({
            "applied": summary.applied,
            "patched": summary.patched,
            "deleted": summary.deleted,
            "statusPatched": summary.status_patched,
            "eventsRecorded": summary.events_recorded,
            "finalizersMutated": summary.finalizers_mutated,
            "requeued": summary.requeued,
        });
    }
    if let Some(error) = error {
        event["error"] = Value::String(error.to_string());
    }
    if let Some(error_details) = error_details {
        event["errorDetails"] = error_details;
    }
    event
}

pub fn reconcile_trace_dimensions(log_event: &Value) -> Value {
    serde_json::json!({
        "operatorName": log_event.pointer("/operatorName").and_then(Value::as_str).unwrap_or(""),
        "handlerId": log_event.pointer("/handlerId").and_then(Value::as_str).unwrap_or(""),
        "handlerEvent": log_event.pointer("/event").and_then(Value::as_str).unwrap_or(""),
        "reconcileId": log_event.pointer("/reconcileId").and_then(Value::as_str).unwrap_or(""),
        "bundleDigest": log_event.pointer("/bundleDigest").and_then(Value::as_str).unwrap_or(""),
        "runtimeVersion": log_event.pointer("/runtimeVersion").and_then(Value::as_str).unwrap_or(""),
        "handlerAbi": log_event.pointer("/handlerAbi").and_then(Value::as_str).unwrap_or(""),
        "resourceApiVersion": log_event.pointer("/objectRef/apiVersion").and_then(Value::as_str).unwrap_or(""),
        "resourceKind": log_event.pointer("/objectRef/kind").and_then(Value::as_str).unwrap_or(""),
        "resourceNamespace": log_event.pointer("/objectRef/namespace").and_then(Value::as_str).unwrap_or(""),
        "resourceName": log_event.pointer("/objectRef/name").and_then(Value::as_str).unwrap_or(""),
        "objectKey": log_event.pointer("/objectKey").and_then(Value::as_str).unwrap_or(""),
        "failureReason": log_event.pointer("/error").and_then(Value::as_str).unwrap_or(""),
        "operationKind": log_event.pointer("/errorDetails/operation/kind").and_then(Value::as_str).unwrap_or(""),
        "operationIndex": log_event.pointer("/errorDetails/operation/index").and_then(Value::as_u64).unwrap_or_default(),
        "retryAttempt": log_event.pointer("/retry/attempt").and_then(Value::as_u64).unwrap_or_default(),
        "retryDelayMs": log_event.pointer("/retry/delayMs").and_then(Value::as_u64).unwrap_or_default(),
        "retryExhausted": log_event.pointer("/retry/exhausted").and_then(Value::as_bool).unwrap_or_default(),
        "operationsApplied": log_event.pointer("/operationSummary/applied").and_then(Value::as_u64).unwrap_or_default(),
        "operationsPatched": log_event.pointer("/operationSummary/patched").and_then(Value::as_u64).unwrap_or_default(),
        "operationsDeleted": log_event.pointer("/operationSummary/deleted").and_then(Value::as_u64).unwrap_or_default(),
        "operationsStatusPatched": log_event.pointer("/operationSummary/statusPatched").and_then(Value::as_u64).unwrap_or_default(),
        "operationsEventsRecorded": log_event.pointer("/operationSummary/eventsRecorded").and_then(Value::as_u64).unwrap_or_default(),
        "operationsFinalizersMutated": log_event.pointer("/operationSummary/finalizersMutated").and_then(Value::as_u64).unwrap_or_default(),
        "operationsRequeued": log_event.pointer("/operationSummary/requeued").and_then(Value::as_u64).unwrap_or_default(),
    })
}

pub fn reconcile_otel_attributes(log_event: &Value) -> Vec<KeyValue> {
    let mut attributes = Vec::new();
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.operator.name",
        log_event.pointer("/operatorName"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.handler.id",
        log_event.pointer("/handlerId"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.handler.event",
        log_event.pointer("/event"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.reconcile.id",
        log_event.pointer("/reconcileId"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.bundle.digest",
        log_event.pointer("/bundleDigest"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.runtime.version",
        log_event.pointer("/runtimeVersion"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.handler.abi",
        log_event.pointer("/handlerAbi"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "k8s.resource.api_version",
        log_event.pointer("/objectRef/apiVersion"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "k8s.resource.kind",
        log_event.pointer("/objectRef/kind"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "k8s.namespace.name",
        log_event.pointer("/objectRef/namespace"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "k8s.resource.name",
        log_event.pointer("/objectRef/name"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.object.key",
        log_event.pointer("/objectKey"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.failure.reason",
        log_event.pointer("/error"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.failure.type",
        log_event.pointer("/errorDetails/type"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.operation.kind",
        log_event.pointer("/errorDetails/operation/kind"),
    );
    push_otel_string_attribute(
        &mut attributes,
        "applik8s.operation.target",
        log_event.pointer("/errorDetails/operation/target"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operation.index",
        log_event.pointer("/errorDetails/operation/index"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.retry.attempt",
        log_event.pointer("/retry/attempt"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.retry.delay_ms",
        log_event.pointer("/retry/delayMs"),
    );
    push_otel_bool_attribute(
        &mut attributes,
        "applik8s.retry.exhausted",
        log_event.pointer("/retry/exhausted"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.applied",
        log_event.pointer("/operationSummary/applied"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.patched",
        log_event.pointer("/operationSummary/patched"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.deleted",
        log_event.pointer("/operationSummary/deleted"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.status_patched",
        log_event.pointer("/operationSummary/statusPatched"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.events_recorded",
        log_event.pointer("/operationSummary/eventsRecorded"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.finalizers_mutated",
        log_event.pointer("/operationSummary/finalizersMutated"),
    );
    push_otel_i64_attribute(
        &mut attributes,
        "applik8s.operations.requeued",
        log_event.pointer("/operationSummary/requeued"),
    );
    attributes
}

fn push_otel_string_attribute(
    attributes: &mut Vec<KeyValue>,
    key: &'static str,
    value: Option<&Value>,
) {
    if let Some(value) = value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        attributes.push(KeyValue::new(key, value.to_string()));
    }
}

fn push_otel_i64_attribute(
    attributes: &mut Vec<KeyValue>,
    key: &'static str,
    value: Option<&Value>,
) {
    if let Some(value) = value.and_then(Value::as_i64) {
        attributes.push(KeyValue::new(key, value));
    }
}

fn push_otel_bool_attribute(
    attributes: &mut Vec<KeyValue>,
    key: &'static str,
    value: Option<&Value>,
) {
    if let Some(value) = value.and_then(Value::as_bool) {
        attributes.push(KeyValue::new(key, value));
    }
}

fn start_reconcile_otel_span(start_event: &Value) -> BoxedSpan {
    let tracer = global::tracer("applik8s.operator_host");
    let mut span = tracer.start("applik8s.reconcile");
    for attribute in reconcile_otel_attributes(start_event) {
        span.set_attribute(attribute);
    }
    span.add_event("applik8s.reconcile.started", Vec::new());
    span
}

fn record_reconcile_otel_phase(span: &mut BoxedSpan, phase: &'static str) {
    span.add_event(
        format!("applik8s.{phase}"),
        vec![KeyValue::new("applik8s.phase", phase)],
    );
}

fn finish_reconcile_otel_span(span: &mut BoxedSpan, outcome_event: &Value, phase: &'static str) {
    for attribute in reconcile_otel_attributes(outcome_event) {
        span.set_attribute(attribute);
    }
    span.set_attribute(KeyValue::new("applik8s.phase", phase));
    if let Some(error) = outcome_event.get("error").and_then(Value::as_str) {
        span.set_status(OtelStatus::error(error.to_string()));
        span.add_event(
            "exception",
            vec![
                KeyValue::new("exception.message", error.to_string()),
                KeyValue::new("applik8s.phase", phase),
            ],
        );
    } else {
        span.set_status(OtelStatus::Ok);
    }
    span.add_event(
        format!("applik8s.reconcile.{phase}"),
        vec![KeyValue::new("applik8s.phase", phase)],
    );
    span.end();
}

pub fn reconcile_metadata(owner: &ObjectRef) -> (String, String) {
    let started_at = Utc::now();
    let timestamp = started_at.to_rfc3339_opts(SecondsFormat::Millis, true);
    let unique = started_at.timestamp_nanos_opt().unwrap_or_default();
    let sequence = RECONCILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let namespace = owner.namespace.as_deref().unwrap_or("cluster");
    (
        format!(
            "{}-{}-{}-{unique}-{sequence}",
            owner.kind, namespace, owner.name
        ),
        timestamp,
    )
}

pub fn replay_artifact(context: &ReplayArtifactContext<'_>) -> Value {
    let mut artifact = serde_json::json!({
        "apiVersion": "applik8s.dev/v1alpha1",
        "kind": "ReplayArtifact",
        "metadata": {
            "replayId": replay_id(context.reconcile_id, context.phase, context.created_at),
            "createdAt": context.created_at,
            "redaction": {
                "policy": if context.include_payloads { "full-payload" } else { "metadata-only" },
                "defaultRedacted": !context.include_payloads,
            }
        },
        "runtime": {
            "operatorName": context.operator_name,
            "reconcileId": context.reconcile_id,
            "bundleDigest": context.bundle_digest,
            "runtimeVersion": context.runtime_version,
            "handlerAbi": SUPPORTED_HANDLER_ABI,
        },
        "handler": {
            "handlerId": context.handler_route.handler_id,
            "event": context.handler_route.event,
        },
        "objectRef": context.owner,
        "failure": {
            "phase": context.phase,
            "reason": reconcile_failure_reason(context.error),
            "message": if context.include_payloads {
                Value::String(context.error.to_string())
            } else {
                redacted_marker()
            },
        },
        "input": if context.include_payloads {
            context.input.clone()
        } else {
            redacted_handler_input(context.input)
        },
    });

    if let Some(details) = replay_error_details(context.error, context.include_payloads) {
        artifact["failure"]["details"] = details;
    }
    if let Some(debug_artifacts) = replay_debug_artifacts(context.bundle_artifacts) {
        artifact["debugArtifacts"] = debug_artifacts;
    }
    if let Some(plan) = context.plan {
        artifact["plan"] = if context.include_payloads {
            serde_json::to_value(plan).unwrap_or_else(|error| {
                serde_json::json!({
                    "redacted": true,
                    "error": format!("failed to serialize operation plan: {error}"),
                })
            })
        } else {
            redacted_operation_plan(plan, context.owner)
        };
    }

    artifact
}

fn replay_debug_artifacts(bundle_artifacts: Option<&Value>) -> Option<Value> {
    let artifacts: Vec<Value> = bundle_artifacts
        .and_then(Value::as_array)?
        .iter()
        .filter_map(replay_debug_artifact)
        .collect();
    if artifacts.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "sourceMapping": {
            "status": "artifactIdentityOnly",
            "note": "Use these artifact digests with the local bundle/source map tooling to map generated JS/WASM failures back to source.",
            "artifacts": artifacts,
        }
    }))
}

fn handler_source_map_path(manifest: &Value) -> Option<PathBuf> {
    manifest
        .pointer("/spec/container/files")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|file| {
            let destination = file.get("destination").and_then(Value::as_str)?;
            if destination.ends_with("/handler.js.map") || destination.ends_with("handler.js.map") {
                Some(PathBuf::from(destination))
            } else {
                None
            }
        })
}

fn replay_debug_artifact(artifact: &Value) -> Option<Value> {
    let kind = artifact.get("kind").and_then(Value::as_str)?;
    if !matches!(
        kind,
        "javascript-bundle" | "javascript-source-map" | "esbuild-metafile"
    ) {
        return None;
    }
    Some(serde_json::json!({
        "kind": kind,
        "path": artifact.get("path").cloned().unwrap_or(Value::Null),
        "digest": artifact.get("digest").cloned().unwrap_or(Value::Null),
    }))
}

pub fn write_replay_artifact(directory: &Path, artifact: &Value) -> std::io::Result<PathBuf> {
    fs::create_dir_all(directory)?;
    let replay_id = artifact
        .pointer("/metadata/replayId")
        .and_then(Value::as_str)
        .unwrap_or("replay-artifact");
    let path = directory.join(format!("{}.json", sanitize_file_name(replay_id)));
    let content = serde_json::to_vec_pretty(artifact).map_err(std::io::Error::other)?;
    fs::write(&path, content)?;
    Ok(path)
}

fn replay_error_details(error: &OperatorHostError, include_payloads: bool) -> Option<Value> {
    let mut details = reconcile_error_details(error)?;
    if include_payloads {
        return Some(details);
    }
    if details.get("cause").is_some() {
        details["cause"] = redacted_marker();
    }
    if details.get("type").and_then(Value::as_str) == Some("handlerFailed") {
        details["message"] = redacted_marker();
        if let Some(source_mapping) = details.get_mut("sourceMapping") {
            let frame_count = source_mapping
                .get("frames")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            source_mapping["frames"] = redacted_marker();
            source_mapping["mappedFrames"] = redacted_marker();
            source_mapping["frameCount"] = serde_json::json!(frame_count);
        }
    }
    Some(details)
}

fn redacted_handler_input(input: &Value) -> Value {
    let mut redacted = serde_json::json!({
        "abiVersion": input.get("abiVersion").cloned().unwrap_or(Value::Null),
        "handlerId": input.get("handlerId").cloned().unwrap_or(Value::Null),
        "event": input.get("event").cloned().unwrap_or(Value::Null),
        "runtime": input.get("runtime").cloned().unwrap_or(Value::Null),
        "object": redacted_kubernetes_object_value(input.get("object").unwrap_or(&Value::Null)),
    });
    for field in ["previous", "observed", "config", "capabilities"] {
        if input.get(field).is_some() {
            redacted[field] = redacted_marker();
        }
    }
    redacted
}

fn redacted_operation_plan(plan: &NormalizedOperationPlan, owner: &ObjectRef) -> Value {
    let operations: Vec<Value> = plan
        .operations
        .iter()
        .enumerate()
        .map(|(index, operation)| redacted_operation(index, operation, owner))
        .collect();

    let mut redacted = serde_json::json!({
        "operationCount": plan.operations.len(),
        "operations": operations,
    });
    if plan.diagnostics.is_some() {
        redacted["diagnostics"] = redacted_marker();
    }
    redacted
}

fn redacted_operation(index: usize, operation: &Operation, owner: &ObjectRef) -> Value {
    match operation {
        Operation::Apply {
            resource,
            field_manager,
            force,
            ownership,
        } => {
            let mut entry = serde_json::json!({
                "index": index,
                "kind": "apply",
                "target": object_ref_value(
                    &resource.api_version,
                    &resource.kind,
                    &resource.metadata.name,
                    resource.metadata.namespace.as_deref(),
                    resource.metadata.uid.as_deref(),
                    resource.metadata.resource_version.as_deref(),
                ),
                "resource": redacted_kubernetes_object_contract(resource),
            });
            if let Some(field_manager) = field_manager {
                entry["fieldManager"] = Value::String(field_manager.clone());
            }
            if let Some(force) = force {
                entry["force"] = Value::Bool(*force);
            }
            if let Some(ownership) = ownership {
                entry["ownership"] = redacted_apply_ownership(ownership);
            }
            entry
        }
        Operation::Patch { ref_, patch } => serde_json::json!({
            "index": index,
            "kind": "patch",
            "target": ref_,
            "patchCount": patch.len(),
            "patch": redacted_marker(),
        }),
        Operation::Delete { ref_, options } => serde_json::json!({
            "index": index,
            "kind": "delete",
            "target": ref_,
            "options": options,
        }),
        Operation::Status { ref_, .. } => serde_json::json!({
            "index": index,
            "kind": "status",
            "target": ref_.as_ref().unwrap_or(owner),
            "status": redacted_marker(),
        }),
        Operation::Event {
            event_type,
            reason,
            regarding,
            ..
        } => serde_json::json!({
            "index": index,
            "kind": "event",
            "eventType": event_type,
            "reason": reason,
            "regarding": regarding.as_ref().unwrap_or(owner),
            "message": redacted_marker(),
        }),
        Operation::Finalizer {
            operation,
            finalizer,
        } => serde_json::json!({
            "index": index,
            "kind": "finalizer",
            "operation": operation,
            "finalizer": finalizer,
            "target": owner,
        }),
        Operation::Requeue { policy } => serde_json::json!({
            "index": index,
            "kind": "requeue",
            "policy": policy,
        }),
    }
}

fn redacted_apply_ownership(ownership: &ApplyOwnership) -> Value {
    match ownership {
        ApplyOwnership::Auto => serde_json::json!({ "mode": "auto" }),
        ApplyOwnership::None => serde_json::json!({ "mode": "none" }),
        ApplyOwnership::Reference {
            ref_,
            block_owner_deletion,
        } => {
            let mut value = serde_json::json!({
                "mode": "reference",
                "ref": object_ref_value(
                    &ref_.api_version,
                    &ref_.kind,
                    &ref_.name,
                    ref_.namespace.as_deref(),
                    ref_.uid.as_deref(),
                    ref_.resource_version.as_deref(),
                ),
            });
            if let Some(block_owner_deletion) = block_owner_deletion {
                value["blockOwnerDeletion"] = Value::Bool(*block_owner_deletion);
            }
            value
        }
    }
}

fn redacted_kubernetes_object_value(object: &Value) -> Value {
    let mut redacted = serde_json::json!({
        "apiVersion": object.get("apiVersion").cloned().unwrap_or(Value::Null),
        "kind": object.get("kind").cloned().unwrap_or(Value::Null),
        "metadata": redacted_metadata_value(object.get("metadata").unwrap_or(&Value::Null)),
    });
    for field in ["spec", "status", "data", "stringData"] {
        if object.get(field).is_some() {
            redacted[field] = redacted_marker();
        }
    }
    redacted
}

fn redacted_kubernetes_object_contract(
    object: &applik8s_runtime_contract::KubernetesObject,
) -> Value {
    let object_value = serde_json::to_value(object).unwrap_or(Value::Null);
    redacted_kubernetes_object_value(&object_value)
}

fn redacted_metadata_value(metadata: &Value) -> Value {
    let mut redacted = serde_json::json!({
        "name": metadata.get("name").cloned().unwrap_or(Value::Null),
    });
    for field in [
        "namespace",
        "uid",
        "resourceVersion",
        "generation",
        "deletionTimestamp",
        "creationTimestamp",
        "finalizers",
    ] {
        if let Some(value) = metadata.get(field) {
            redacted[field] = value.clone();
        }
    }
    for field in ["labels", "annotations", "managedFields", "ownerReferences"] {
        if metadata.get(field).is_some() {
            redacted[field] = redacted_marker();
        }
    }
    redacted
}

fn redacted_marker() -> Value {
    serde_json::json!({ "redacted": true })
}

fn object_ref_value(
    api_version: &str,
    kind: &str,
    name: &str,
    namespace: Option<&str>,
    uid: Option<&str>,
    resource_version: Option<&str>,
) -> Value {
    serde_json::json!({
        "apiVersion": api_version,
        "kind": kind,
        "name": name,
        "namespace": namespace,
        "uid": uid,
        "resourceVersion": resource_version,
    })
}

fn replay_id(reconcile_id: &str, phase: &str, created_at: &str) -> String {
    format!("{created_at}-{reconcile_id}-{phase}")
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn emit_log_event(log_event: Value) {
    let message = log_event
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("applik8s log event");
    let dimensions = reconcile_trace_dimensions(&log_event);
    let operator_name = dimensions
        .pointer("/operatorName")
        .and_then(Value::as_str)
        .unwrap_or("");
    let handler_id = dimensions
        .pointer("/handlerId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let handler_event = dimensions
        .pointer("/handlerEvent")
        .and_then(Value::as_str)
        .unwrap_or("");
    let reconcile_id = dimensions
        .pointer("/reconcileId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let bundle_digest = dimensions
        .pointer("/bundleDigest")
        .and_then(Value::as_str)
        .unwrap_or("");
    let runtime_version = dimensions
        .pointer("/runtimeVersion")
        .and_then(Value::as_str)
        .unwrap_or("");
    let handler_abi = dimensions
        .pointer("/handlerAbi")
        .and_then(Value::as_str)
        .unwrap_or("");
    let resource_api_version = dimensions
        .pointer("/resourceApiVersion")
        .and_then(Value::as_str)
        .unwrap_or("");
    let resource_kind = dimensions
        .pointer("/resourceKind")
        .and_then(Value::as_str)
        .unwrap_or("");
    let resource_namespace = dimensions
        .pointer("/resourceNamespace")
        .and_then(Value::as_str)
        .unwrap_or("");
    let resource_name = dimensions
        .pointer("/resourceName")
        .and_then(Value::as_str)
        .unwrap_or("");
    let object_key = dimensions
        .pointer("/objectKey")
        .and_then(Value::as_str)
        .unwrap_or("");
    let failure_reason = dimensions
        .pointer("/failureReason")
        .and_then(Value::as_str)
        .unwrap_or("");
    let operation_kind = dimensions
        .pointer("/operationKind")
        .and_then(Value::as_str)
        .unwrap_or("");
    let operation_index = dimensions
        .pointer("/operationIndex")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let retry_attempt = dimensions
        .pointer("/retryAttempt")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let retry_delay_ms = dimensions
        .pointer("/retryDelayMs")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let retry_exhausted = dimensions
        .pointer("/retryExhausted")
        .and_then(Value::as_bool)
        .unwrap_or_default();
    let operations_applied = dimensions
        .pointer("/operationsApplied")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let operations_patched = dimensions
        .pointer("/operationsPatched")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let operations_deleted = dimensions
        .pointer("/operationsDeleted")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let operations_status_patched = dimensions
        .pointer("/operationsStatusPatched")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let operations_events_recorded = dimensions
        .pointer("/operationsEventsRecorded")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let operations_finalizers_mutated = dimensions
        .pointer("/operationsFinalizersMutated")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let operations_requeued = dimensions
        .pointer("/operationsRequeued")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    match log_event.get("level").and_then(Value::as_str) {
        Some("error") => {
            event!(Level::ERROR, operator_name, handler_id, handler_event, reconcile_id, bundle_digest, runtime_version, handler_abi, resource_api_version, resource_kind, resource_namespace, resource_name, object_key, failure_reason, operation_kind, operation_index, retry_attempt, retry_delay_ms, retry_exhausted, operations_applied, operations_patched, operations_deleted, operations_status_patched, operations_events_recorded, operations_finalizers_mutated, operations_requeued, applik8s.event = %log_event, "{message}")
        }
        Some("warn") => {
            event!(Level::WARN, operator_name, handler_id, handler_event, reconcile_id, bundle_digest, runtime_version, handler_abi, resource_api_version, resource_kind, resource_namespace, resource_name, object_key, failure_reason, operation_kind, operation_index, retry_attempt, retry_delay_ms, retry_exhausted, operations_applied, operations_patched, operations_deleted, operations_status_patched, operations_events_recorded, operations_finalizers_mutated, operations_requeued, applik8s.event = %log_event, "{message}")
        }
        Some("debug") => {
            event!(Level::DEBUG, operator_name, handler_id, handler_event, reconcile_id, bundle_digest, runtime_version, handler_abi, resource_api_version, resource_kind, resource_namespace, resource_name, object_key, failure_reason, operation_kind, operation_index, retry_attempt, retry_delay_ms, retry_exhausted, operations_applied, operations_patched, operations_deleted, operations_status_patched, operations_events_recorded, operations_finalizers_mutated, operations_requeued, applik8s.event = %log_event, "{message}")
        }
        _ => {
            event!(Level::INFO, operator_name, handler_id, handler_event, reconcile_id, bundle_digest, runtime_version, handler_abi, resource_api_version, resource_kind, resource_namespace, resource_name, object_key, failure_reason, operation_kind, operation_index, retry_attempt, retry_delay_ms, retry_exhausted, operations_applied, operations_patched, operations_deleted, operations_status_patched, operations_events_recorded, operations_finalizers_mutated, operations_requeued, applik8s.event = %log_event, "{message}")
        }
    }
}

pub fn retry_decision(policy: &RetryPolicy, attempt: u32) -> RetryDecision {
    let exhausted = policy
        .max_retries
        .is_some_and(|max_retries| attempt > max_retries);
    RetryDecision {
        attempt,
        delay: if exhausted {
            policy.max_delay
        } else {
            retry_delay(policy, attempt)
        },
        exhausted,
    }
}

fn retry_delay(policy: &RetryPolicy, attempt: u32) -> Duration {
    let mut backoff = ExponentialBackoffBuilder::new()
        .with_initial_interval(policy.base_delay)
        .with_max_interval(policy.max_delay)
        .with_multiplier(2.0)
        .with_randomization_factor(0.0)
        .with_max_elapsed_time(None)
        .build();
    let mut delay = policy.base_delay;
    for _ in 0..attempt {
        delay = backoff.next_backoff().unwrap_or(policy.max_delay);
    }
    delay.min(policy.max_delay)
}

pub fn retry_log_event(
    operator_name: &str,
    object_key: &str,
    decision: &RetryDecision,
    error: &str,
) -> Value {
    serde_json::json!({
        "level": if decision.exhausted { "warn" } else { "info" },
        "message": if decision.exhausted { "reconcile retry exhausted" } else { "reconcile retry scheduled" },
        "operatorName": operator_name,
        "objectKey": object_key,
        "retry": {
            "attempt": decision.attempt,
            "delayMs": decision.delay.as_millis(),
            "exhausted": decision.exhausted,
        },
        "error": error,
        "handlerAbi": SUPPORTED_HANDLER_ABI,
    })
}

fn retry_state_key(owner: &ObjectRef) -> String {
    format!(
        "{}/{} {}/{}",
        owner.api_version,
        owner.kind,
        owner.namespace.as_deref().unwrap_or("<cluster>"),
        owner.name
    )
}

fn copy_object_ref(owner: &ObjectRef) -> ObjectRef {
    ObjectRef {
        api_version: owner.api_version.clone(),
        kind: owner.kind.clone(),
        name: owner.name.clone(),
        namespace: owner.namespace.clone(),
        uid: owner.uid.clone(),
        resource_version: owner.resource_version.clone(),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct RequiredPermission {
    api_group: String,
    resource: String,
    verb: String,
}

pub fn validate_plan_rbac(
    bundle: &LoadedOperatorBundle,
    owner: &ObjectRef,
    plan: &NormalizedOperationPlan,
) -> Result<(), OperatorHostError> {
    for permission in required_permissions(bundle, owner, plan)? {
        if !manifest_allows_permission(&bundle.manifest, &permission) {
            return Err(OperatorHostError::UndeclaredPermission(format!(
                "verb={} apiGroup={} resource={}",
                permission.verb,
                display_api_group(&permission.api_group),
                permission.resource
            )));
        }
    }
    Ok(())
}

pub fn validate_plan_status_subresources(
    bundle: &LoadedOperatorBundle,
    owner: &ObjectRef,
    plan: &NormalizedOperationPlan,
) -> Result<(), OperatorHostError> {
    for operation in &plan.operations {
        let Operation::Status { ref_, .. } = operation else {
            continue;
        };
        let target = ref_.as_ref().unwrap_or(owner);
        if bundle.status_subresource_for_object(&target.api_version, &target.kind)? == Some(false) {
            return Err(OperatorHostError::StatusSubresourceUnsupported {
                api_version: target.api_version.clone(),
                kind: target.kind.clone(),
            });
        }
    }
    Ok(())
}

pub fn validate_plan_finalizer_ownership(
    bundle: &LoadedOperatorBundle,
    handler_route: &HandlerRoute,
    plan: &NormalizedOperationPlan,
) -> Result<(), OperatorHostError> {
    let Some(allowed_finalizers) = handler_declared_finalizers(bundle, &handler_route.handler_id)
    else {
        return Ok(());
    };

    for operation in &plan.operations {
        let Operation::Finalizer { finalizer, .. } = operation else {
            continue;
        };
        if !allowed_finalizers
            .iter()
            .any(|allowed| allowed == finalizer)
        {
            return Err(OperatorHostError::UndeclaredFinalizer {
                handler_id: handler_route.handler_id.clone(),
                finalizer: finalizer.clone(),
            });
        }
    }

    Ok(())
}

fn handler_declared_finalizers(
    bundle: &LoadedOperatorBundle,
    handler_id: &str,
) -> Option<Vec<String>> {
    bundle
        .manifest
        .pointer("/spec/handlerExports")
        .and_then(Value::as_array)?
        .iter()
        .find(|handler| handler.get("handlerId").and_then(Value::as_str) == Some(handler_id))
        .and_then(handler_finalizers)
}

fn required_permissions(
    bundle: &LoadedOperatorBundle,
    owner: &ObjectRef,
    plan: &NormalizedOperationPlan,
) -> Result<Vec<RequiredPermission>, OperatorHostError> {
    let mut permissions = Vec::new();
    for operation in &plan.operations {
        match operation {
            Operation::Apply { resource, .. } => {
                permissions.push(required_permission_for_resource(
                    bundle,
                    &resource.api_version,
                    &resource.kind,
                    None,
                    "patch",
                )?)
            }
            Operation::Patch { ref_, .. } => permissions.push(required_permission_for_resource(
                bundle,
                &ref_.api_version,
                &ref_.kind,
                None,
                "patch",
            )?),
            Operation::Delete { ref_, .. } => permissions.push(required_permission_for_resource(
                bundle,
                &ref_.api_version,
                &ref_.kind,
                None,
                "delete",
            )?),
            Operation::Status { ref_, .. } => {
                let target = ref_.as_ref().unwrap_or(owner);
                permissions.push(required_permission_for_resource(
                    bundle,
                    &target.api_version,
                    &target.kind,
                    Some("status"),
                    "patch",
                )?);
            }
            Operation::Event { .. } => permissions.push(RequiredPermission {
                api_group: String::new(),
                resource: "events".to_string(),
                verb: "create".to_string(),
            }),
            Operation::Finalizer { .. } => permissions.push(required_permission_for_resource(
                bundle,
                &owner.api_version,
                &owner.kind,
                Some("finalizers"),
                "patch",
            )?),
            Operation::Requeue { .. } => {}
        }
    }
    Ok(deduplicate_permissions(permissions))
}

fn required_permission_for_resource(
    bundle: &LoadedOperatorBundle,
    api_version: &str,
    kind: &str,
    subresource: Option<&str>,
    verb: &str,
) -> Result<RequiredPermission, OperatorHostError> {
    let api_group = api_group(api_version)?;
    let mut resource = resource_plural(bundle, api_version, kind);
    if let Some(subresource) = subresource {
        resource = format!("{resource}/{subresource}");
    }
    Ok(RequiredPermission {
        api_group,
        resource,
        verb: verb.to_string(),
    })
}

fn manifest_allows_permission(manifest: &Value, required: &RequiredPermission) -> bool {
    manifest
        .pointer("/spec/permissions")
        .and_then(Value::as_array)
        .is_some_and(|rules| {
            rules
                .iter()
                .any(|rule| rule_allows_permission(rule, required))
        })
}

fn rule_allows_permission(rule: &Value, required: &RequiredPermission) -> bool {
    string_array_contains(rule.get("apiGroups"), &required.api_group)
        && string_array_contains(rule.get("resources"), &required.resource)
        && string_array_contains(rule.get("verbs"), &required.verb)
}

fn string_array_contains(value: Option<&Value>, required: &str) -> bool {
    value.and_then(Value::as_array).is_some_and(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .any(|item| item == "*" || item == required)
    })
}

fn api_group(api_version: &str) -> Result<String, OperatorHostError> {
    if let Some((group, version)) = api_version.split_once('/') {
        if group.is_empty() || version.is_empty() {
            return Err(OperatorHostError::InvalidOwnedCrd(format!(
                "invalid apiVersion {api_version}"
            )));
        }
        return Ok(group.to_string());
    }
    if api_version.is_empty() {
        return Err(OperatorHostError::InvalidOwnedCrd(
            "apiVersion must not be empty".to_string(),
        ));
    }
    Ok(String::new())
}

fn resource_plural(bundle: &LoadedOperatorBundle, api_version: &str, kind: &str) -> String {
    bundle
        .manifest
        .pointer("/spec/ownedCrds")
        .and_then(Value::as_array)
        .and_then(|owned_crds| {
            owned_crds.iter().find_map(|crd| {
                (crd.get("apiVersion").and_then(Value::as_str) == Some(api_version)
                    && crd.get("kind").and_then(Value::as_str) == Some(kind))
                .then(|| {
                    crd.get("plural")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .flatten()
            })
        })
        .unwrap_or_else(|| default_resource_plural(api_version, kind))
}

fn default_resource_plural(api_version: &str, kind: &str) -> String {
    match (api_version, kind) {
        ("v1", "ConfigMap") => "configmaps".to_string(),
        ("v1", "Event") => "events".to_string(),
        ("v1", "Secret") => "secrets".to_string(),
        ("v1", "Service") => "services".to_string(),
        ("batch/v1", "Job") => "jobs".to_string(),
        ("apps/v1", "Deployment") => "deployments".to_string(),
        ("apps/v1", "StatefulSet") => "statefulsets".to_string(),
        _ => pluralize_kind(kind),
    }
}

fn pluralize_kind(kind: &str) -> String {
    let lower = kind.to_ascii_lowercase();
    if lower.ends_with('s') {
        format!("{lower}es")
    } else if lower.ends_with('y') {
        format!("{}ies", &lower[..lower.len().saturating_sub(1)])
    } else {
        format!("{lower}s")
    }
}

fn deduplicate_permissions(permissions: Vec<RequiredPermission>) -> Vec<RequiredPermission> {
    permissions
        .into_iter()
        .fold(Vec::new(), |mut unique, permission| {
            if !unique.contains(&permission) {
                unique.push(permission);
            }
            unique
        })
}

fn display_api_group(api_group: &str) -> &str {
    if api_group.is_empty() {
        "<core>"
    } else {
        api_group
    }
}

pub fn reconcile_error_details(error: &OperatorHostError) -> Option<Value> {
    reconcile_error_details_with_source_map(error, None)
}

pub fn reconcile_error_details_with_source_map(
    error: &OperatorHostError,
    source_map_path: Option<&Path>,
) -> Option<Value> {
    match error {
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed {
            index,
            kind,
            target,
            field_manager,
            progress,
            cause,
        }) => {
            let mut operation = serde_json::json!({
                "index": index,
                "kind": kind,
                "target": target,
            });
            if let Some(field_manager) = field_manager {
                operation["fieldManager"] = Value::String(field_manager.clone());
            }
            Some(serde_json::json!({
                "type": "operationFailed",
                "operation": operation,
                "partialEffects": progress.completed_operations > 0,
                "progress": operation_progress_value(progress),
                "cause": cause,
            }))
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerTimedOut { timeout_ms }) => {
            Some(serde_json::json!({
                "type": "handlerTimedOut",
                "timeoutMs": timeout_ms,
            }))
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerFailed(message)) => {
            let frames = handler_failure_stack_frames(message);
            let mapped_frames = source_map_path
                .map(|path| source_mapped_handler_frames(&frames, path))
                .unwrap_or_default();
            Some(serde_json::json!({
                "type": "handlerFailed",
                "message": handler_failure_summary(message),
                "sourceMapping": {
                    "status": handler_source_mapping_status(&frames, &mapped_frames, source_map_path),
                    "frames": frames,
                    "mappedFrames": mapped_frames,
                },
            }))
        }
        OperatorHostError::UndeclaredPermission(permission) => Some(serde_json::json!({
            "type": "undeclaredPermission",
            "permission": permission,
        })),
        OperatorHostError::UndeclaredFinalizer {
            handler_id,
            finalizer,
        } => Some(serde_json::json!({
            "type": "undeclaredFinalizer",
            "handlerId": handler_id,
            "finalizer": finalizer,
        })),
        OperatorHostError::StatusSubresourceUnsupported { api_version, kind } => {
            Some(serde_json::json!({
                "type": "statusSubresourceUnsupported",
                "apiVersion": api_version,
                "kind": kind,
            }))
        }
        _ => None,
    }
}

fn handler_source_mapping_status(
    frames: &[String],
    mapped_frames: &[Value],
    source_map_path: Option<&Path>,
) -> &'static str {
    if !mapped_frames.is_empty() {
        return "mapped";
    }
    if frames.is_empty() {
        return "unavailable";
    }
    if source_map_path.is_some() {
        return "mapUnavailable";
    }
    "stackFramesPreserved"
}

fn handler_failure_summary(message: &str) -> String {
    message.lines().next().unwrap_or(message).to_string()
}

fn handler_failure_stack_frames(message: &str) -> Vec<String> {
    message
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|line| line.starts_with("at "))
        .take(12)
        .map(str::to_string)
        .collect()
}

fn source_mapped_handler_frames(frames: &[String], source_map_path: &Path) -> Vec<Value> {
    let Ok(file) = fs::File::open(source_map_path) else {
        return vec![];
    };
    let Ok(source_map) = sourcemap::SourceMap::from_reader(file) else {
        return vec![];
    };
    frames
        .iter()
        .filter_map(|frame| source_mapped_handler_frame(frame, &source_map))
        .take(12)
        .collect()
}

fn source_mapped_handler_frame(frame: &str, source_map: &sourcemap::SourceMap) -> Option<Value> {
    let position = parse_stack_frame_position(frame)?;
    let token = source_map.lookup_token(
        position.line.saturating_sub(1),
        position.column.saturating_sub(1),
    )?;
    let source = token.get_source()?;
    let mut mapped = serde_json::json!({
        "generated": {
            "line": position.line,
            "column": position.column,
        },
        "source": source,
        "line": token.get_src_line() + 1,
        "column": token.get_src_col() + 1,
    });
    if let Some(name) = token.get_name() {
        mapped["name"] = Value::String(name.to_string());
    }
    Some(mapped)
}

#[derive(Clone, Copy)]
struct StackFramePosition {
    line: u32,
    column: u32,
}

fn parse_stack_frame_position(frame: &str) -> Option<StackFramePosition> {
    let trimmed = frame.trim().trim_end_matches(')');
    let last_colon = trimmed.rfind(':')?;
    let column = trimmed[last_colon + 1..].parse::<u32>().ok()?;
    let before_column = &trimmed[..last_colon];
    let line_colon = before_column.rfind(':')?;
    let line = before_column[line_colon + 1..].parse::<u32>().ok()?;
    Some(StackFramePosition { line, column })
}

fn operation_progress_value(progress: &OperationProgress) -> Value {
    serde_json::json!({
        "completedOperations": progress.completed_operations,
        "applied": progress.applied,
        "patched": progress.patched,
        "deleted": progress.deleted,
        "statusPatched": progress.status_patched,
        "eventsRecorded": progress.events_recorded,
        "finalizersMutated": progress.finalizers_mutated,
        "requeued": progress.requeued,
    })
}

async fn report_reconcile_failure_status(
    applier: &KubeOperationPlanApplier,
    owner: &ObjectRef,
    object: &Value,
    status_convention: &StatusConvention,
    error: &OperatorHostError,
    operator_name: &str,
    handler_route: &HandlerRoute,
    reconcile_id: &str,
    bundle_digest: &str,
    runtime_version: &str,
) {
    let status = reconcile_failure_status(
        object,
        status_convention,
        error,
        &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    );
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Status { status, ref_: None }],
        diagnostics: None,
    };

    if let Err(report_error) = applier.apply_plan(owner, &plan).await {
        let report_error = OperatorHostError::from(report_error);
        emit_log_event(reconcile_log_event(
            "warn",
            "reconcile failure status report failed",
            operator_name,
            handler_route,
            owner,
            reconcile_id,
            bundle_digest,
            runtime_version,
            None,
            Some(&report_error.to_string()),
            reconcile_error_details(&report_error),
        ));
    }
}

async fn report_reconcile_stale_status(
    applier: &KubeOperationPlanApplier,
    owner: &ObjectRef,
    object: &Value,
    status_convention: &StatusConvention,
    operator_name: &str,
    handler_route: &HandlerRoute,
    reconcile_id: &str,
    bundle_digest: &str,
    runtime_version: &str,
) {
    let Some(status) = reconcile_stale_status(
        object,
        status_convention,
        &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    ) else {
        return;
    };
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Status { status, ref_: None }],
        diagnostics: None,
    };

    if let Err(report_error) = applier.apply_plan(owner, &plan).await {
        let report_error = OperatorHostError::from(report_error);
        emit_log_event(reconcile_log_event(
            "warn",
            "reconcile stale status report failed",
            operator_name,
            handler_route,
            owner,
            reconcile_id,
            bundle_digest,
            runtime_version,
            None,
            Some(&report_error.to_string()),
            reconcile_error_details(&report_error),
        ));
    }
}

async fn report_reconcile_success_status(
    applier: &KubeOperationPlanApplier,
    owner: &ObjectRef,
    object: &Value,
    status_convention: &StatusConvention,
    operator_name: &str,
    handler_route: &HandlerRoute,
    reconcile_id: &str,
    bundle_digest: &str,
    runtime_version: &str,
) {
    let status = reconcile_success_status(
        object,
        status_convention,
        &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    );
    let plan = NormalizedOperationPlan {
        operations: vec![Operation::Status { status, ref_: None }],
        diagnostics: None,
    };

    if let Err(report_error) = applier.apply_plan(owner, &plan).await {
        let report_error = OperatorHostError::from(report_error);
        emit_log_event(reconcile_log_event(
            "warn",
            "reconcile success status report failed",
            operator_name,
            handler_route,
            owner,
            reconcile_id,
            bundle_digest,
            runtime_version,
            None,
            Some(&report_error.to_string()),
            reconcile_error_details(&report_error),
        ));
    }
}

pub fn reconcile_failure_status(
    object: &Value,
    status_convention: &StatusConvention,
    error: &OperatorHostError,
    now: &str,
) -> Value {
    let message = truncate_status_message(&failure_status_message(error));
    let reason = reconcile_failure_reason(error);
    condition_status(object, status_convention, "False", reason, &message, now)
}

fn failure_status_message(error: &OperatorHostError) -> String {
    match error {
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed {
            progress, ..
        }) if progress.completed_operations > 0 => format!(
            "{}; partial effects are visible: {} prior operation(s) completed before the failure",
            error, progress.completed_operations
        ),
        _ => error.to_string(),
    }
}

pub fn reconcile_success_status(
    object: &Value,
    status_convention: &StatusConvention,
    now: &str,
) -> Value {
    condition_status(
        object,
        status_convention,
        "True",
        "ReconcileSucceeded",
        "Reconcile completed successfully.",
        now,
    )
}

pub fn reconcile_stale_status(
    object: &Value,
    status_convention: &StatusConvention,
    now: &str,
) -> Option<Value> {
    let generation = object_generation(object)?;
    let observed_generation = status_observed_generation(object, status_convention);
    if observed_generation.is_some_and(|observed_generation| observed_generation >= generation) {
        return None;
    }
    Some(condition_status(
        object,
        status_convention,
        "Unknown",
        "Reconciling",
        "Observed generation is stale; reconciliation is in progress.",
        now,
    ))
}

pub fn retry_exhausted_status(
    object: &Value,
    status_convention: &StatusConvention,
    error_message: &str,
    attempt: u32,
    now: &str,
) -> Value {
    let message = truncate_status_message(&format!(
        "Retry exhausted after {attempt} failed attempt(s); waiting for a Kubernetes object change before retrying: {error_message}"
    ));
    condition_status(
        object,
        status_convention,
        "False",
        "RetryExhausted",
        &message,
        now,
    )
}

fn condition_status(
    object: &Value,
    status_convention: &StatusConvention,
    status: &str,
    reason: &str,
    message: &str,
    now: &str,
) -> Value {
    let mut condition = serde_json::Map::new();
    condition.insert("type".to_string(), Value::String("Ready".to_string()));
    condition.insert("status".to_string(), Value::String(status.to_string()));
    condition.insert("reason".to_string(), Value::String(reason.to_string()));
    condition.insert("message".to_string(), Value::String(message.to_string()));
    condition.insert(
        "lastTransitionTime".to_string(),
        Value::String(condition_transition_time(
            object,
            status_convention,
            status,
            now,
        )),
    );
    if let Some(observed_generation) = object_generation(object) {
        condition.insert(
            "observedGeneration".to_string(),
            Value::from(observed_generation),
        );
    }

    let mut status_patch = serde_json::Map::new();
    if let Some(observed_generation) = object_generation(object) {
        status_patch.insert(
            status_convention.observed_generation_field.clone(),
            Value::from(observed_generation),
        );
    }
    status_patch.insert(
        status_convention.conditions_field.clone(),
        Value::Array(vec![Value::Object(condition)]),
    );
    Value::Object(status_patch)
}

fn condition_transition_time(
    object: &Value,
    status_convention: &StatusConvention,
    next_status: &str,
    now: &str,
) -> String {
    existing_ready_condition(object, status_convention)
        .filter(|condition| condition.get("status").and_then(Value::as_str) == Some(next_status))
        .and_then(|condition| condition.get("lastTransitionTime"))
        .and_then(Value::as_str)
        .unwrap_or(now)
        .to_string()
}

fn existing_ready_condition<'a>(
    object: &'a Value,
    status_convention: &StatusConvention,
) -> Option<&'a Value> {
    object
        .get("status")?
        .get(&status_convention.conditions_field)?
        .as_array()?
        .iter()
        .find(|condition| condition.get("type").and_then(Value::as_str) == Some("Ready"))
}

fn object_generation(object: &Value) -> Option<u64> {
    object
        .pointer("/metadata/generation")
        .and_then(Value::as_u64)
}

fn status_observed_generation(object: &Value, status_convention: &StatusConvention) -> Option<u64> {
    object
        .get("status")?
        .get(&status_convention.observed_generation_field)?
        .as_u64()
}

fn reconcile_failure_reason(error: &OperatorHostError) -> &'static str {
    match error {
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::OperationFailed { kind, .. }) => {
            match kind.as_str() {
                "apply" => "ApplyFailed",
                "patch" => "PatchFailed",
                "delete" => "DeleteFailed",
                "status" => "StatusPatchFailed",
                "event" => "EventRecordFailed",
                "finalizer" => "FinalizerFailed",
                _ => "OperationFailed",
            }
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerFailed(_)) => "HandlerFailed",
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::HandlerTimedOut { .. }) => {
            "HandlerTimedOut"
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::InvalidPayload(_)) => {
            "InvalidRuntimePayload"
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::Wasmtime(_)) => "HandlerRuntimeFailed",
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::Kubernetes(_)) => {
            "KubernetesApiFailed"
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::Json(_)) => {
            "RuntimeSerializationFailed"
        }
        OperatorHostError::RuntimeBridge(RuntimeBridgeError::UnsupportedOperation(_)) => {
            "UnsupportedOperation"
        }
        OperatorHostError::UndeclaredPermission(_) => "UndeclaredPermission",
        OperatorHostError::UndeclaredFinalizer { .. } => "UndeclaredFinalizer",
        _ => "ReconcileFailed",
    }
}

fn truncate_status_message(message: &str) -> String {
    const MAX_STATUS_MESSAGE_LEN: usize = 1024;
    message.chars().take(MAX_STATUS_MESSAGE_LEN).collect()
}

impl OperatorHostPaths {
    pub fn from_env() -> Self {
        Self {
            manifest_path: std::env::var_os("APPLIK8S_MANIFEST_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/etc/applik8s/operator-manifest.json")),
            handler_path: std::env::var_os("APPLIK8S_HANDLER_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/handler/handler.wasm")),
            handler_chunks_dir: std::env::var_os("APPLIK8S_HANDLER_CHUNKS_DIR").map(PathBuf::from),
        }
    }
}

impl LoadedOperatorBundle {
    pub fn load(paths: &OperatorHostPaths) -> Result<Self, OperatorHostError> {
        let manifest_text = read_to_string(&paths.manifest_path)?;
        let manifest: Value =
            serde_json::from_str(&manifest_text).map_err(OperatorHostError::InvalidManifestJson)?;
        if manifest.get("kind").and_then(Value::as_str) != Some("OperatorBundle") {
            return Err(OperatorHostError::InvalidManifestKind);
        }

        let handler_wasm = read_handler_bytes(paths)?;
        if handler_wasm.is_empty() {
            return Err(OperatorHostError::EmptyHandlerArtifact);
        }

        Ok(Self {
            manifest,
            handler_wasm,
        })
    }

    pub fn owned_resource_watches(&self) -> Result<Vec<OwnedResourceWatch>, OperatorHostError> {
        let crds = self
            .manifest
            .pointer("/spec/ownedCrds")
            .and_then(Value::as_array)
            .ok_or(OperatorHostError::MissingOwnedCrds)?;
        let default_namespace = default_watch_namespace(&self.manifest);

        crds.iter()
            .map(|crd| {
                let api_version = required_string(crd, "apiVersion")?;
                let kind = required_string(crd, "kind")?;
                let plural = required_string(crd, "plural")?;
                let scope = crd
                    .get("scope")
                    .and_then(Value::as_str)
                    .unwrap_or("Namespaced")
                    .to_string();
                Ok(OwnedResourceWatch {
                    api_version,
                    kind,
                    plural,
                    namespace: if scope == "Cluster" {
                        None
                    } else {
                        default_namespace.clone()
                    },
                    scope,
                })
            })
            .collect()
    }

    pub fn status_convention_for_object(
        &self,
        api_version: &str,
        kind: &str,
    ) -> Result<Option<StatusConvention>, OperatorHostError> {
        let crds = self
            .manifest
            .pointer("/spec/ownedCrds")
            .and_then(Value::as_array)
            .ok_or(OperatorHostError::MissingOwnedCrds)?;
        let Some(crd) = crds.iter().find(|crd| {
            crd.get("apiVersion").and_then(Value::as_str) == Some(api_version)
                && crd.get("kind").and_then(Value::as_str) == Some(kind)
        }) else {
            return Ok(None);
        };
        let Some(convention) = crd.get("statusConvention") else {
            return Ok(None);
        };
        if matches!(crd.get("statusSubresource"), Some(Value::Bool(false))) {
            return Err(OperatorHostError::InvalidOwnedCrd(format!(
                "{api_version}/{kind} statusConvention requires statusSubresource true"
            )));
        }
        if crd
            .get("statusSubresource")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(OperatorHostError::InvalidOwnedCrd(format!(
                "{api_version}/{kind} statusSubresource must be a boolean"
            )));
        }
        let observed_generation_field = convention
            .get("observedGenerationField")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidOwnedCrd(format!(
                    "{api_version}/{kind} statusConvention.observedGenerationField must be a string"
                ))
            })?;
        let conditions_field = convention
            .get("conditionsField")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidOwnedCrd(format!(
                    "{api_version}/{kind} statusConvention.conditionsField must be a string"
                ))
            })?;
        Ok(Some(StatusConvention {
            observed_generation_field: observed_generation_field.to_string(),
            conditions_field: conditions_field.to_string(),
        }))
    }

    pub fn status_subresource_for_object(
        &self,
        api_version: &str,
        kind: &str,
    ) -> Result<Option<bool>, OperatorHostError> {
        let crds = self
            .manifest
            .pointer("/spec/ownedCrds")
            .and_then(Value::as_array)
            .ok_or(OperatorHostError::MissingOwnedCrds)?;
        let Some(crd) = crds.iter().find(|crd| {
            crd.get("apiVersion").and_then(Value::as_str) == Some(api_version)
                && crd.get("kind").and_then(Value::as_str) == Some(kind)
        }) else {
            return Ok(None);
        };
        match crd.get("statusSubresource") {
            Some(Value::Bool(enabled)) => Ok(Some(*enabled)),
            Some(_) => Err(OperatorHostError::InvalidOwnedCrd(format!(
                "{api_version}/{kind} statusSubresource must be a boolean"
            ))),
            // Older persisted bundles predate statusSubresource; statusConvention implied one.
            None => Ok(Some(crd.get("statusConvention").is_some())),
        }
    }

    pub fn validate_runtime_compatibility(
        &self,
        runtime_version: &str,
    ) -> Result<(), OperatorHostError> {
        self.validate_manifest_version()?;
        self.validate_handler_abi()?;
        self.validate_unsupported_runtime_config()?;
        let required = self
            .manifest
            .pointer("/spec/requiresRuntime")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidRuntimeRequirement(
                    "spec.requiresRuntime is required".to_string(),
                )
            })?;
        let requirement = VersionReq::parse(required).map_err(|error| {
            OperatorHostError::InvalidRuntimeRequirement(format!(
                "spec.requiresRuntime {required:?} is invalid: {error}"
            ))
        })?;
        let actual = Version::parse(runtime_version).map_err(|error| {
            OperatorHostError::InvalidRuntimeRequirement(format!(
                "host runtime version {runtime_version:?} is invalid: {error}"
            ))
        })?;

        if requirement.matches(&actual) {
            Ok(())
        } else {
            Err(OperatorHostError::IncompatibleRuntime {
                required: required.to_string(),
                actual: runtime_version.to_string(),
            })
        }
    }

    fn validate_unsupported_runtime_config(&self) -> Result<(), OperatorHostError> {
        self.leader_election_config()?;
        if let Some(message) = unsupported_runtime_concurrency(&self.manifest) {
            return Err(OperatorHostError::InvalidRuntimeConfig(message));
        }
        Ok(())
    }

    pub fn leader_election_config(
        &self,
    ) -> Result<Option<RuntimeLeaderElectionConfig>, OperatorHostError> {
        let Some(config) = self.manifest.pointer("/spec/runtime/leaderElection") else {
            return Ok(None);
        };
        if !config
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(None);
        }
        let lease_name = config
            .get("leaseName")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                OperatorHostError::InvalidRuntimeConfig(
                    "spec.runtime.leaderElection.leaseName is required when leader election is enabled"
                        .to_string(),
                )
            })?;
        let lease_duration_seconds = required_positive_u64(
            config,
            "spec.runtime.leaderElection.leaseDurationSeconds",
            "leaseDurationSeconds",
        )?;
        let renew_deadline_seconds = required_positive_u64(
            config,
            "spec.runtime.leaderElection.renewDeadlineSeconds",
            "renewDeadlineSeconds",
        )?;
        let retry_period_seconds = required_positive_u64(
            config,
            "spec.runtime.leaderElection.retryPeriodSeconds",
            "retryPeriodSeconds",
        )?;
        if lease_duration_seconds <= renew_deadline_seconds {
            return Err(OperatorHostError::InvalidRuntimeConfig(
                "spec.runtime.leaderElection.leaseDurationSeconds must be greater than renewDeadlineSeconds"
                    .to_string(),
            ));
        }
        if renew_deadline_seconds <= retry_period_seconds {
            return Err(OperatorHostError::InvalidRuntimeConfig(
                "spec.runtime.leaderElection.renewDeadlineSeconds must be greater than retryPeriodSeconds"
                    .to_string(),
            ));
        }
        let lease_namespace = config
            .get("leaseNamespace")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        Ok(Some(RuntimeLeaderElectionConfig {
            lease_name: lease_name.to_string(),
            lease_namespace,
            lease_duration_seconds,
            renew_deadline_seconds,
            retry_period_seconds,
        }))
    }

    fn validate_manifest_version(&self) -> Result<(), OperatorHostError> {
        let required = self
            .manifest
            .get("apiVersion")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidManifestVersion(
                    "apiVersion is required and must be a string".to_string(),
                )
            })?;

        if required == SUPPORTED_OPERATOR_MANIFEST_VERSION {
            Ok(())
        } else {
            Err(OperatorHostError::UnsupportedManifestVersion {
                required: required.to_string(),
                supported: SUPPORTED_OPERATOR_MANIFEST_VERSION.to_string(),
            })
        }
    }

    pub fn validate_handler_host_imports(
        &self,
        engine: &wasmtime::Engine,
    ) -> Result<(), OperatorHostError> {
        let component = wasmtime::component::Component::new(engine, &self.handler_wasm)
            .map_err(RuntimeBridgeError::from)?;
        let allowed_host_imports = self.allowed_host_imports()?;
        validate_component_host_imports(engine, &component, &allowed_host_imports)?;
        Ok(())
    }

    pub fn allowed_host_imports(&self) -> Result<Vec<String>, OperatorHostError> {
        let imports = self
            .manifest
            .pointer("/spec/adapterRequirements/hostImports")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                OperatorHostError::InvalidRuntimeAdapterRequirement(
                    "spec.adapterRequirements.hostImports is required".to_string(),
                )
            })?;

        imports
            .iter()
            .enumerate()
            .map(|(index, value)| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    OperatorHostError::InvalidRuntimeAdapterRequirement(format!(
                        "spec.adapterRequirements.hostImports[{index}] must be a string"
                    ))
                })
            })
            .collect()
    }

    pub fn handler_timeout(&self) -> Result<Duration, OperatorHostError> {
        if let Some(value) = std::env::var_os("APPLIK8S_HANDLER_TIMEOUT_SECONDS") {
            let value = value.to_string_lossy();
            return parse_handler_timeout_seconds(&value, "APPLIK8S_HANDLER_TIMEOUT_SECONDS");
        }
        if let Some(value) = self.manifest.pointer("/spec/runtime/handlerTimeoutSeconds") {
            let seconds = value.as_u64().ok_or_else(|| {
                OperatorHostError::InvalidRuntimeConfig(
                    "spec.runtime.handlerTimeoutSeconds must be a positive integer".to_string(),
                )
            })?;
            if seconds == 0 {
                return Err(OperatorHostError::InvalidRuntimeConfig(
                    "spec.runtime.handlerTimeoutSeconds must be greater than zero".to_string(),
                ));
            }
            return Ok(Duration::from_secs(seconds));
        }
        Ok(Duration::from_secs(30))
    }

    pub fn retry_policy(&self) -> Result<RetryPolicy, OperatorHostError> {
        let Some(rate_limit) = self.manifest.pointer("/spec/runtime/rateLimit") else {
            return Ok(RetryPolicy::default());
        };
        let base_delay = parse_manifest_duration_ms(rate_limit, "baseDelayMs")?
            .unwrap_or_else(|| RetryPolicy::default().base_delay);
        let max_delay = parse_manifest_duration_ms(rate_limit, "maxDelayMs")?
            .unwrap_or_else(|| RetryPolicy::default().max_delay);
        if max_delay < base_delay {
            return Err(OperatorHostError::InvalidRuntimeConfig(
                "spec.runtime.rateLimit.maxDelayMs must be greater than or equal to baseDelayMs"
                    .to_string(),
            ));
        }
        let max_retries = match rate_limit.get("maxRetries") {
            Some(value) => Some(value.as_u64().ok_or_else(|| {
                OperatorHostError::InvalidRuntimeConfig(
                    "spec.runtime.rateLimit.maxRetries must be a positive integer".to_string(),
                )
            })? as u32),
            None => None,
        };
        if max_retries == Some(0) {
            return Err(OperatorHostError::InvalidRuntimeConfig(
                "spec.runtime.rateLimit.maxRetries must be greater than zero".to_string(),
            ));
        }
        Ok(RetryPolicy {
            base_delay,
            max_delay,
            max_retries,
        })
    }

    fn validate_handler_abi(&self) -> Result<(), OperatorHostError> {
        let required = self
            .manifest
            .pointer("/spec/handlerAbi")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidHandlerAbi("spec.handlerAbi is required".to_string())
            })?;

        if required == SUPPORTED_HANDLER_ABI {
            Ok(())
        } else {
            Err(OperatorHostError::UnsupportedHandlerAbi {
                required: required.to_string(),
                supported: SUPPORTED_HANDLER_ABI.to_string(),
            })
        }
    }

    pub fn controllers(&self, client: Client) -> Result<Vec<RuntimeController>, OperatorHostError> {
        self.owned_resource_watches()?
            .into_iter()
            .map(|watch| {
                let api_resource = api_resource_for_watch(&watch)?;
                let api = match watch.namespace.as_deref() {
                    Some(namespace) => Api::<DynamicObject>::namespaced_with(
                        client.clone(),
                        namespace,
                        &api_resource,
                    ),
                    None => Api::<DynamicObject>::all_with(client.clone(), &api_resource),
                };
                let controller =
                    Controller::new_with(api, watcher::Config::default(), api_resource);
                Ok(RuntimeController { watch, controller })
            })
            .collect()
    }

    pub fn handler_route_for_object(
        &self,
        api_version: &str,
        kind: &str,
        object: &Value,
    ) -> Result<HandlerRoute, OperatorHostError> {
        if object.pointer("/metadata/deletionTimestamp").is_some() {
            if let Some(handler_id) = self.handler_id_for_finalize(api_version, kind, object)? {
                return Ok(HandlerRoute {
                    handler_id,
                    event: "finalize".to_string(),
                });
            }
            if let Some(handler_id) = self.handler_id_for_event(api_version, kind, "deleted")? {
                return Ok(HandlerRoute {
                    handler_id,
                    event: "deleted".to_string(),
                });
            }
            return self.reconcile_route(api_version, kind);
        }
        if status_changed_candidate(&self.manifest, api_version, kind, object) {
            if let Some(handler_id) =
                self.handler_id_for_event(api_version, kind, "statusChanged")?
            {
                return Ok(HandlerRoute {
                    handler_id,
                    event: "statusChanged".to_string(),
                });
            }
        }
        if let Some(event) = generation_event(object) {
            if let Some(handler_id) = self.handler_id_for_event(api_version, kind, event)? {
                return Ok(HandlerRoute {
                    handler_id,
                    event: event.to_string(),
                });
            }
        }
        self.reconcile_route(api_version, kind)
    }

    fn reconcile_route(
        &self,
        api_version: &str,
        kind: &str,
    ) -> Result<HandlerRoute, OperatorHostError> {
        self.handler_id_for_event(api_version, kind, "reconcile")?
            .map(|handler_id| HandlerRoute {
                handler_id,
                event: "reconcile".to_string(),
            })
            .ok_or_else(|| OperatorHostError::HandlerNotFound {
                api_version: api_version.to_string(),
                kind: kind.to_string(),
            })
    }

    fn handler_id_for_finalize(
        &self,
        api_version: &str,
        kind: &str,
        object: &Value,
    ) -> Result<Option<String>, OperatorHostError> {
        if !has_finalizers(object) {
            return Ok(None);
        }

        let handlers = self.handlers_for_event(api_version, kind, "finalize")?;
        if handlers.is_empty() {
            return Ok(None);
        }

        let object_finalizers = object_finalizers(object);
        let declared_handlers: Vec<&Value> = handlers
            .iter()
            .copied()
            .filter(|handler| handler_finalizers(handler).is_some())
            .collect();
        for handler in &declared_handlers {
            if handler_finalizers(handler).is_some_and(|finalizers| {
                finalizers
                    .iter()
                    .any(|finalizer| object_finalizers.contains(finalizer))
            }) {
                return Ok(handler
                    .get("handlerId")
                    .and_then(Value::as_str)
                    .map(str::to_string));
            }
        }

        if declared_handlers.is_empty() {
            return Ok(handlers
                .first()
                .and_then(|handler| handler.get("handlerId"))
                .and_then(Value::as_str)
                .map(str::to_string));
        }

        Ok(None)
    }

    fn handler_id_for_event(
        &self,
        api_version: &str,
        kind: &str,
        event: &str,
    ) -> Result<Option<String>, OperatorHostError> {
        Ok(self
            .handlers_for_event(api_version, kind, event)?
            .first()
            .and_then(|handler| handler.get("handlerId"))
            .and_then(Value::as_str)
            .map(str::to_string))
    }

    fn handlers_for_event(
        &self,
        api_version: &str,
        kind: &str,
        event: &str,
    ) -> Result<Vec<&Value>, OperatorHostError> {
        let handlers = self
            .manifest
            .pointer("/spec/handlerExports")
            .and_then(Value::as_array)
            .ok_or_else(|| OperatorHostError::HandlerNotFound {
                api_version: api_version.to_string(),
                kind: kind.to_string(),
            })?;

        Ok(handlers
            .iter()
            .filter(|handler| {
                handler.get("event").and_then(Value::as_str) == Some(event)
                    && handler
                        .pointer("/resource/apiVersion")
                        .and_then(Value::as_str)
                        == Some(api_version)
                    && handler.pointer("/resource/kind").and_then(Value::as_str) == Some(kind)
            })
            .collect())
    }
}

fn has_finalizers(object: &Value) -> bool {
    object
        .pointer("/metadata/finalizers")
        .and_then(Value::as_array)
        .is_some_and(|finalizers| !finalizers.is_empty())
}

fn object_finalizers(object: &Value) -> Vec<String> {
    object
        .pointer("/metadata/finalizers")
        .and_then(Value::as_array)
        .map(|finalizers| {
            finalizers
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn handler_finalizers(handler: &Value) -> Option<Vec<String>> {
    handler.get("finalizers")?.as_array().map(|finalizers| {
        finalizers
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    })
}

fn generation_event(object: &Value) -> Option<&'static str> {
    let generation = object.pointer("/metadata/generation")?.as_f64()?;
    if generation <= 1.0 {
        Some("created")
    } else {
        Some("updated")
    }
}

fn status_changed_candidate(
    manifest: &Value,
    api_version: &str,
    kind: &str,
    object: &Value,
) -> bool {
    if !object
        .get("status")
        .is_some_and(|status| status.as_object().is_some_and(|status| !status.is_empty()))
    {
        return false;
    }
    let Some(generation) = object
        .pointer("/metadata/generation")
        .and_then(Value::as_u64)
    else {
        return true;
    };
    status_observed_generation_for_route(manifest, api_version, kind, object)
        .is_some_and(|observed_generation| observed_generation >= generation)
}

fn status_observed_generation_for_route(
    manifest: &Value,
    api_version: &str,
    kind: &str,
    object: &Value,
) -> Option<u64> {
    let field = manifest
        .pointer("/spec/ownedCrds")
        .and_then(Value::as_array)
        .and_then(|crds| {
            crds.iter().find(|crd| {
                crd.get("apiVersion").and_then(Value::as_str) == Some(api_version)
                    && crd.get("kind").and_then(Value::as_str) == Some(kind)
            })
        })
        .and_then(|crd| crd.get("statusConvention"))
        .and_then(|convention| convention.get("observedGenerationField"))
        .and_then(Value::as_str)
        .unwrap_or("observedGeneration");
    object.get("status")?.get(field)?.as_u64()
}

fn default_watch_namespace(manifest: &Value) -> Option<String> {
    if let Some(namespace) = manifest
        .pointer("/metadata/annotations/applik8s.dev~1namespace")
        .and_then(Value::as_str)
    {
        return Some(namespace.to_string());
    }
    std::env::var("APPLIK8S_POD_NAMESPACE")
        .ok()
        .filter(|value| !value.is_empty())
}

fn unsupported_runtime_concurrency(manifest: &Value) -> Option<String> {
    let concurrency = manifest.pointer("/spec/runtime/concurrency")?;
    if concurrency
        .get("workerCount")
        .and_then(Value::as_u64)
        .is_some_and(|value| value != 1)
    {
        return Some("spec.runtime.concurrency.workerCount greater than 1 is not supported until the operator host implements explicit worker concurrency semantics".to_string());
    }
    if concurrency
        .get("maxInFlightPerResource")
        .and_then(Value::as_u64)
        .is_some_and(|value| value != 1)
    {
        return Some("spec.runtime.concurrency.maxInFlightPerResource greater than 1 is not supported until the operator host implements per-resource concurrency control".to_string());
    }
    if concurrency.get("maxQueueDepth").is_some() {
        return Some("spec.runtime.concurrency.maxQueueDepth is not supported until the operator host exposes trustworthy kube-runtime queue depth controls".to_string());
    }
    None
}

fn env_truthy(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.as_str(),
                "1" | "true" | "TRUE" | "True" | "yes" | "YES"
            )
        })
        .unwrap_or(false)
}

fn parse_handler_timeout_seconds(value: &str, source: &str) -> Result<Duration, OperatorHostError> {
    let seconds = value.parse::<u64>().map_err(|error| {
        OperatorHostError::InvalidRuntimeConfig(format!(
            "{source} must be a positive integer number of seconds: {error}"
        ))
    })?;
    if seconds == 0 {
        return Err(OperatorHostError::InvalidRuntimeConfig(format!(
            "{source} must be greater than zero"
        )));
    }
    Ok(Duration::from_secs(seconds))
}

fn required_positive_u64(
    object: &Value,
    path: &str,
    field: &str,
) -> Result<u64, OperatorHostError> {
    let value = object
        .get(field)
        .ok_or_else(|| OperatorHostError::InvalidRuntimeConfig(format!("{path} is required")))?;
    let value = value.as_u64().ok_or_else(|| {
        OperatorHostError::InvalidRuntimeConfig(format!("{path} must be a positive integer"))
    })?;
    if value == 0 {
        return Err(OperatorHostError::InvalidRuntimeConfig(format!(
            "{path} must be greater than zero"
        )));
    }
    Ok(value)
}

fn parse_manifest_duration_ms(
    object: &Value,
    field: &str,
) -> Result<Option<Duration>, OperatorHostError> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    let millis = value.as_u64().ok_or_else(|| {
        OperatorHostError::InvalidRuntimeConfig(format!(
            "spec.runtime.rateLimit.{field} must be a positive integer"
        ))
    })?;
    if millis == 0 {
        return Err(OperatorHostError::InvalidRuntimeConfig(format!(
            "spec.runtime.rateLimit.{field} must be greater than zero"
        )));
    }
    Ok(Some(Duration::from_millis(millis)))
}

pub async fn execute_capability_request(
    manifest: &Value,
    request_json: &str,
) -> Result<String, String> {
    execute_capability_request_with_secret_resolver(manifest, request_json, None).await
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilitySecretRef {
    pub name: String,
    pub namespace: Option<String>,
    pub key: String,
}

pub type CapabilitySecretResolverFuture =
    Pin<Box<dyn Future<Output = Result<String, String>> + Send>>;
pub type CapabilitySecretResolver =
    Arc<dyn Fn(CapabilitySecretRef) -> CapabilitySecretResolverFuture + Send + Sync>;

pub async fn execute_capability_request_with_secret_resolver(
    manifest: &Value,
    request_json: &str,
    secret_resolver: Option<CapabilitySecretResolver>,
) -> Result<String, String> {
    let request: Value = match serde_json::from_str(request_json) {
        Ok(request) => request,
        Err(error) => {
            return Ok(capability_error_response(
                "CAPABILITY_REQUEST_INVALID",
                &format!("Capability request JSON is invalid: {error}"),
            ));
        }
    };
    match execute_capability_request_value(manifest, &request, secret_resolver.as_ref()).await {
        Ok(value) => Ok(serde_json::json!({
            "ok": true,
            "value": value,
            "observedAt": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        })
        .to_string()),
        Err(message) => Ok(capability_error_response("CAPABILITY_DENIED", &message)),
    }
}

async fn execute_capability_request_value(
    manifest: &Value,
    request: &Value,
    secret_resolver: Option<&CapabilitySecretResolver>,
) -> Result<Value, String> {
    let capability_name = required_capability_request_string(request, "capabilityName")?;
    let method = required_capability_request_string(request, "method")?;
    let path = required_capability_request_string(request, "path")?;
    let reconcile_id = required_capability_request_string(request, "reconcileId")?;
    let descriptor = manifest
        .pointer("/spec/capabilities")
        .and_then(Value::as_object)
        .and_then(|capabilities| capabilities.get(capability_name))
        .ok_or_else(|| format!("Capability {capability_name} is not declared by this operator."))?;
    validate_live_http_capability(capability_name, descriptor, &method, &path, request)?;
    let url = capability_request_url(descriptor, path)?;
    let timeout = capability_timeout(descriptor, request)?;
    event!(
        Level::INFO,
        capability = capability_name,
        reconcile_id,
        method,
        url_host = url.host_str().unwrap_or(""),
        timeout_ms = timeout.as_millis() as u64,
        payload = "redacted",
        handler_abi = SUPPORTED_HANDLER_ABI,
        "capability request started"
    );
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("failed to construct HTTP capability client: {error}"))?;
    let method = http_method(method)?;
    let mut headers = capability_request_headers(capability_name, request)?;
    append_secret_ref_auth_header(capability_name, descriptor, secret_resolver, &mut headers)
        .await?;
    let body = request.get("body").cloned();
    let retry_policy = capability_retry_policy(descriptor)?;
    let mut attempt = 1;
    let (status, body) = loop {
        let result = send_http_capability_attempt(
            &client,
            method.clone(),
            url.clone(),
            &headers,
            body.as_ref(),
        )
        .await;
        match result {
            Ok((status, body)) if status.is_success() => break (status, body),
            Ok((status, _body))
                if retryable_status(status) && attempt < retry_policy.max_attempts =>
            {
                capability_retry_sleep(capability_name, attempt, &retry_policy).await;
                attempt += 1;
            }
            Ok((status, _body)) => {
                return Err(format!(
                    "HTTP capability {capability_name} returned non-success status {}.",
                    status.as_u16()
                ));
            }
            Err(_error) if attempt < retry_policy.max_attempts => {
                capability_retry_sleep(capability_name, attempt, &retry_policy).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    };
    event!(
        Level::INFO,
        capability = capability_name,
        reconcile_id,
        method = %method,
        status = status.as_u16(),
        attempts = attempt,
        payload = "redacted",
        handler_abi = SUPPORTED_HANDLER_ABI,
        "capability request completed"
    );
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body).map_err(|error| {
        format!("HTTP capability {capability_name} response must be JSON: {error}")
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CapabilityRetryPolicy {
    max_attempts: u64,
    backoff_ms: u64,
    max_backoff_ms: u64,
}

async fn send_http_capability_attempt(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: reqwest::Url,
    headers: &[(String, String)],
    body: Option<&Value>,
) -> Result<(reqwest::StatusCode, String), String> {
    let mut builder = client.request(method, url);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = body {
        builder = builder.json(body);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("HTTP capability request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("HTTP capability response body read failed: {error}"))?;
    Ok((status, body))
}

fn capability_request_headers(
    capability_name: &str,
    request: &Value,
) -> Result<Vec<(String, String)>, String> {
    let mut headers = Vec::new();
    if let Some(request_headers) = request
        .pointer("/options/headers")
        .and_then(Value::as_object)
    {
        for (name, value) in request_headers {
            if is_sensitive_header(name) {
                return Err(format!(
                    "Capability {capability_name} request header {name} is not allowed; use declared secret-backed auth instead."
                ));
            }
            let value = value.as_str().ok_or_else(|| {
                format!("Capability {capability_name} request header {name} must be a string.")
            })?;
            headers.push((name.to_string(), value.to_string()));
        }
    }
    if let Some(idempotency_key) = request
        .pointer("/options/idempotencyKey")
        .and_then(Value::as_str)
    {
        headers.push(("Idempotency-Key".to_string(), idempotency_key.to_string()));
    }
    Ok(headers)
}

async fn append_secret_ref_auth_header(
    capability_name: &str,
    descriptor: &Value,
    secret_resolver: Option<&CapabilitySecretResolver>,
    headers: &mut Vec<(String, String)>,
) -> Result<(), String> {
    let auth_type = descriptor
        .pointer("/auth/type")
        .and_then(Value::as_str)
        .unwrap_or("none");
    if auth_type == "none" {
        return Ok(());
    }
    if auth_type != "secretRef" {
        return Err(format!(
            "Capability {capability_name} auth type {auth_type} is not implemented for live HTTP execution."
        ));
    }
    let secret_ref = capability_secret_ref(capability_name, descriptor)?;
    let resolver = secret_resolver.ok_or_else(|| {
        format!("Capability {capability_name} secretRef auth requires Kubernetes Secret access.")
    })?;
    let secret_value = resolver(secret_ref).await?;
    headers.push((
        "Authorization".to_string(),
        format!("Bearer {secret_value}"),
    ));
    Ok(())
}

fn capability_secret_ref(
    capability_name: &str,
    descriptor: &Value,
) -> Result<CapabilitySecretRef, String> {
    let secret_ref = descriptor
        .pointer("/auth/secretRef")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!("Capability {capability_name} secretRef auth is missing secretRef.")
        })?;
    let name = secret_ref
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Capability {capability_name} secretRef.name is required."))?;
    let key = secret_ref
        .get("key")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Capability {capability_name} secretRef.key is required."))?;
    let namespace = secret_ref
        .get("namespace")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(CapabilitySecretRef {
        name: name.to_string(),
        namespace,
        key: key.to_string(),
    })
}

fn kubernetes_secret_resolver(
    client: Client,
    default_namespace: Option<String>,
) -> CapabilitySecretResolver {
    Arc::new(move |secret_ref: CapabilitySecretRef| {
        let client = client.clone();
        let default_namespace = default_namespace.clone();
        Box::pin(async move {
            if let (Some(namespace), Some(default_namespace)) = (
                secret_ref.namespace.as_deref(),
                default_namespace.as_deref(),
            ) {
                if namespace != default_namespace {
                    return Err(format!(
                        "Capability secretRef {}/{} references namespace {namespace}; cross-namespace Secret auth is not supported.",
                        secret_ref.name, secret_ref.key
                    ));
                }
            }
            let namespace = secret_ref
                .namespace
                .as_deref()
                .or(default_namespace.as_deref())
                .ok_or_else(|| {
                    format!(
                        "Capability secretRef {}/{} requires a namespace or APPLIK8S_POD_NAMESPACE.",
                        secret_ref.name, secret_ref.key
                    )
                })?;
            let secrets: Api<Secret> = Api::namespaced(client, namespace);
            let secret = secrets.get(&secret_ref.name).await.map_err(|error| {
                format!(
                    "Failed to read Secret {namespace}/{} for capability auth: {error}",
                    secret_ref.name
                )
            })?;
            let bytes = secret
                .data
                .as_ref()
                .and_then(|data| data.get(&secret_ref.key))
                .ok_or_else(|| {
                    format!(
                        "Secret {namespace}/{} does not contain required key {} for capability auth.",
                        secret_ref.name, secret_ref.key
                    )
                })?;
            String::from_utf8(bytes.0.clone()).map_err(|error| {
                format!(
                    "Secret {namespace}/{} key {} is not valid UTF-8: {error}",
                    secret_ref.name, secret_ref.key
                )
            })
        })
    })
}

fn capability_retry_policy(descriptor: &Value) -> Result<CapabilityRetryPolicy, String> {
    let Some(retry) = descriptor.pointer("/policy/retry") else {
        return Ok(CapabilityRetryPolicy {
            max_attempts: 1,
            backoff_ms: 0,
            max_backoff_ms: 0,
        });
    };
    let max_attempts = retry
        .get("maxAttempts")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Capability retry.maxAttempts must be a positive integer.".to_string())?;
    let backoff_ms = retry
        .get("backoffMs")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Capability retry.backoffMs must be a positive integer.".to_string())?;
    let max_backoff_ms = retry
        .get("maxBackoffMs")
        .and_then(Value::as_u64)
        .unwrap_or(backoff_ms);
    if max_attempts == 0 || max_attempts > 5 {
        return Err("Capability retry.maxAttempts must be between 1 and 5.".to_string());
    }
    if backoff_ms == 0 || backoff_ms > 30_000 || max_backoff_ms == 0 || max_backoff_ms > 30_000 {
        return Err(
            "Capability retry backoff values must be between 1 and 30000 milliseconds.".to_string(),
        );
    }
    Ok(CapabilityRetryPolicy {
        max_attempts,
        backoff_ms,
        max_backoff_ms,
    })
}

async fn capability_retry_sleep(
    capability_name: &str,
    attempt: u64,
    retry_policy: &CapabilityRetryPolicy,
) {
    let delay_ms = retry_policy
        .backoff_ms
        .saturating_mul(2_u64.saturating_pow(attempt.saturating_sub(1) as u32))
        .min(retry_policy.max_backoff_ms);
    event!(
        Level::WARN,
        capability = capability_name,
        attempt,
        delay_ms,
        handler_abi = SUPPORTED_HANDLER_ABI,
        "capability request retry scheduled"
    );
    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
}

fn retryable_status(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

fn validate_live_http_capability(
    capability_name: &str,
    descriptor: &Value,
    method: &str,
    path: &str,
    request: &Value,
) -> Result<(), String> {
    if descriptor.get("kind").and_then(Value::as_str) != Some("http") {
        return Err(format!(
            "Capability {capability_name} is not an HTTP capability."
        ));
    }
    if descriptor
        .pointer("/execution/liveExecution")
        .and_then(Value::as_str)
        != Some("hostProtocol")
        || descriptor
            .pointer("/execution/protocol")
            .and_then(Value::as_str)
            != Some("applik8s.capability/v1alpha1")
    {
        return Err(format!(
            "Capability {capability_name} is declared but live hostProtocol execution is not enabled."
        ));
    }
    let auth_type = descriptor
        .pointer("/auth/type")
        .and_then(Value::as_str)
        .unwrap_or("none");
    if !matches!(auth_type, "none" | "secretRef") {
        return Err(format!(
            "Capability {capability_name} auth type {auth_type} is not implemented for live HTTP execution yet."
        ));
    }
    if !matches!(method, "GET" | "POST" | "PUT" | "DELETE") {
        return Err(format!(
            "Capability {capability_name} method {method} is not supported."
        ));
    }
    if !path.starts_with('/') || path.starts_with("//") || path.contains("://") {
        return Err(format!(
            "Capability {capability_name} path must be an absolute path without scheme or host."
        ));
    }
    if matches!(method, "POST" | "PUT" | "DELETE")
        && descriptor
            .pointer("/execution/idempotency/requiredForMutations")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        && request
            .pointer("/options/idempotencyKey")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err(format!(
            "Capability {capability_name} mutation method {method} requires options.idempotencyKey."
        ));
    }
    Ok(())
}

fn capability_request_url(descriptor: &Value, path: &str) -> Result<reqwest::Url, String> {
    let endpoint = descriptor
        .get("endpoint")
        .and_then(Value::as_str)
        .ok_or_else(|| "HTTP capability endpoint is required.".to_string())?;
    let url = reqwest::Url::parse(endpoint)
        .map_err(|error| format!("HTTP capability endpoint is invalid: {error}"))?
        .join(path.trim_start_matches('/'))
        .map_err(|error| format!("HTTP capability request path is invalid: {error}"))?;
    if let Some(allowed_hosts) = descriptor
        .pointer("/policy/networkPolicy/allowedHosts")
        .and_then(Value::as_array)
    {
        let host = url.host_str().unwrap_or_default();
        if !allowed_hosts
            .iter()
            .any(|allowed| allowed.as_str() == Some(host))
        {
            return Err(format!(
                "HTTP capability host {host} is not in policy.networkPolicy.allowedHosts."
            ));
        }
    }
    if let Some(allowed_ports) = descriptor
        .pointer("/policy/networkPolicy/allowedPorts")
        .and_then(Value::as_array)
    {
        let port = url.port_or_known_default().unwrap_or(0) as u64;
        if !allowed_ports
            .iter()
            .any(|allowed| allowed.as_u64() == Some(port))
        {
            return Err(format!(
                "HTTP capability port {port} is not in policy.networkPolicy.allowedPorts."
            ));
        }
    }
    Ok(url)
}

fn capability_timeout(descriptor: &Value, request: &Value) -> Result<Duration, String> {
    let descriptor_timeout = descriptor
        .pointer("/policy/timeoutMs")
        .and_then(Value::as_u64);
    let request_timeout = request
        .pointer("/options/timeoutMs")
        .and_then(Value::as_u64);
    let timeout_ms = match (descriptor_timeout, request_timeout) {
        (Some(max), Some(requested)) if requested > max => {
            return Err(format!(
                "Capability request timeoutMs {requested} exceeds descriptor timeoutMs {max}."
            ));
        }
        (_, Some(requested)) => requested,
        (Some(max), None) => max,
        (None, None) => 5_000,
    };
    if timeout_ms == 0 || timeout_ms > 30_000 {
        return Err("Capability timeoutMs must be between 1 and 30000.".to_string());
    }
    Ok(Duration::from_millis(timeout_ms))
}

fn http_method(method: &str) -> Result<reqwest::Method, String> {
    match method {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "DELETE" => Ok(reqwest::Method::DELETE),
        _ => Err(format!("unsupported HTTP capability method {method}")),
    }
}

fn required_capability_request_string<'a>(
    request: &'a Value,
    field: &str,
) -> Result<&'a str, String> {
    request
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Capability request field {field} is required."))
}

fn is_sensitive_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "set-cookie"
            | "x-api-key"
            | "x-amz-security-token"
    )
}

fn capability_error_response(code: &str, message: &str) -> String {
    serde_json::json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message,
            "severity": "error",
            "context": {},
        }
    })
    .to_string()
}

#[derive(Clone)]
struct RuntimeContext {
    host: OperatorHost,
    bundle: Arc<LoadedOperatorBundle>,
}

impl Default for KubeRuntimeControllerStrategy {
    fn default() -> Self {
        Self {
            framework: "kube-runtime::Controller",
        }
    }
}

impl KubeRuntimeControllerStrategy {
    pub fn requeue_after(&self, duration: Duration) -> Action {
        Action::requeue(duration)
    }
}

pub fn host_role() -> &'static str {
    "kube-rs operator host for applik8s WASM handlers"
}

pub fn controller_framework() -> &'static str {
    KubeRuntimeControllerStrategy::default().framework
}

pub struct ProbeHttpResponse {
    pub status_code: u16,
    pub body: Value,
}

#[derive(Clone)]
pub struct RuntimeReadiness {
    ready: Arc<AtomicBool>,
}

impl RuntimeReadiness {
    pub fn new() -> Self {
        Self {
            ready: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }

    pub fn mark_not_ready(&self) {
        self.ready.store(false, Ordering::SeqCst);
    }

    pub fn begin_shutdown(&self) {
        self.mark_not_ready();
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub fn probe_response(&self, path: &str) -> ProbeHttpResponse {
        probe_response(path, self.is_ready())
    }
}

impl Default for RuntimeReadiness {
    fn default() -> Self {
        Self::new()
    }
}

pub fn probe_response(path: &str, ready: bool) -> ProbeHttpResponse {
    match path {
        "/healthz" => ProbeHttpResponse {
            status_code: 200,
            body: serde_json::json!({ "status": "healthy" }),
        },
        "/readyz" if ready => ProbeHttpResponse {
            status_code: 200,
            body: serde_json::json!({ "status": "ready" }),
        },
        "/readyz" => ProbeHttpResponse {
            status_code: 503,
            body: serde_json::json!({ "status": "notReady" }),
        },
        _ => ProbeHttpResponse {
            status_code: 404,
            body: serde_json::json!({ "status": "notFound" }),
        },
    }
}

pub async fn start_health_server(
    addr: SocketAddr,
    readiness: RuntimeReadiness,
    shutdown: watch::Receiver<bool>,
) -> Result<tokio::task::JoinHandle<()>, OperatorHostError> {
    let listener = TcpListener::bind(addr)
        .await
        .map_err(OperatorHostError::HealthServer)?;
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .with_state(readiness);
    Ok(tokio::spawn(async move {
        let mut shutdown = shutdown;
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            wait_for_shutdown(&mut shutdown).await;
        });
        if let Err(error) = server.await {
            event!(
                Level::ERROR,
                error = %error,
                handler_abi = SUPPORTED_HANDLER_ABI,
                "health probe server failed"
            );
        }
    }))
}

fn start_controller_supervisor(
    controllers: Vec<RuntimeController>,
    context: Arc<RuntimeContext>,
    done_tx: Option<mpsc::UnboundedSender<()>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let tasks = controllers.into_iter().map(|runtime_controller| {
            let context = Arc::clone(&context);
            runtime_controller
                .controller
                .run(
                    |object, context| async move {
                        context
                            .host
                            .reconcile_dynamic_object(&context.bundle, (*object).clone())
                            .await
                    },
                    |object, error, context| {
                        context
                            .host
                            .retry_action(&context.bundle, object.as_ref(), error)
                    },
                    context,
                )
                .for_each(|result| async move {
                    if let Err(error) = result {
                        event!(
                            Level::ERROR,
                            error = ?error,
                            handler_abi = SUPPORTED_HANDLER_ABI,
                            "applik8s controller error"
                        );
                    }
                })
                .boxed()
        });
        join_all(tasks).await;
        if let Some(done_tx) = done_tx {
            let _ = done_tx.send(());
        }
    })
}

async fn stop_controller_supervisor(controller_supervisor: &mut Option<JoinHandle<()>>) {
    if let Some(handle) = controller_supervisor.take() {
        handle.abort();
        let _ = handle.await;
    }
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    while shutdown.changed().await.is_ok() {
        if *shutdown.borrow() {
            return;
        }
    }
}

async fn healthz() -> impl IntoResponse {
    probe_into_response(probe_response("/healthz", true))
}

async fn readyz(State(readiness): State<RuntimeReadiness>) -> impl IntoResponse {
    probe_into_response(readiness.probe_response("/readyz"))
}

fn probe_into_response(response: ProbeHttpResponse) -> impl IntoResponse {
    let status =
        StatusCode::from_u16(response.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status, Json(response.body))
}

pub fn init_tracing() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
        let _ = tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .try_init();
    });
}

pub fn init_otel_metrics() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        if std::env::var_os("OTEL_EXPORTER_OTLP_ENDPOINT").is_none()
            && std::env::var_os("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT").is_none()
        {
            return;
        }
        match opentelemetry_otlp::MetricExporter::builder().build() {
            Ok(exporter) => {
                let reader = PeriodicReader::builder(exporter).build();
                let provider = SdkMeterProvider::builder().with_reader(reader).build();
                global::set_meter_provider(provider);
            }
            Err(error) => {
                event!(
                    Level::WARN,
                    error = %error,
                    "OpenTelemetry metrics exporter configuration failed"
                );
            }
        }
    });
}

pub fn init_otel_traces() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        if std::env::var_os("OTEL_EXPORTER_OTLP_ENDPOINT").is_none()
            && std::env::var_os("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").is_none()
        {
            return;
        }
        match opentelemetry_otlp::SpanExporter::builder().build() {
            Ok(exporter) => {
                let provider = SdkTracerProvider::builder()
                    .with_batch_exporter(exporter)
                    .build();
                global::set_tracer_provider(provider);
            }
            Err(error) => {
                event!(
                    Level::WARN,
                    error = %error,
                    "OpenTelemetry trace exporter configuration failed"
                );
            }
        }
    });
}

pub async fn run_from_env() -> Result<(), OperatorHostError> {
    init_tracing();
    init_otel_metrics();
    init_otel_traces();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = Client::try_default().await?;
    let engine = component_model_engine()?;
    let bridge = KubeRuntimeBridge::new(client.clone(), engine);
    let host = OperatorHost::new(
        bridge,
        OperatorHostConfig {
            runtime_version: env!("CARGO_PKG_VERSION").to_string(),
            metrics_enabled: true,
            health_enabled: true,
            replay_artifact_dir: std::env::var_os("APPLIK8S_REPLAY_ARTIFACT_DIR")
                .map(PathBuf::from),
            replay_include_payloads: env_truthy("APPLIK8S_REPLAY_INCLUDE_PAYLOADS"),
        },
    );
    let readiness = RuntimeReadiness::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let health_server = if host.config.health_enabled {
        let addr = std::env::var("APPLIK8S_HEALTH_ADDR")
            .ok()
            .and_then(|value| value.parse::<SocketAddr>().ok())
            .unwrap_or_else(|| SocketAddr::from(([0, 0, 0, 0], 8080)));
        Some(start_health_server(addr, readiness.clone(), shutdown_rx).await?)
    } else {
        None
    };
    let bundle = Arc::new(LoadedOperatorBundle::load(&OperatorHostPaths::from_env())?);
    bundle.validate_runtime_compatibility(&host.config.runtime_version)?;
    bundle.validate_handler_host_imports(host.bridge.engine())?;
    let run_result = match bundle.leader_election_config()? {
        Some(leader_election) => {
            run_leader_elected_controllers(
                host.clone(),
                Arc::clone(&bundle),
                client,
                readiness.clone(),
                leader_election,
            )
            .await
        }
        None => {
            run_standalone_controllers(host.clone(), Arc::clone(&bundle), client, readiness.clone())
                .await
        }
    };
    readiness.begin_shutdown();
    let _ = shutdown_tx.send(true);
    if let Some(health_server) = health_server {
        let _ = tokio::time::timeout(Duration::from_secs(2), health_server).await;
    }
    run_result
}

async fn run_standalone_controllers(
    host: OperatorHost,
    bundle: Arc<LoadedOperatorBundle>,
    client: Client,
    readiness: RuntimeReadiness,
) -> Result<(), OperatorHostError> {
    let controllers = bundle.controllers(client)?;
    let context = Arc::new(RuntimeContext { host, bundle });
    let mut controller_supervisor = start_controller_supervisor(controllers, context, None);
    readiness.mark_ready();
    tokio::select! {
        _ = &mut controller_supervisor => {
            readiness.mark_not_ready();
        }
        signal = shutdown_signal() => {
            readiness.mark_not_ready();
            controller_supervisor.abort();
            match signal {
                Ok(()) => event!(Level::INFO, handler_abi = SUPPORTED_HANDLER_ABI, "shutdown signal received"),
                Err(error) => event!(Level::WARN, error = %error, handler_abi = SUPPORTED_HANDLER_ABI, "shutdown signal listener failed"),
            }
        }
    }
    Ok(())
}

async fn run_leader_elected_controllers(
    host: OperatorHost,
    bundle: Arc<LoadedOperatorBundle>,
    client: Client,
    readiness: RuntimeReadiness,
    leader_election: RuntimeLeaderElectionConfig,
) -> Result<(), OperatorHostError> {
    let operator_name = operator_name(&bundle.manifest);
    let lease_namespace = leader_election_namespace(&bundle, &leader_election)?;
    let grace_seconds = leader_election
        .lease_duration_seconds
        .saturating_sub(leader_election.renew_deadline_seconds);
    let mut builder = LeaseManagerBuilder::new(client.clone(), &leader_election.lease_name)
        .with_namespace(&lease_namespace)
        .with_duration(leader_election.lease_duration_seconds)
        .with_grace(grace_seconds)
        .with_field_manager(format!("applik8s-leader-election-{operator_name}"));
    if let Some(identity) = leader_election_identity(&operator_name) {
        builder = builder.with_identity(identity);
    }
    let manager = builder.build().await?;
    let (mut leadership, mut lease_task) = manager.watch().await;
    let (controller_done_tx, mut controller_done_rx) = mpsc::unbounded_channel();
    let mut controller_supervisor: Option<JoinHandle<()>> = None;
    let mut lease_task_finished = false;
    event!(
        Level::INFO,
        operator = %operator_name,
        lease = %leader_election.lease_name,
        lease_namespace = %lease_namespace,
        retry_period_seconds = leader_election.retry_period_seconds,
        handler_abi = SUPPORTED_HANDLER_ABI,
        "leader election started"
    );

    let result: Result<(), OperatorHostError> = loop {
        tokio::select! {
            changed = leadership.changed() => {
                if changed.is_err() {
                    readiness.mark_not_ready();
                    stop_controller_supervisor(&mut controller_supervisor).await;
                    break Err(OperatorHostError::InvalidRuntimeConfig("leader election state channel closed".to_string()));
                }
                let is_leader = *leadership.borrow_and_update();
                if is_leader {
                    if controller_supervisor.is_none() {
                        let controllers = bundle.controllers(client.clone())?;
                        let context = Arc::new(RuntimeContext { host: host.clone(), bundle: Arc::clone(&bundle) });
                        controller_supervisor = Some(start_controller_supervisor(controllers, context, Some(controller_done_tx.clone())));
                    }
                    readiness.mark_ready();
                    event!(Level::INFO, operator = %operator_name, handler_abi = SUPPORTED_HANDLER_ABI, "leadership acquired; controllers started");
                } else {
                    readiness.mark_not_ready();
                    stop_controller_supervisor(&mut controller_supervisor).await;
                    event!(Level::INFO, operator = %operator_name, handler_abi = SUPPORTED_HANDLER_ABI, "leadership lost; controllers stopped");
                }
            }
            _ = controller_done_rx.recv(), if controller_supervisor.is_some() => {
                readiness.mark_not_ready();
                if let Some(handle) = controller_supervisor.take() {
                    let _ = handle.await;
                }
                break Err(OperatorHostError::ControllerStopped);
            }
            lease_result = &mut lease_task => {
                lease_task_finished = true;
                readiness.mark_not_ready();
                stop_controller_supervisor(&mut controller_supervisor).await;
                match lease_result {
                    Ok(Ok(_manager)) => break Ok(()),
                    Ok(Err(error)) => break Err(OperatorHostError::LeaderElection(error)),
                    Err(error) => break Err(OperatorHostError::InvalidRuntimeConfig(format!("leader election task failed: {error}"))),
                }
            }
            signal = shutdown_signal() => {
                readiness.mark_not_ready();
                stop_controller_supervisor(&mut controller_supervisor).await;
                match signal {
                    Ok(()) => event!(Level::INFO, handler_abi = SUPPORTED_HANDLER_ABI, "shutdown signal received"),
                    Err(error) => event!(Level::WARN, error = %error, handler_abi = SUPPORTED_HANDLER_ABI, "shutdown signal listener failed"),
                }
                break Ok(());
            }
        }
    };
    drop(leadership);
    if !lease_task_finished {
        let _ = tokio::time::timeout(Duration::from_secs(2), lease_task).await;
    }
    result
}

fn leader_election_namespace(
    bundle: &LoadedOperatorBundle,
    config: &RuntimeLeaderElectionConfig,
) -> Result<String, OperatorHostError> {
    config
        .lease_namespace
        .clone()
        .or_else(|| default_watch_namespace(&bundle.manifest))
        .ok_or_else(|| {
            OperatorHostError::InvalidRuntimeConfig(
                "spec.runtime.leaderElection.leaseNamespace or deployment.namespace is required when leader election is enabled"
                    .to_string(),
            )
        })
}

fn leader_election_identity(operator_name: &str) -> Option<String> {
    [
        "APPLIK8S_LEADER_ELECTION_IDENTITY",
        "APPLIK8S_POD_NAME",
        "HOSTNAME",
    ]
    .into_iter()
    .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
    .or_else(|| Some(format!("{operator_name}-{}", std::process::id())))
}

fn operator_name(manifest: &Value) -> String {
    manifest
        .pointer("/metadata/name")
        .and_then(Value::as_str)
        .unwrap_or("applik8s-operator")
        .to_string()
}

async fn shutdown_signal() -> Result<(), std::io::Error> {
    tokio::signal::ctrl_c().await
}

fn read_to_string(path: &Path) -> Result<String, OperatorHostError> {
    fs::read_to_string(path).map_err(|source| OperatorHostError::ReadFailed {
        path: path.to_path_buf(),
        source,
    })
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, OperatorHostError> {
    fs::read(path).map_err(|source| OperatorHostError::ReadFailed {
        path: path.to_path_buf(),
        source,
    })
}

fn read_handler_bytes(paths: &OperatorHostPaths) -> Result<Vec<u8>, OperatorHostError> {
    if let Some(chunks_dir) = &paths.handler_chunks_dir {
        return read_handler_chunks(chunks_dir);
    }
    read_bytes(&paths.handler_path)
}

fn read_handler_chunks(chunks_dir: &Path) -> Result<Vec<u8>, OperatorHostError> {
    let mut paths = fs::read_dir(chunks_dir)
        .map_err(|error| OperatorHostError::InvalidHandlerChunks(error.to_string()))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| OperatorHostError::InvalidHandlerChunks(error.to_string()))?;
    paths.retain(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("part-"))
    });
    paths.sort();
    if paths.is_empty() {
        return Err(OperatorHostError::InvalidHandlerChunks(
            "no part-* files found".to_string(),
        ));
    }

    let mut compressed = Vec::new();
    for path in paths {
        compressed.extend(read_bytes(&path)?);
    }
    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|error| OperatorHostError::InvalidHandlerChunks(error.to_string()))?;
    if decompressed.is_empty() {
        return Err(OperatorHostError::EmptyHandlerArtifact);
    }
    Ok(decompressed)
}

fn required_string(value: &Value, field: &str) -> Result<String, OperatorHostError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| OperatorHostError::InvalidOwnedCrd(format!("missing {field}")))
}

fn api_resource_for_watch(watch: &OwnedResourceWatch) -> Result<ApiResource, OperatorHostError> {
    let (group, version) = split_api_version(&watch.api_version)?;
    let gvk = GroupVersionKind::gvk(&group, &version, &watch.kind);
    let mut api_resource = ApiResource::from_gvk(&gvk);
    api_resource.plural = watch.plural.clone();
    Ok(api_resource)
}

fn split_api_version(api_version: &str) -> Result<(String, String), OperatorHostError> {
    if let Some((group, version)) = api_version.split_once('/') {
        if group.is_empty() || version.is_empty() {
            return Err(OperatorHostError::InvalidOwnedCrd(format!(
                "invalid apiVersion {api_version}"
            )));
        }
        return Ok((group.to_string(), version.to_string()));
    }

    if api_version.is_empty() {
        return Err(OperatorHostError::InvalidOwnedCrd(
            "apiVersion must not be empty".to_string(),
        ));
    }
    Ok((String::new(), api_version.to_string()))
}

fn object_ref_from_value(value: &Value) -> Result<ObjectRef, OperatorHostError> {
    Ok(ObjectRef {
        api_version: value
            .get("apiVersion")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidOwnedCrd("object missing apiVersion".to_string())
            })?
            .to_string(),
        kind: value
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| OperatorHostError::InvalidOwnedCrd("object missing kind".to_string()))?
            .to_string(),
        name: value
            .pointer("/metadata/name")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                OperatorHostError::InvalidOwnedCrd("object missing metadata.name".to_string())
            })?
            .to_string(),
        namespace: value
            .pointer("/metadata/namespace")
            .and_then(Value::as_str)
            .map(str::to_string),
        uid: value
            .pointer("/metadata/uid")
            .and_then(Value::as_str)
            .map(str::to_string),
        resource_version: value
            .pointer("/metadata/resourceVersion")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn action_for_plan(plan: &applik8s_runtime_contract::NormalizedOperationPlan) -> Action {
    for operation in &plan.operations {
        if let Operation::Requeue { policy } = operation {
            if let Some(after_seconds) = policy.after_seconds {
                return Action::requeue(Duration::from_secs_f64(after_seconds));
            }
        }
    }
    Action::await_change()
}
