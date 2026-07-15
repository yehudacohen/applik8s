use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use applik8s_runtime_bridge::{
    KubernetesHttpTransport, RuntimeBridgeError, capability_denied_payload, component_host_imports,
    component_model_engine, decode_handler_input_payload, decode_handler_output_plan_payload,
    invoke_handler_component_bytes, invoke_handler_component_bytes_with_timeout,
    invoke_handler_component_bytes_with_timeout_and_capabilities_async,
    invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async,
    invoke_handler_component_bytes_with_timeout_async, retry_after, runtime_abi_version,
    validate_component_host_imports, validate_handler_input, validate_operation_plan,
};
use kube::runtime::controller::Action;
use wasmtime::Store;
use wasmtime::component::{Component, Linker};

const VALID_DIGEST: &str =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";

#[test]
fn capability_denial_payload_is_structured_and_non_retryable() {
    let payload: serde_json::Value =
        serde_json::from_str(&capability_denied_payload()).expect("payload is JSON");

    assert_eq!(payload["code"], "CAPABILITY_DENIED");
    assert_eq!(payload["retryable"], false);
    assert!(
        payload["message"]
            .as_str()
            .unwrap_or_default()
            .contains("not implemented")
    );
}

fn valid_handler_input_payload() -> serde_json::Value {
    serde_json::json!({
        "abiVersion": runtime_abi_version(),
        "handlerId": "ImageJob.reconcile.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "media.applik8s.dev/v1alpha1",
            "kind": "ImageJob",
            "metadata": { "name": "hero-image" },
            "spec": {}
        },
        "runtime": {
            "operatorName": "image-pipeline",
            "reconcileId": "reconcile-1",
            "bundleDigest": VALID_DIGEST,
            "runtimeVersion": "0.1.0",
            "startedAt": "2026-06-19T00:00:00Z"
        }
    })
}

fn canonical_result_handler_component_bytes() -> Vec<u8> {
    wat::parse_str(
        r#"
        (component
          (core module $handler
            (memory (export "memory") 1)
            (func (export "cabi_realloc") (param i32 i32 i32 i32) (result i32)
              i32.const 64)
            (func (export "handle") (param i32 i32) (result i32)
              i32.const 32)
            (data (i32.const 8) "{\"operations\":[]}")
            (data (i32.const 32) "\00\00\00\00\08\00\00\00\11\00\00\00")
          )
          (core instance $handler-instance (instantiate $handler))
          (alias core export $handler-instance "memory" (core memory $memory))
          (alias core export $handler-instance "cabi_realloc" (core func $realloc))
          (alias core export $handler-instance "handle" (core func $handle-core))
          (func $handle (param "input-json" string) (result (result string (error string)))
            (canon lift (core func $handle-core) (memory $memory) (realloc $realloc) string-encoding=utf8))
          (export "handle" (func $handle))
        )
        "#,
    )
    .expect("result handler component fixture parses")
}

fn imported_host_function_component_bytes(import_name: &str) -> Vec<u8> {
    wat::parse_str(format!(
        r#"
        (component
          (import {import_name:?} (func))
        )
        "#,
    ))
    .expect("imported host function component fixture parses")
}

fn non_terminating_handler_component_bytes() -> Vec<u8> {
    wat::parse_str(
        r#"
        (component
          (core module $handler
            (memory (export "memory") 1)
            (func (export "cabi_realloc") (param i32 i32 i32 i32) (result i32)
              i32.const 64)
            (func (export "handle") (param i32 i32) (result i32)
              loop $again
                br $again
              end
              i32.const 32)
          )
          (core instance $handler-instance (instantiate $handler))
          (alias core export $handler-instance "memory" (core memory $memory))
          (alias core export $handler-instance "cabi_realloc" (core func $realloc))
          (alias core export $handler-instance "handle" (core func $handle-core))
          (func $handle (param "input-json" string) (result (result string (error string)))
            (canon lift (core func $handle-core) (memory $memory) (realloc $realloc) string-encoding=utf8))
          (export "handle" (func $handle))
        )
        "#,
    )
    .expect("non-terminating handler component fixture parses")
}

fn trapping_handler_component_bytes() -> Vec<u8> {
    wat::parse_str(
        r#"
        (component
          (core module $handler
            (memory (export "memory") 1)
            (func (export "cabi_realloc") (param i32 i32 i32 i32) (result i32) i32.const 64)
            (func (export "handle") (param i32 i32) (result i32) unreachable)
          )
          (core instance $handler-instance (instantiate $handler))
          (alias core export $handler-instance "memory" (core memory $memory))
          (alias core export $handler-instance "cabi_realloc" (core func $realloc))
          (alias core export $handler-instance "handle" (core func $handle-core))
          (func $handle (param "input-json" string) (result (result string (error string)))
            (canon lift (core func $handle-core) (memory $memory) (realloc $realloc) string-encoding=utf8))
          (export "handle" (func $handle))
        )
        "#,
    )
    .expect("trapping handler component fixture parses")
}

#[test]
fn configures_wasmtime_component_engine() {
    component_model_engine().expect("component model engine configures");
}

#[test]
fn rejects_component_host_imports_that_are_not_declared() {
    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = imported_host_function_component_bytes("undeclared-import");
    let component = Component::new(&engine, component_bytes).expect("component compiles");

    let imports = component_host_imports(&engine, &component).expect("component imports inspect");
    let error = validate_component_host_imports(&engine, &component, &["log".to_string()])
        .expect_err("undeclared import is rejected");

    assert_eq!(imports, vec!["undeclared-import".to_string()]);
    assert!(matches!(
        error,
        RuntimeBridgeError::UndeclaredHostImport(import) if import == "undeclared-import"
    ));
}

#[test]
fn accepts_component_host_imports_that_are_declared() {
    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = imported_host_function_component_bytes("log");
    let component = Component::new(&engine, component_bytes).expect("component compiles");

    validate_component_host_imports(&engine, &component, &["log".to_string()])
        .expect("declared import is accepted");
}

#[test]
fn invokes_canonical_result_handler_export_through_wasmtime_component_model() {
    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = canonical_result_handler_component_bytes();
    let component =
        Component::new(&engine, component_bytes).expect("result handler component compiles");
    let mut store = Store::new(&engine, ());
    store.set_epoch_deadline(1_000_000_000);
    store.epoch_deadline_trap();
    let linker = Linker::new(&engine);
    let instance = linker
        .instantiate(&mut store, &component)
        .expect("result handler component instantiates");
    let handle = instance
        .get_func(&mut store, "handle")
        .expect("handle export exists");
    let handle = handle
        .typed::<(&str,), (Result<String, String>,)>(&store)
        .expect("handle export has canonical result<string,string> wire shape");
    let result = handle
        .call(&mut store, (r#"{"operations":[]}"#,))
        .expect("handle export invokes")
        .0;

    let output_plan = result.expect("handler returns ok operation plan JSON");
    assert_eq!(output_plan, r#"{"operations":[]}"#);
    decode_handler_output_plan_payload(
        serde_json::from_str(&output_plan).expect("handler output is valid JSON"),
    )
    .expect("handler output validates against runtime contract");
}

#[test]
fn bridge_invokes_handler_component_and_decodes_output_plan() {
    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = canonical_result_handler_component_bytes();
    let plan =
        invoke_handler_component_bytes(&engine, &component_bytes, valid_handler_input_payload())
            .expect("bridge invokes canonical handler component");

    assert!(plan.operations.is_empty());
}

#[test]
fn componentized_handler_preserves_nested_status_fields_by_name() {
    let workspace_root = workspace_root();
    let temp_dir = test_temp_dir("componentize-js-nested-status");
    fs::create_dir_all(&temp_dir).expect("test temp directory creates");
    let js_path = temp_dir.join("handler.js");
    let wit_path = temp_dir.join("handler.wit");
    let wasm_path = temp_dir.join("handler.wasm");
    fs::write(
        &js_path,
        r#"
export function handle() {
  return JSON.stringify({ operations: [{ kind: 'status', status: { volumes: [{ conditions: [{ type: 'Ready', status: 'True', observedGeneration: 17, lastTransitionTime: '2026-07-14T12:34:56Z' }] }] } }] });
}
"#,
    )
    .expect("nested status handler source writes");
    fs::write(
        &wit_path,
        r#"package applik8s:handler;

world handler {
  import log: func(event-json: string);
  import cancel: func(reason-json: string);
  export handle: func(input-json: string) -> result<string, string>;
}
"#,
    )
    .expect("nested status handler WIT writes");

    let output = Command::new(workspace_root.join("node_modules/.bin/componentize-js"))
        .arg(&js_path)
        .arg("--wit")
        .arg(&wit_path)
        .arg("--world-name")
        .arg("handler")
        .arg("--out")
        .arg(&wasm_path)
        .current_dir(workspace_root)
        .output()
        .expect("componentize-js command starts");
    assert!(
        output.status.success(),
        "componentize-js failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = fs::read(&wasm_path).expect("emitted component reads");
    let plan = invoke_handler_component_bytes_with_timeout(
        &engine,
        &component_bytes,
        valid_handler_input_payload(),
        &applik8s_runtime_bridge::canonical_host_imports(),
        Duration::from_secs(30),
    )
    .expect("bridge invokes ComponentizeJS-emitted nested status handler");
    let operation = serde_json::to_value(&plan.operations[0]).expect("status operation serializes");
    let condition = operation
        .pointer("/status/volumes/0/conditions/0")
        .expect("nested condition is present");
    assert_eq!(condition["type"], "Ready");
    assert_eq!(condition["status"], "True");
    assert_eq!(condition["observedGeneration"], 17);
    assert_eq!(condition["lastTransitionTime"], "2026-07-14T12:34:56Z");

    fs::remove_dir_all(&temp_dir).expect("test temp directory removes");
}

#[test]
fn bridge_times_out_non_terminating_handler_component() {
    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = non_terminating_handler_component_bytes();
    let error = invoke_handler_component_bytes_with_timeout(
        &engine,
        &component_bytes,
        valid_handler_input_payload(),
        &[],
        Duration::from_millis(30),
    )
    .expect_err("non-terminating component times out");

    assert!(
        matches!(
            error,
            RuntimeBridgeError::HandlerTimedOut { timeout_ms: 30 }
        ),
        "expected HandlerTimedOut, got {error:?}"
    );
}

#[test]
fn cpu_bound_guest_yields_to_control_plane_tasks_before_timeout() {
    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = non_terminating_handler_component_bytes();
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("test runtime builds")
        .block_on(async {
            let invocation = invoke_handler_component_bytes_with_timeout_async(
                &engine,
                &component_bytes,
                valid_handler_input_payload(),
                &[],
                Duration::from_millis(100),
            );
            tokio::pin!(invocation);

            let started = Instant::now();
            let timer_result =
                tokio::time::timeout(Duration::from_millis(20), &mut invocation).await;
            assert!(
                timer_result.is_err(),
                "the control-plane timer must run before the guest's own timeout"
            );
            assert!(
                started.elapsed() < Duration::from_millis(70),
                "a CPU-bound guest must cooperatively yield so the control-plane timer is not delayed until the 100ms handler timeout"
            );

            let error = invocation
                .await
                .expect_err("non-terminating component still obeys its wall-clock timeout");
            assert!(
                matches!(
                    error,
                    RuntimeBridgeError::HandlerTimedOut { timeout_ms: 100 }
                ),
                "expected HandlerTimedOut, got {error:?}"
            );
        });
}

#[test]
fn bridge_classifies_guest_traps_as_handler_traps() {
    let engine = component_model_engine().expect("component model engine configures");
    let error = invoke_handler_component_bytes(
        &engine,
        &trapping_handler_component_bytes(),
        valid_handler_input_payload(),
    )
    .expect_err("guest trap is surfaced");

    assert!(
        matches!(error, RuntimeBridgeError::HandlerTrap(_)),
        "expected HandlerTrap, got {error:?}"
    );
}

#[test]
fn bridge_invokes_componentize_js_handler_with_capability_import() {
    let workspace_root = workspace_root();
    let temp_dir = test_temp_dir("componentize-js-handler");
    fs::create_dir_all(&temp_dir).expect("test temp directory creates");
    let js_path = temp_dir.join("handler.js");
    let wit_path = temp_dir.join("applik8s-handler.wit");
    let wasm_path = temp_dir.join("handler.wasm");

    fs::write(
        &js_path,
        r#"
import { capabilityRequest } from 'applik8s:handler/capabilities';

export function handle(_inputJson) {
  const raw = capabilityRequest(JSON.stringify({ capabilityName: 'processor', method: 'GET', path: '/healthz' }));
  const responseJson = typeof raw === 'string' ? raw : raw.val;
  const response = JSON.parse(responseJson);
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return JSON.stringify({ operations: [{ kind: 'status', status: { phase: response.value.ready ? 'Ready' : 'NotReady' } }] });
}
"#,
    )
    .expect("handler source writes");
    fs::write(
        &wit_path,
        r#"package applik8s:handler;

interface capabilities {
  capability-request: func(request-json: string) -> result<string, string>;
}

world handler {
  import capabilities;
  import log: func(event-json: string);
  import cancel: func(reason-json: string);

  export handle: func(input-json: string) -> result<string, string>;
}
"#,
    )
    .expect("handler WIT writes");

    let output = Command::new(workspace_root.join("node_modules/.bin/componentize-js"))
        .arg(&js_path)
        .arg("--wit")
        .arg(&wit_path)
        .arg("--world-name")
        .arg("handler")
        .arg("--out")
        .arg(&wasm_path)
        .current_dir(workspace_root)
        .output()
        .expect("componentize-js command starts");
    assert!(
        output.status.success(),
        "componentize-js failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = fs::read(&wasm_path).expect("emitted component reads");
    let plan = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .enable_io()
        .build()
        .expect("test runtime builds")
        .block_on(
            invoke_handler_component_bytes_with_timeout_and_capabilities_async(
                &engine,
                &component_bytes,
                valid_handler_input_payload(),
                &applik8s_runtime_bridge::canonical_host_imports(),
                Duration::from_secs(30),
                std::sync::Arc::new(|request_json| {
                    Box::pin(async move {
                        let request: serde_json::Value = serde_json::from_str(&request_json)
                            .expect("capability request is JSON");
                        assert_eq!(request["capabilityName"], "processor");
                        assert_eq!(request["method"], "GET");
                        assert_eq!(request["path"], "/healthz");
                        Ok(
                            serde_json::json!({ "ok": true, "value": { "ready": true } })
                                .to_string(),
                        )
                    })
                }),
            ),
        )
        .expect("bridge invokes ComponentizeJS-emitted handler with capability import");

    assert_eq!(plan.operations.len(), 1);

    fs::remove_dir_all(&temp_dir).expect("test temp directory removes");
}

#[test]
fn bridge_injects_kubernetes_identity_and_restricts_component_wasi_http() {
    let workspace_root = workspace_root();
    let temp_dir = test_temp_dir("componentize-js-fetch-handler");
    fs::create_dir_all(&temp_dir).expect("test temp directory creates");
    let entry_path = temp_dir.join("entry.js");
    let helper_path = temp_dir.join("transformation.js");
    let js_path = temp_dir.join("handler.js");
    let wit_path = temp_dir.join("applik8s-handler.wit");
    let wasm_path = temp_dir.join("handler.wasm");

    fs::write(
        &helper_path,
        r#"
function draftProxy(value, writes, path = []) {
  return new Proxy(value, {
    get(target, property) {
      const result = Reflect.get(target, property);
      return result && typeof result === 'object'
        ? draftProxy(result, writes, [...path, String(property)])
        : result;
    },
    set(target, property, nextValue) {
      writes.push({ path: [...path, String(property)].join('.'), value: nextValue });
      return Reflect.set(target, property, nextValue);
    },
  });
}

export async function transformFromEndpoint(url) {
  const response = await fetch(url);
  const payload = await response.json();
  const writes = [];
  const draft = draftProxy({ spec: { replicas: 0 } }, writes);
  draft.spec.replicas = payload.replicas;
  if (draft.spec.replicas !== payload.replicas) {
    throw new Error('proxy reads after writes did not observe the destination draft value');
  }
  if (writes.length !== 1 || writes[0].path !== 'spec.replicas') {
    throw new Error('proxy mutation was not recorded deterministically');
  }
  return { replicas: draft.spec.replicas, writes };
}

export async function unreachableNodeOnlyBranch() {
  return import('node:fs');
}
"#,
    )
    .expect("transformation helper writes");
    fs::write(
        &entry_path,
        r#"
import { transformFromEndpoint } from './transformation.js';

export async function handle(_inputJson) {
  const result = await transformFromEndpoint('http://kubernetes.default.svc/desired');
  return JSON.stringify({ operations: [{ kind: 'status', status: { phase: result.replicas === 3 ? 'Ready' : 'NotReady', writes: result.writes } }] });
}
"#,
    )
    .expect("handler entry source writes");
    fs::write(
        &wit_path,
        r#"package applik8s:handler;

world handler {
  export handle: func(input-json: string) -> result<string, string>;
}
"#,
    )
    .expect("handler WIT writes");

    let bundle_output = Command::new(workspace_root.join("node_modules/.bin/esbuild"))
        .arg(&entry_path)
        .arg("--bundle")
        .arg("--format=esm")
        .arg("--platform=browser")
        .arg("--target=es2022")
        .arg("--external:node:fs")
        .arg(format!("--outfile={}", js_path.display()))
        .current_dir(workspace_root.clone())
        .output()
        .expect("esbuild command starts");
    assert!(
        bundle_output.status.success(),
        "esbuild failed: stdout={} stderr={}",
        String::from_utf8_lossy(&bundle_output.stdout),
        String::from_utf8_lossy(&bundle_output.stderr)
    );
    let bundled_source = fs::read_to_string(&js_path).expect("bundled handler reads");
    assert!(
        !bundled_source.contains("node:fs"),
        "unreachable Node-only dependency branch must be tree-shaken"
    );

    let output = Command::new(workspace_root.join("node_modules/.bin/componentize-js"))
        .arg(&js_path)
        .arg("--wit")
        .arg(&wit_path)
        .arg("--world-name")
        .arg("handler")
        .arg("--out")
        .arg(&wasm_path)
        .current_dir(workspace_root)
        .output()
        .expect("componentize-js command starts");
    assert!(
        output.status.success(),
        "componentize-js failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let engine = component_model_engine().expect("component model engine configures");
    let component_bytes = fs::read(&wasm_path).expect("emitted component reads");
    let certified = rcgen::generate_simple_self_signed(vec!["kubernetes.test".to_string()])
        .expect("test certificate generates");
    let certificate = certified.cert.der().clone();
    let private_key =
        rustls::pki_types::PrivatePkcs8KeyDer::from(certified.signing_key.serialize_der());
    let _ = rustls::crypto::ring::default_provider().install_default();
    let tls_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![certificate.clone()], private_key.into())
        .expect("test TLS server configures");
    let tls_listener = TcpListener::bind("127.0.0.1:0").expect("TLS test server binds");
    let tls_addr = tls_listener
        .local_addr()
        .expect("TLS test server has local address");
    let tls_server = std::thread::spawn(move || {
        let (stream, _) = tls_listener
            .accept()
            .expect("TLS test server accepts request");
        let connection = rustls::ServerConnection::new(std::sync::Arc::new(tls_config))
            .expect("TLS server connection creates");
        let mut stream = rustls::StreamOwned::new(connection, stream);
        let mut request = [0_u8; 1024];
        let _ = stream
            .read(&mut request)
            .expect("TLS test server reads request");
        let request = String::from_utf8_lossy(&request);
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer rotating-file-token")
        );
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 14\r\nconnection: close\r\n\r\n{\"replicas\":3}",
            )
            .expect("TLS test server writes response");
    });
    let token_path = temp_dir.join("service-account-token");
    fs::write(&token_path, "rotating-file-token\n").expect("rotating token fixture writes");
    let tls_plan = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .enable_io()
        .build()
        .expect("TLS test runtime builds")
        .block_on(
            invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async(
                &engine,
                &component_bytes,
                valid_handler_input_payload(),
                &applik8s_runtime_bridge::canonical_host_imports(),
                Duration::from_secs(30),
                KubernetesHttpTransport {
                    guest_endpoint: "http://kubernetes.default.svc".to_string(),
                    endpoint: format!("https://{tls_addr}"),
                    bearer_token: None,
                    bearer_token_file: Some(token_path),
                    ca_certificates: vec![certificate.as_ref().to_vec()],
                    tls_server_name: Some("kubernetes.test".to_string()),
                },
            ),
        )
        .expect("bridge trusts the cluster CA, overrides the TLS name, and reads the token file");
    assert_eq!(tls_plan.operations.len(), 1);
    tls_server.join().expect("TLS test server joins");

    let secret = "token-that-must-not-appear-in-errors";
    let denied = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .enable_io()
        .build()
        .expect("denial test runtime builds")
        .block_on(
            invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async(
                &engine,
                &component_bytes,
                valid_handler_input_payload(),
                &applik8s_runtime_bridge::canonical_host_imports(),
                Duration::from_secs(30),
                KubernetesHttpTransport {
                    guest_endpoint: "http://different.invalid".to_string(),
                    endpoint: format!("https://{tls_addr}"),
                    bearer_token: Some(secret.to_string()),
                    bearer_token_file: None,
                    ca_certificates: Vec::new(),
                    tls_server_name: None,
                },
            ),
        )
        .expect_err("undeclared Kubernetes guest authority is denied");
    assert!(!denied.to_string().contains(secret));
    fs::remove_dir_all(&temp_dir).expect("test temp directory removes");
}

#[test]
fn validates_payloads_before_wasm_invocation() {
    let payload = valid_handler_input_payload();

    validate_handler_input(&payload).expect("valid handler input");
    let decoded = decode_handler_input_payload(payload).expect("valid handler input decodes");

    assert_eq!(decoded.handler_id, "ImageJob.reconcile.0");
    assert_eq!(decoded.object.kind, "ImageJob");
    assert!(validate_handler_input(&serde_json::json!({ "handlerId": "missing" })).is_err());
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("runtime bridge crate lives under workspace crates directory")
        .to_path_buf()
}

fn test_temp_dir(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("applik8s-{name}-{unique}"))
}

#[test]
fn delegates_requeue_semantics_to_kube_runtime_action() {
    let action = retry_after(Duration::from_secs(30));

    assert_eq!(action, Action::requeue(Duration::from_secs(30)));
}

#[test]
fn validates_operation_plan_semantics_before_apply() {
    let owner = owner_ref();
    let invalid = applik8s_runtime_contract::NormalizedOperationPlan {
        operations: vec![applik8s_runtime_contract::Operation::Status {
            status: serde_json::json!("Processing"),
            ref_: None,
        }],
        diagnostics: None,
    };

    let error = validate_operation_plan(&owner, &invalid).expect_err("invalid plan fails");

    assert!(
        error
            .to_string()
            .contains("status.status must be a JSON object")
    );
}

#[test]
fn validates_every_operation_kind_in_normalized_plan() {
    let owner = owner_ref();
    let payload = serde_json::json!({
        "operations": [
            { "kind": "finalizer", "operation": "add", "finalizer": "media.applik8s.dev/imagejob" },
            {
                "kind": "apply",
                "resource": {
                    "apiVersion": "v1",
                    "kind": "ConfigMap",
                    "metadata": { "name": "hero-config", "namespace": "media" },
                    "spec": {}
                },
                "fieldManager": "applik8s-test",
                "force": true
            },
            {
                "kind": "patch",
                "ref": { "apiVersion": "batch/v1", "kind": "Job", "name": "hero-webp", "namespace": "media" },
                "patch": [{ "op": "replace", "path": "/spec/suspend", "value": true }]
            },
            {
                "kind": "delete",
                "ref": { "apiVersion": "batch/v1", "kind": "Job", "name": "hero-old", "namespace": "media" },
                "options": { "propagationPolicy": "Foreground", "gracePeriodSeconds": 5 }
            },
            { "kind": "status", "status": { "phase": "Processing" } },
            {
                "kind": "event",
                "type": "Normal",
                "reason": "Accepted",
                "message": "Image job accepted",
                "regarding": { "apiVersion": "media.applik8s.dev/v1alpha1", "kind": "ImageJob", "name": "hero-image", "namespace": "media" }
            },
            { "kind": "finalizer", "operation": "remove", "finalizer": "media.applik8s.dev/imagejob" },
            { "kind": "requeue", "policy": { "afterSeconds": 30, "reason": "WaitingForResize" } }
        ]
    });

    let plan = decode_handler_output_plan_payload(payload)
        .expect("all operation kinds decode through runtime contract");

    validate_operation_plan(&owner, &plan).expect("all operation kinds validate");
    let kinds = plan
        .operations
        .iter()
        .map(|operation| match operation {
            applik8s_runtime_contract::Operation::Apply { .. } => "apply",
            applik8s_runtime_contract::Operation::Patch { .. } => "patch",
            applik8s_runtime_contract::Operation::Delete { .. } => "delete",
            applik8s_runtime_contract::Operation::Status { .. } => "status",
            applik8s_runtime_contract::Operation::Event { .. } => "event",
            applik8s_runtime_contract::Operation::Finalizer { .. } => "finalizer",
            applik8s_runtime_contract::Operation::Requeue { .. } => "requeue",
        })
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec![
            "finalizer",
            "apply",
            "patch",
            "delete",
            "status",
            "event",
            "finalizer",
            "requeue"
        ]
    );
}

#[test]
fn rejects_invalid_apply_field_managers_before_apply() {
    let owner = owner_ref();
    let cases = [
        ("   ".to_string(), "fieldManager must not be empty"),
        (
            "a".repeat(129),
            "fieldManager must be at most 128 characters",
        ),
        (
            "applik8s\nmanager".to_string(),
            "fieldManager must not contain control characters",
        ),
    ];

    for (field_manager, expected) in cases {
        let plan = decode_handler_output_plan_payload(serde_json::json!({
            "operations": [{
                "kind": "apply",
                "fieldManager": field_manager,
                "resource": {
                    "apiVersion": "v1",
                    "kind": "ConfigMap",
                    "metadata": { "name": "hero-config", "namespace": "media" },
                    "spec": {}
                }
            }]
        }))
        .expect("apply plan decodes");

        let error = validate_operation_plan(&owner, &plan).expect_err("field manager is rejected");

        assert!(
            error.to_string().contains(expected),
            "expected {expected:?}, got {error}"
        );
    }
}

#[test]
fn rejects_known_resource_scope_mismatches_before_apply() {
    let owner = owner_ref();
    let missing_namespace = decode_handler_output_plan_payload(serde_json::json!({
        "operations": [{
            "kind": "apply",
            "resource": {
                "apiVersion": "v1",
                "kind": "ConfigMap",
                "metadata": { "name": "hero-config" },
                "spec": {}
            }
        }]
    }))
    .expect("apply plan decodes");
    let cluster_with_namespace = decode_handler_output_plan_payload(serde_json::json!({
        "operations": [{
            "kind": "delete",
            "ref": { "apiVersion": "v1", "kind": "Namespace", "name": "media", "namespace": "media" }
        }]
    }))
    .expect("delete plan decodes");

    let missing_namespace_error = validate_operation_plan(&owner, &missing_namespace)
        .expect_err("namespaced resource without namespace is rejected");
    let cluster_with_namespace_error = validate_operation_plan(&owner, &cluster_with_namespace)
        .expect_err("cluster-scoped ref with namespace is rejected");

    assert!(
        missing_namespace_error
            .to_string()
            .contains("v1/ConfigMap is namespaced and must include metadata.namespace"),
        "expected namespaced scope error, got {missing_namespace_error}"
    );
    assert!(
        cluster_with_namespace_error
            .to_string()
            .contains("v1/Namespace is cluster-scoped and must not include metadata.namespace"),
        "expected cluster scope error, got {cluster_with_namespace_error}"
    );
}

#[test]
fn rejects_server_populated_apply_metadata_before_apply() {
    let owner = owner_ref();
    let cases = [
        (serde_json::json!({ "uid": "uid-1" }), "metadata.uid"),
        (
            serde_json::json!({ "resourceVersion": "123" }),
            "metadata.resourceVersion",
        ),
        (
            serde_json::json!({ "generation": 2 }),
            "metadata.generation",
        ),
        (
            serde_json::json!({ "deletionTimestamp": "2026-06-22T00:00:00Z" }),
            "metadata.deletionTimestamp",
        ),
        (
            serde_json::json!({ "creationTimestamp": "2026-06-22T00:00:00Z" }),
            "metadata.creationTimestamp",
        ),
        (
            serde_json::json!({ "managedFields": [] }),
            "metadata.managedFields",
        ),
    ];

    for (metadata, expected) in cases {
        let mut metadata = metadata;
        metadata["name"] = serde_json::json!("hero-config");
        metadata["namespace"] = serde_json::json!("media");
        let plan = decode_handler_output_plan_payload(serde_json::json!({
            "operations": [{
                "kind": "apply",
                "resource": {
                    "apiVersion": "v1",
                    "kind": "ConfigMap",
                    "metadata": metadata,
                    "spec": {}
                }
            }]
        }))
        .expect("apply plan decodes");

        let error = validate_operation_plan(&owner, &plan)
            .expect_err("server-populated metadata is rejected");

        assert!(
            error.to_string().contains(expected),
            "expected {expected:?}, got {error}"
        );
    }
}

#[test]
fn rejects_non_canonical_operation_order_before_apply() {
    let owner = owner_ref();
    let payload = serde_json::json!({
        "operations": [
            { "kind": "status", "status": { "phase": "Processing" } },
            {
                "kind": "apply",
                "resource": {
                    "apiVersion": "v1",
                    "kind": "ConfigMap",
                    "metadata": { "name": "hero-config", "namespace": "media" },
                    "spec": {}
                }
            }
        ]
    });
    let plan = decode_handler_output_plan_payload(payload).expect("plan decodes");

    let error = validate_operation_plan(&owner, &plan).expect_err("non-canonical order fails");

    assert!(
        error
            .to_string()
            .contains("operation order is not canonical"),
        "expected canonical order error, got {error}"
    );
}

#[test]
fn rejects_structurally_invalid_json_patch_operations_before_apply() {
    let owner = owner_ref();
    let cases = [
        (
            serde_json::json!([{ "op": "replace", "path": "spec/suspend", "value": true }]),
            "path must be a JSON Pointer",
        ),
        (
            serde_json::json!([{ "op": "replace", "path": "/spec/suspend" }]),
            "value is required",
        ),
        (
            serde_json::json!([{ "op": "remove", "path": "/spec/suspend", "value": true }]),
            "value is not valid for remove",
        ),
        (
            serde_json::json!([{ "op": "copy", "path": "/spec/new" }]),
            "from must be a JSON Pointer",
        ),
        (
            serde_json::json!([{ "op": "move", "path": "/spec/new", "from": "spec/old" }]),
            "from must be a JSON Pointer",
        ),
    ];

    for (patch, expected) in cases {
        let plan = decode_handler_output_plan_payload(serde_json::json!({
            "operations": [{
                "kind": "patch",
                "ref": { "apiVersion": "batch/v1", "kind": "Job", "name": "hero-webp", "namespace": "media" },
                "patch": patch
            }]
        }))
        .expect("patch plan decodes");

        let error = validate_operation_plan(&owner, &plan).expect_err("invalid patch fails");

        assert!(
            error.to_string().contains(expected),
            "expected {expected:?}, got {error}"
        );
    }
}

#[test]
fn rejects_invalid_delete_ref_before_apply() {
    let owner = owner_ref();
    let invalid = applik8s_runtime_contract::NormalizedOperationPlan {
        operations: vec![applik8s_runtime_contract::Operation::Delete {
            ref_: applik8s_runtime_contract::ObjectRef {
                api_version: "batch/v1".to_string(),
                kind: "Job".to_string(),
                name: "".to_string(),
                namespace: Some("media".to_string()),
                uid: None,
                resource_version: None,
            },
            options: None,
            connection: None,
            authority: None,
        }],
        diagnostics: None,
    };

    let error = validate_operation_plan(&owner, &invalid).expect_err("invalid delete ref fails");

    assert!(
        error
            .to_string()
            .contains("delete.ref must include non-empty apiVersion, kind, and name")
    );
}

#[test]
fn rejects_invalid_delete_options_before_apply() {
    let owner = owner_ref();
    let cases = [
        (-1.0, "gracePeriodSeconds must not be negative"),
        (
            1.5,
            "gracePeriodSeconds must be an integer number of seconds",
        ),
    ];

    for (grace_period_seconds, expected) in cases {
        let plan = decode_handler_output_plan_payload(serde_json::json!({
            "operations": [{
                "kind": "delete",
                "ref": { "apiVersion": "batch/v1", "kind": "Job", "name": "hero-webp", "namespace": "media" },
                "options": { "gracePeriodSeconds": grace_period_seconds }
            }]
        }))
        .expect("delete plan decodes");

        let error =
            validate_operation_plan(&owner, &plan).expect_err("invalid delete options fail");

        assert!(
            error.to_string().contains(expected),
            "expected {expected:?}, got {error}"
        );
    }

    for (preconditions, expected) in [
        (
            serde_json::json!({ "uid": "" }),
            "preconditions.uid must not be empty",
        ),
        (
            serde_json::json!({ "uid": "endpoint-uid", "resourceVersion": "" }),
            "preconditions.resourceVersion must not be empty",
        ),
    ] {
        let plan = decode_handler_output_plan_payload(serde_json::json!({
            "operations": [{
                "kind": "delete",
                "ref": { "apiVersion": "externaldns.k8s.io/v1alpha1", "kind": "DNSEndpoint", "name": "publication", "namespace": "dns-system" },
                "options": { "preconditions": preconditions }
            }]
        }))
        .expect("guarded delete plan decodes");

        let error =
            validate_operation_plan(&owner, &plan).expect_err("invalid delete preconditions fail");
        assert!(
            error.to_string().contains(expected),
            "expected {expected:?}, got {error}"
        );
    }
}

#[test]
fn accepts_uid_and_resource_version_delete_preconditions() {
    let owner = owner_ref();
    let plan = decode_handler_output_plan_payload(serde_json::json!({
        "operations": [{
            "kind": "delete",
            "ref": { "apiVersion": "externaldns.k8s.io/v1alpha1", "kind": "DNSEndpoint", "name": "publication", "namespace": "dns-system" },
            "options": { "preconditions": { "uid": "endpoint-uid", "resourceVersion": "42" } }
        }]
    }))
    .expect("guarded delete plan decodes");

    validate_operation_plan(&owner, &plan).expect("guarded delete plan validates");
    let serialized = serde_json::to_value(&plan).expect("guarded delete plan serializes");
    assert_eq!(
        serialized.pointer("/operations/0/options/preconditions"),
        Some(&serde_json::json!({ "uid": "endpoint-uid", "resourceVersion": "42" }))
    );
}

#[test]
fn rejects_invalid_finalizer_and_requeue_before_apply() {
    let owner = owner_ref();
    let invalid_finalizer = applik8s_runtime_contract::NormalizedOperationPlan {
        operations: vec![applik8s_runtime_contract::Operation::Finalizer {
            operation: applik8s_runtime_contract::FinalizerOperation::Add,
            finalizer: "imagejob".to_string(),
        }],
        diagnostics: None,
    };
    let invalid_requeue = applik8s_runtime_contract::NormalizedOperationPlan {
        operations: vec![applik8s_runtime_contract::Operation::Requeue {
            policy: applik8s_runtime_contract::RequeuePolicy {
                after_seconds: Some(-1.0),
                reason: Some("invalid".to_string()),
            },
        }],
        diagnostics: None,
    };

    let finalizer_error = validate_operation_plan(&owner, &invalid_finalizer)
        .expect_err("unqualified finalizer fails");
    let requeue_error =
        validate_operation_plan(&owner, &invalid_requeue).expect_err("negative requeue fails");

    assert!(
        finalizer_error
            .to_string()
            .contains("qualified Kubernetes finalizer")
    );
    assert!(
        requeue_error
            .to_string()
            .contains("afterSeconds must not be negative")
    );
}

#[test]
fn rejects_non_namespaced_event_regarding_before_apply() {
    let owner = owner_ref();
    let explicit_cluster_regarding = decode_handler_output_plan_payload(serde_json::json!({
        "operations": [{
            "kind": "event",
            "type": "Normal",
            "reason": "Accepted",
            "message": "Image job accepted",
            "regarding": { "apiVersion": "v1", "kind": "Namespace", "name": "media" }
        }]
    }))
    .expect("event plan decodes");

    let explicit_error = validate_operation_plan(&owner, &explicit_cluster_regarding)
        .expect_err("explicit non-namespaced regarding fails");

    assert!(
        explicit_error
            .to_string()
            .contains("event.regarding must be namespaced"),
        "expected event regarding namespace error, got {explicit_error}"
    );

    let cluster_owner = applik8s_runtime_contract::ObjectRef {
        api_version: "platform.applik8s.dev/v1alpha1".to_string(),
        kind: "ClusterThing".to_string(),
        name: "cluster-thing".to_string(),
        namespace: None,
        uid: None,
        resource_version: None,
    };
    let implicit_owner_regarding = decode_handler_output_plan_payload(serde_json::json!({
        "operations": [{
            "kind": "event",
            "type": "Warning",
            "reason": "Blocked",
            "message": "Cluster-scoped owner has no event namespace"
        }]
    }))
    .expect("event plan decodes");

    let implicit_error = validate_operation_plan(&cluster_owner, &implicit_owner_regarding)
        .expect_err("implicit non-namespaced owner regarding fails");

    assert!(
        implicit_error
            .to_string()
            .contains("event.regarding must be namespaced"),
        "expected implicit owner event namespace error, got {implicit_error}"
    );
}

fn owner_ref() -> applik8s_runtime_contract::ObjectRef {
    applik8s_runtime_contract::ObjectRef {
        api_version: "media.applik8s.dev/v1alpha1".to_string(),
        kind: "ImageJob".to_string(),
        name: "hero-image".to_string(),
        namespace: Some("media".to_string()),
        uid: None,
        resource_version: None,
    }
}
