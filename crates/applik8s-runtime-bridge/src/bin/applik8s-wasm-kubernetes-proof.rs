use std::env;
use std::fs;
use std::time::Duration;

use applik8s_runtime_bridge::{
    KubernetesHttpTransport, canonical_host_imports, component_model_engine,
    invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async, runtime_abi_version,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let component_path = args
        .next()
        .ok_or("usage: applik8s-wasm-kubernetes-proof <component.wasm> <host-endpoint>")?;
    let endpoint = args
        .next()
        .ok_or("usage: applik8s-wasm-kubernetes-proof <component.wasm> <host-endpoint>")?;
    if args.next().is_some() {
        return Err(
            "usage: applik8s-wasm-kubernetes-proof <component.wasm> <host-endpoint>".into(),
        );
    }
    let component = fs::read(component_path)?;
    let engine = component_model_engine()?;
    let default_input = serde_json::json!({
        "abiVersion": runtime_abi_version(),
        "handlerId": "KubernetesSdk.proof.0",
        "event": "reconcile",
        "object": {
            "apiVersion": "applik8s.dev/v1alpha1",
            "kind": "KubernetesSdkProof",
            "metadata": { "name": "live-proof" },
            "spec": {}
        },
        "runtime": {
            "operatorName": "applik8s-wasm-kubernetes-proof",
            "reconcileId": "live-proof-1",
            "bundleDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "runtimeVersion": env!("CARGO_PKG_VERSION"),
            "startedAt": "2026-07-10T00:00:00Z"
        }
    });
    let input = match env::var("APPLIK8S_PROOF_INPUT_JSON") {
        Ok(value) => serde_json::from_str(&value)?,
        Err(_) => default_input,
    };
    let transport = KubernetesHttpTransport {
        guest_endpoint: env::var("APPLIK8S_KUBERNETES_GUEST_ENDPOINT")
            .unwrap_or_else(|_| "http://kubernetes.default.svc".to_string()),
        endpoint,
        bearer_token: env::var("APPLIK8S_KUBERNETES_TOKEN").ok(),
        bearer_token_file: None,
        ca_certificates: Vec::new(),
        tls_server_name: None,
    };
    let plan = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .enable_io()
        .build()?
        .block_on(
            invoke_handler_component_bytes_with_timeout_and_kubernetes_http_async(
                &engine,
                &component,
                input,
                &canonical_host_imports(),
                Duration::from_secs(120),
                transport,
            ),
        )?;
    println!("{}", serde_json::to_string(&plan)?);
    Ok(())
}
