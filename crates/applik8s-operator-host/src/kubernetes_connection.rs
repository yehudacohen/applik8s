use std::collections::BTreeMap;
use std::sync::Arc;

use applik8s_runtime_contract::{KubernetesConnectionName, KubernetesSecretRef};
use kube::{Client, Config};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;

use crate::OperatorHostError;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct KubernetesConnectionBinding {
    pub(super) kubeconfig_secret_ref: KubernetesSecretRef,
    pub(super) context: String,
    pub(super) endpoint_policy: KubernetesEndpointPolicy,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct KubernetesEndpointPolicy {
    pub(super) name: String,
    pub(super) version: String,
    pub(super) scheme: String,
    pub(super) hosts: Vec<String>,
    pub(super) ports: Vec<u16>,
    #[serde(default)]
    pub(super) allowed_cidrs: Vec<String>,
    #[serde(default)]
    pub(super) tls_server_names: Vec<String>,
    pub(super) redirects: String,
}

#[derive(Clone)]
pub(super) struct ResolvedConnectionLease {
    pub(super) alias: KubernetesConnectionName,
    pub(super) client: Client,
    pub(super) secret_uid: String,
    pub(super) secret_resource_version: String,
    pub(super) context: String,
    pub(super) endpoint_policy_version: String,
    pub(super) connection_identity: String,
    pub(super) binding_revision: String,
}

pub(super) type ConnectionLeaseStore =
    Arc<AsyncMutex<BTreeMap<KubernetesConnectionName, ResolvedConnectionLease>>>;

pub(super) fn valid_connection_alias(alias: &str) -> bool {
    !alias.is_empty()
        && alias.len() <= 63
        && alias
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && alias.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

pub(super) fn validate_endpoint_policy(
    config: &Config,
    policy: &KubernetesEndpointPolicy,
) -> Result<(), OperatorHostError> {
    if policy.name.trim().is_empty()
        || policy.version.trim().is_empty()
        || policy.scheme != "https"
        || policy.redirects != "deny"
        || policy.hosts.is_empty()
        || policy.ports.is_empty()
    {
        return Err(OperatorHostError::KubernetesConfiguration(
            "connection endpoint policy is incomplete or does not fail closed".to_string(),
        ));
    }
    if !policy.allowed_cidrs.is_empty() {
        return Err(OperatorHostError::KubernetesConfiguration(
            "connection endpoint policy allowedCidrs is not supported until DNS resolution pinning is implemented".to_string(),
        ));
    }
    let authority = config.cluster_url.authority().ok_or_else(|| {
        OperatorHostError::KubernetesConfiguration(
            "connection Kubernetes API endpoint has no authority".to_string(),
        )
    })?;
    let host = authority.host();
    let port = authority.port_u16().unwrap_or(443);
    if !policy.hosts.iter().any(|allowed| allowed == host) || !policy.ports.contains(&port) {
        return Err(OperatorHostError::KubernetesConfiguration(
            "connection Kubernetes API endpoint is rejected by endpoint policy".to_string(),
        ));
    }
    if !policy.tls_server_names.is_empty()
        && !policy
            .tls_server_names
            .iter()
            .any(|allowed| allowed == host)
    {
        return Err(OperatorHostError::KubernetesConfiguration(
            "connection Kubernetes API TLS identity is rejected by endpoint policy".to_string(),
        ));
    }
    if config.proxy_url.is_some() || config.accept_invalid_certs || config.tls_server_name.is_some()
    {
        return Err(OperatorHostError::KubernetesConfiguration(
            "connection Kubernetes client contains a forbidden proxy or TLS override".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn same_connection_revision(
    left: &ResolvedConnectionLease,
    right: &ResolvedConnectionLease,
) -> bool {
    left.alias == right.alias
        && left.secret_uid == right.secret_uid
        && left.secret_resource_version == right.secret_resource_version
        && left.context == right.context
        && left.endpoint_policy_version == right.endpoint_policy_version
        && left.connection_identity == right.connection_identity
        && left.binding_revision == right.binding_revision
}
