use applik8s_runtime_contract::{
    KubernetesConnectionName, ObjectRef, RemoteMutationAuthority, RemoteMutationPrecondition,
};
use kube::api::DynamicObject;
use serde_json::{Value, json};

use crate::error::RuntimeBridgeError;

const REMOTE_IDENTITY_ANNOTATION: &str = "applik8s.dev/remote-management-identity";
const REMOTE_SOURCE_UID_ANNOTATION: &str = "applik8s.dev/remote-source-uid";

pub(crate) fn validate_remote_authority(
    owner: &ObjectRef,
    connection: Option<&KubernetesConnectionName>,
    authority: Option<&RemoteMutationAuthority>,
    index: usize,
    apply: bool,
) -> Result<(), RuntimeBridgeError> {
    let invalid = |message: &str| {
        Err(RuntimeBridgeError::InvalidPayload(format!(
            "operation plan operation {index} is invalid: {message}"
        )))
    };
    match (connection, authority) {
        (None, None) => Ok(()),
        (None, Some(_)) => {
            invalid("remote mutation authority requires a connection-scoped operation")
        }
        (Some(_), None) => {
            invalid("connection-scoped mutation requires explicit remote mutation authority")
        }
        (Some(_), Some(RemoteMutationAuthority::Existing { .. })) if apply => {
            invalid("connection-scoped apply requires managed remote mutation authority")
        }
        (
            Some(_),
            Some(RemoteMutationAuthority::Managed {
                identity,
                source_uid,
            }),
        ) => {
            if identity.trim().is_empty() || source_uid.trim().is_empty() {
                return invalid(
                    "managed remote mutation authority identity and sourceUid must be non-empty",
                );
            }
            let owner_uid = owner
                .uid
                .as_deref()
                .filter(|uid| !uid.trim().is_empty())
                .ok_or_else(|| {
                    RuntimeBridgeError::InvalidPayload(
                        "connection-scoped managed mutation requires the reconciled owner metadata.uid"
                            .to_string(),
                    )
                })?;
            if source_uid != owner_uid {
                return invalid(
                    "managed remote mutation sourceUid must equal the reconciled owner metadata.uid",
                );
            }
            Ok(())
        }
        (Some(_), Some(RemoteMutationAuthority::Existing { precondition })) => {
            if precondition.uid.trim().is_empty() || precondition.resource_version.trim().is_empty()
            {
                invalid(
                    "existing remote mutation authority uid and resourceVersion must be non-empty",
                )
            } else {
                Ok(())
            }
        }
    }
}

pub(crate) fn inject_remote_management_metadata(
    mut value: Value,
    identity: &str,
    source_uid: &str,
) -> Result<Value, RuntimeBridgeError> {
    let metadata = value
        .get_mut("metadata")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            RuntimeBridgeError::InvalidPayload(
                "remote managed resource is missing metadata".to_string(),
            )
        })?;
    let annotations = metadata
        .entry("annotations")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            RuntimeBridgeError::InvalidPayload(
                "remote managed resource metadata.annotations must be an object".to_string(),
            )
        })?;
    annotations.insert(REMOTE_IDENTITY_ANNOTATION.to_string(), json!(identity));
    annotations.insert(REMOTE_SOURCE_UID_ANNOTATION.to_string(), json!(source_uid));
    let labels = metadata
        .entry("labels")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            RuntimeBridgeError::InvalidPayload(
                "remote managed resource metadata.labels must be an object".to_string(),
            )
        })?;
    labels.insert(
        "app.kubernetes.io/managed-by".to_string(),
        json!("applik8s"),
    );
    Ok(value)
}

pub(crate) fn inject_remote_apply_precondition(
    mut value: Value,
    resource_version: &str,
) -> Result<Value, RuntimeBridgeError> {
    let metadata = value
        .get_mut("metadata")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            RuntimeBridgeError::InvalidPayload(
                "remote managed resource is missing metadata".to_string(),
            )
        })?;
    metadata.insert(
        "resourceVersion".to_string(),
        Value::String(resource_version.to_string()),
    );
    Ok(value)
}

pub(crate) fn verify_remote_object_authority(
    object: &DynamicObject,
    authority: &RemoteMutationAuthority,
) -> Result<RemoteMutationPrecondition, RuntimeBridgeError> {
    let uid = object
        .metadata
        .uid
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RuntimeBridgeError::InvalidPayload(
                "remote mutation target is missing metadata.uid".to_string(),
            )
        })?;
    let resource_version = object
        .metadata
        .resource_version
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RuntimeBridgeError::InvalidPayload(
                "remote mutation target is missing metadata.resourceVersion".to_string(),
            )
        })?;
    match authority {
        RemoteMutationAuthority::Existing { precondition }
            if precondition.uid != uid || precondition.resource_version != resource_version =>
        {
            return Err(RuntimeBridgeError::InvalidPayload(
                "remote existing-resource mutation precondition is stale".to_string(),
            ));
        }
        RemoteMutationAuthority::Managed {
            identity,
            source_uid,
        } => {
            let annotations = object.metadata.annotations.as_ref();
            if annotations.and_then(|values| values.get(REMOTE_IDENTITY_ANNOTATION))
                != Some(identity)
                || annotations.and_then(|values| values.get(REMOTE_SOURCE_UID_ANNOTATION))
                    != Some(source_uid)
            {
                return Err(RuntimeBridgeError::InvalidPayload(
                    "remote managed-resource mutation could not prove management identity"
                        .to_string(),
                ));
            }
        }
        _ => {}
    }
    Ok(RemoteMutationPrecondition {
        uid,
        resource_version,
    })
}
