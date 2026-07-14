use applik8s_runtime_contract::{
    ApplyOwnership, FinalizerOperation, JsonPatchEntry, JsonPatchOperation,
    KubernetesConnectionName, KubernetesEventType, KubernetesObject, NormalizedOperationPlan,
    ObjectRef, Operation, PropagationPolicy, RemoteMutationAuthority, RemoteMutationPrecondition,
};
use kube::Client;
use kube::api::{Api, DeleteParams, DynamicObject, Patch, PatchParams, PostParams, Preconditions};
use kube::core::dynamic::ApiResource;
use kube::core::gvk::GroupVersionKind;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

use crate::error::{OperationProgress, RuntimeBridgeError};
use crate::remote_authority::{
    inject_remote_apply_precondition, inject_remote_management_metadata, validate_remote_authority,
    verify_remote_object_authority,
};

const REMOTE_CREATE_FIELD_MANAGER: &str = "applik8s-remote-create";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct AppliedOperationSummary {
    pub applied: usize,
    pub patched: usize,
    pub deleted: usize,
    pub status_patched: usize,
    pub events_recorded: usize,
    pub finalizers_mutated: usize,
    pub requeued: usize,
}

impl AppliedOperationSummary {
    fn completed_operations(&self) -> usize {
        self.applied
            + self.patched
            + self.deleted
            + self.status_patched
            + self.events_recorded
            + self.finalizers_mutated
            + self.requeued
    }

    fn progress(&self) -> OperationProgress {
        OperationProgress {
            completed_operations: self.completed_operations(),
            applied: self.applied,
            patched: self.patched,
            deleted: self.deleted,
            status_patched: self.status_patched,
            events_recorded: self.events_recorded,
            finalizers_mutated: self.finalizers_mutated,
            requeued: self.requeued,
        }
    }
}

pub struct KubeOperationPlanApplier {
    client: Client,
    connection_clients: BTreeMap<KubernetesConnectionName, Client>,
    field_manager: String,
    plural_overrides: BTreeMap<(String, String), String>,
    force_status: bool,
}

impl KubeOperationPlanApplier {
    pub fn new(client: Client, field_manager: impl Into<String>) -> Self {
        Self {
            client,
            connection_clients: BTreeMap::new(),
            field_manager: field_manager.into(),
            plural_overrides: default_plural_overrides(),
            force_status: false,
        }
    }

    pub fn with_resource_plural(
        mut self,
        api_version: impl Into<String>,
        kind: impl Into<String>,
        plural: impl Into<String>,
    ) -> Self {
        self.plural_overrides
            .insert((api_version.into(), kind.into()), plural.into());
        self
    }

    pub fn with_field_manager(&self, field_manager: impl Into<String>) -> Self {
        Self {
            client: self.client.clone(),
            connection_clients: self.connection_clients.clone(),
            field_manager: field_manager.into(),
            plural_overrides: self.plural_overrides.clone(),
            force_status: self.force_status,
        }
    }

    pub fn with_force_status(mut self, force_status: bool) -> Self {
        self.force_status = force_status;
        self
    }

    pub fn with_connection_client(
        mut self,
        connection: KubernetesConnectionName,
        client: Client,
    ) -> Self {
        self.connection_clients.insert(connection, client);
        self
    }

    pub async fn apply_plan(
        &self,
        owner: &ObjectRef,
        plan: &NormalizedOperationPlan,
    ) -> Result<AppliedOperationSummary, RuntimeBridgeError> {
        validate_operation_plan(owner, plan)?;
        let mut summary = AppliedOperationSummary::default();

        for (index, operation) in plan.operations.iter().enumerate() {
            match operation {
                Operation::Apply {
                    resource,
                    field_manager,
                    force,
                    ownership,
                    connection,
                    authority,
                } => {
                    self.apply_resource(
                        owner,
                        resource,
                        field_manager.as_deref(),
                        *force,
                        ownership.as_ref(),
                        connection.as_ref(),
                        authority.as_ref(),
                    )
                    .await
                    .map_err(|error| {
                        operation_failed(
                            index,
                            operation,
                            owner,
                            &self.field_manager,
                            &summary,
                            error,
                        )
                    })?;
                    summary.applied += 1;
                }
                Operation::Patch {
                    ref_,
                    patch,
                    connection,
                    authority,
                } => {
                    let api = self
                        .api_for_ref(ref_, connection.as_ref())
                        .map_err(|error| {
                            operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                error,
                            )
                        })?;
                    let patch_params = PatchParams::default();
                    let mut guarded_patch = patch.clone();
                    if let Some(authority) = authority.as_ref() {
                        let precondition = self
                            .verify_remote_mutation_authority(&api, &ref_.name, authority)
                            .await
                            .map_err(|error| {
                                operation_failed(
                                    index,
                                    operation,
                                    owner,
                                    &self.field_manager,
                                    &summary,
                                    error,
                                )
                            })?;
                        guarded_patch.insert(
                            0,
                            json_patch_test(
                                "/metadata/resourceVersion",
                                &precondition.resource_version,
                            ),
                        );
                        guarded_patch
                            .insert(0, json_patch_test("/metadata/uid", &precondition.uid));
                    }
                    let patch_value = serde_json::to_value(&guarded_patch)
                        .map_err(RuntimeBridgeError::from)
                        .map_err(|error| {
                            operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                error,
                            )
                        })?;
                    let patch = json_patch::Patch(
                        serde_json::from_value(patch_value)
                            .map_err(RuntimeBridgeError::from)
                            .map_err(|error| {
                                operation_failed(
                                    index,
                                    operation,
                                    owner,
                                    &self.field_manager,
                                    &summary,
                                    error,
                                )
                            })?,
                    );
                    api.patch(&ref_.name, &patch_params, &Patch::<Value>::Json(patch))
                        .await
                        .map_err(RuntimeBridgeError::from)
                        .map_err(|error| {
                            operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                error,
                            )
                        })?;
                    summary.patched += 1;
                }
                Operation::Delete {
                    ref_,
                    options,
                    connection,
                    authority,
                } => {
                    let api = self
                        .api_for_ref(ref_, connection.as_ref())
                        .map_err(|error| {
                            operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                error,
                            )
                        })?;
                    let mut params = DeleteParams::default();
                    if let Some(options) = options {
                        if let Some(grace_period_seconds) = options.grace_period_seconds {
                            params.grace_period_seconds = Some(grace_period_seconds as u32);
                        }
                        if let Some(policy) = &options.propagation_policy {
                            params.propagation_policy = Some(match policy {
                                PropagationPolicy::Foreground => {
                                    kube::api::PropagationPolicy::Foreground
                                }
                                PropagationPolicy::Background => {
                                    kube::api::PropagationPolicy::Background
                                }
                                PropagationPolicy::Orphan => kube::api::PropagationPolicy::Orphan,
                            });
                        }
                    }
                    if let Some(authority) = authority.as_ref() {
                        let precondition = self
                            .verify_remote_mutation_authority(&api, &ref_.name, authority)
                            .await
                            .map_err(|error| {
                                operation_failed(
                                    index,
                                    operation,
                                    owner,
                                    &self.field_manager,
                                    &summary,
                                    error,
                                )
                            })?;
                        params.preconditions = Some(Preconditions {
                            uid: Some(precondition.uid),
                            resource_version: Some(precondition.resource_version),
                        });
                    }
                    match api.delete(&ref_.name, &params).await {
                        Ok(_) => {}
                        Err(kube::Error::Api(api_error)) if api_error.code == 404 => {}
                        Err(error) => {
                            return Err(operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                RuntimeBridgeError::from(error),
                            ));
                        }
                    }
                    summary.deleted += 1;
                }
                Operation::Status { status, ref_ } => {
                    let target = ref_.as_ref().unwrap_or(owner);
                    self.patch_status(target, status).await.map_err(|error| {
                        operation_failed(
                            index,
                            operation,
                            owner,
                            &self.field_manager,
                            &summary,
                            error,
                        )
                    })?;
                    summary.status_patched += 1;
                }
                Operation::Event {
                    event_type,
                    reason,
                    message,
                    regarding,
                } => {
                    self.record_event(owner, event_type, reason, message, regarding.as_ref())
                        .await
                        .map_err(|error| {
                            operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                error,
                            )
                        })?;
                    summary.events_recorded += 1;
                }
                Operation::Finalizer {
                    operation: finalizer_operation,
                    finalizer,
                } => {
                    self.mutate_finalizer(owner, finalizer_operation, finalizer)
                        .await
                        .map_err(|error| {
                            operation_failed(
                                index,
                                operation,
                                owner,
                                &self.field_manager,
                                &summary,
                                error,
                            )
                        })?;
                    summary.finalizers_mutated += 1;
                }
                Operation::Requeue { .. } => {
                    summary.requeued += 1;
                }
            }
        }

        Ok(summary)
    }

    #[allow(clippy::too_many_arguments)]
    async fn apply_resource(
        &self,
        owner: &ObjectRef,
        resource: &KubernetesObject,
        field_manager: Option<&str>,
        force: Option<bool>,
        ownership: Option<&ApplyOwnership>,
        connection: Option<&KubernetesConnectionName>,
        authority: Option<&RemoteMutationAuthority>,
    ) -> Result<(), RuntimeBridgeError> {
        let api = self.api_for_object(resource, connection)?;
        let patch_value = apply_resource_patch(owner, resource, ownership)?;
        let mut patch_value = match authority {
            Some(RemoteMutationAuthority::Managed {
                identity,
                source_uid,
            }) => inject_remote_management_metadata(patch_value, identity, source_uid)?,
            _ => patch_value,
        };
        let default_field_manager = if connection.is_some() {
            "applik8s-remote"
        } else {
            &self.field_manager
        };
        let effective_field_manager = field_manager.unwrap_or(default_field_manager);
        let mut cleanup_create_ownership = false;
        if let Some(authority @ RemoteMutationAuthority::Managed { .. }) = authority {
            match api.get(&resource.metadata.name).await {
                Ok(object) => {
                    let precondition = verify_remote_object_authority(&object, authority)?;
                    cleanup_create_ownership = has_remote_create_ownership(&object);
                    patch_value = inject_remote_apply_precondition(
                        patch_value,
                        &precondition.resource_version,
                    )?;
                }
                Err(kube::Error::Api(error)) if error.code == 404 => {
                    let object: DynamicObject = serde_json::from_value(patch_value)?;
                    let params = PostParams {
                        field_manager: Some(REMOTE_CREATE_FIELD_MANAGER.to_string()),
                        ..PostParams::default()
                    };
                    // POST provides the create-only race boundary. Its temporary Update
                    // ownership is removed only after an optimistic, same-value SSA has
                    // established the durable manager. Both transitions carry exact
                    // resourceVersion tests, so an interposed writer makes the operation
                    // fail closed instead of being overwritten by force-conflicts.
                    let created = api.create(&params, &object).await?;
                    let precondition = verify_remote_object_authority(&created, authority)?;
                    patch_value = inject_remote_apply_precondition(
                        serde_json::to_value(object)?,
                        &precondition.resource_version,
                    )?;
                    cleanup_create_ownership = true;
                }
                Err(error) => return Err(error.into()),
            }
        }
        let mut params = PatchParams::apply(effective_field_manager);
        params.force = force.unwrap_or(false);
        let patch = Patch::Apply(patch_value);
        let applied = api.patch(&resource.metadata.name, &params, &patch).await?;
        if cleanup_create_ownership {
            remove_remote_create_ownership(&api, &resource.metadata.name, &applied).await?;
        }
        Ok(())
    }

    async fn verify_remote_mutation_authority(
        &self,
        api: &Api<DynamicObject>,
        name: &str,
        authority: &RemoteMutationAuthority,
    ) -> Result<RemoteMutationPrecondition, RuntimeBridgeError> {
        let object = api.get(name).await?;
        verify_remote_object_authority(&object, authority)
    }

    async fn patch_status(
        &self,
        target: &ObjectRef,
        status: &Value,
    ) -> Result<(), RuntimeBridgeError> {
        let api = self.api_for_ref(target, None)?;
        let mut params = PatchParams::apply(&self.field_manager);
        params.force = self.force_status;
        let patch = Patch::Apply(prune_nulls(json!({
            "apiVersion": target.api_version,
            "kind": target.kind,
            "metadata": { "name": target.name, "namespace": target.namespace },
            "status": status,
        })));
        api.patch_status(&target.name, &params, &patch).await?;
        Ok(())
    }

    async fn mutate_finalizer(
        &self,
        target: &ObjectRef,
        operation: &FinalizerOperation,
        finalizer: &str,
    ) -> Result<(), RuntimeBridgeError> {
        let api = self.api_for_ref(target, None)?;
        let object = api.get(&target.name).await?;
        let mut finalizers = object.metadata.finalizers.unwrap_or_default();
        match operation {
            FinalizerOperation::Add => {
                if !finalizers.iter().any(|existing| existing == finalizer) {
                    finalizers.push(finalizer.to_string());
                }
            }
            FinalizerOperation::Remove => {
                finalizers.retain(|existing| existing != finalizer);
            }
        }
        let params = PatchParams::apply(&self.field_manager);
        api.patch(
            &target.name,
            &params,
            &Patch::Apply(prune_nulls(json!({
                "apiVersion": target.api_version,
                "kind": target.kind,
                "metadata": {
                    "name": target.name,
                    "namespace": target.namespace,
                    "finalizers": finalizers,
                }
            }))),
        )
        .await?;
        Ok(())
    }

    async fn record_event(
        &self,
        owner: &ObjectRef,
        event_type: &KubernetesEventType,
        reason: &str,
        message: &str,
        regarding: Option<&ObjectRef>,
    ) -> Result<(), RuntimeBridgeError> {
        let regarding = regarding.unwrap_or(owner);
        let namespace = regarding
            .namespace
            .as_deref()
            .or(owner.namespace.as_deref())
            .ok_or_else(|| {
                RuntimeBridgeError::InvalidPayload(
                    "event recording requires a namespaced regarding object".to_string(),
                )
            })?;
        let api_resource =
            ApiResource::from_gvk_with_plural(&GroupVersionKind::gvk("", "v1", "Event"), "events");
        let api =
            Api::<DynamicObject>::namespaced_with(self.client.clone(), namespace, &api_resource);
        let event_name = format!("{}.{}", dns_label(&regarding.name), dns_label(reason));
        let event = prune_nulls(json!({
            "apiVersion": "v1",
            "kind": "Event",
            "metadata": {
                "name": event_name,
                "namespace": namespace,
            },
            "involvedObject": {
                "apiVersion": regarding.api_version,
                "kind": regarding.kind,
                "name": regarding.name,
                "namespace": regarding.namespace,
                "uid": regarding.uid,
                "resourceVersion": regarding.resource_version,
            },
            "type": match event_type {
                KubernetesEventType::Normal => "Normal",
                KubernetesEventType::Warning => "Warning",
            },
            "reason": reason,
            "message": message,
            "source": { "component": "applik8s" },
        }));
        let event: DynamicObject = serde_json::from_value(event)?;
        api.create(&PostParams::default(), &event)
            .await
            .or_else(|error| {
                if matches!(&error, kube::Error::Api(api_error) if api_error.code == 409) {
                    Ok(event)
                } else {
                    Err(error)
                }
            })?;
        Ok(())
    }

    fn api_for_object(
        &self,
        object: &KubernetesObject,
        connection: Option<&KubernetesConnectionName>,
    ) -> Result<Api<DynamicObject>, RuntimeBridgeError> {
        let ref_ = ObjectRef {
            api_version: object.api_version.clone(),
            kind: object.kind.clone(),
            name: object.metadata.name.clone(),
            namespace: object.metadata.namespace.clone(),
            uid: object.metadata.uid.clone(),
            resource_version: object.metadata.resource_version.clone(),
        };
        self.api_for_ref(&ref_, connection)
    }

    fn api_for_ref(
        &self,
        ref_: &ObjectRef,
        connection: Option<&KubernetesConnectionName>,
    ) -> Result<Api<DynamicObject>, RuntimeBridgeError> {
        let api_resource = api_resource(&ref_.api_version, &ref_.kind, &self.plural_overrides)?;
        let client = match connection {
            Some(connection) => self
                .connection_clients
                .get(connection)
                .cloned()
                .ok_or_else(|| {
                    RuntimeBridgeError::InvalidPayload(format!(
                        "Kubernetes connection client was not resolved for alias {connection}.",
                    ))
                })?,
            None => self.client.clone(),
        };
        Ok(match ref_.namespace.as_deref() {
            Some(namespace) => {
                Api::<DynamicObject>::namespaced_with(client, namespace, &api_resource)
            }
            None => Api::<DynamicObject>::all_with(client, &api_resource),
        })
    }
}

fn prune_nulls(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(prune_nulls).collect()),
        Value::Object(entries) => Value::Object(
            entries
                .into_iter()
                .filter_map(|(key, value)| {
                    if value.is_null() {
                        None
                    } else {
                        Some((key, prune_nulls(value)))
                    }
                })
                .collect(),
        ),
        other => other,
    }
}

fn has_remote_create_ownership(object: &DynamicObject) -> bool {
    object
        .metadata
        .managed_fields
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|entry| {
            entry.subresource.as_deref().unwrap_or_default().is_empty()
                && entry.manager.as_deref() == Some(REMOTE_CREATE_FIELD_MANAGER)
                && entry.operation.as_deref() == Some("Update")
        })
}

async fn remove_remote_create_ownership(
    api: &Api<DynamicObject>,
    name: &str,
    object: &DynamicObject,
) -> Result<(), RuntimeBridgeError> {
    let indices = object
        .metadata
        .managed_fields
        .as_deref()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            (entry.subresource.as_deref().unwrap_or_default().is_empty()
                && entry.manager.as_deref() == Some(REMOTE_CREATE_FIELD_MANAGER)
                && entry.operation.as_deref() == Some("Update"))
            .then_some(index)
        })
        .rev()
        .collect::<Vec<_>>();
    if indices.is_empty() {
        return Ok(());
    }

    let uid = object.metadata.uid.as_deref().ok_or_else(|| {
        RuntimeBridgeError::InvalidPayload(
            "remote SSA ownership cleanup requires metadata.uid".to_string(),
        )
    })?;
    let resource_version = object.metadata.resource_version.as_deref().ok_or_else(|| {
        RuntimeBridgeError::InvalidPayload(
            "remote SSA ownership cleanup requires metadata.resourceVersion".to_string(),
        )
    })?;
    let mut operations = vec![
        json!({ "op": "test", "path": "/metadata/uid", "value": uid }),
        json!({
            "op": "test",
            "path": "/metadata/resourceVersion",
            "value": resource_version,
        }),
    ];
    operations.extend(indices.into_iter().map(|index| {
        json!({
            "op": "remove",
            "path": format!("/metadata/managedFields/{index}"),
        })
    }));
    let patch = json_patch::Patch(serde_json::from_value(Value::Array(operations))?);
    api.patch(name, &PatchParams::default(), &Patch::<Value>::Json(patch))
        .await?;
    Ok(())
}

fn apply_resource_patch(
    owner: &ObjectRef,
    resource: &KubernetesObject,
    ownership: Option<&ApplyOwnership>,
) -> Result<Value, RuntimeBridgeError> {
    let mut value = serde_json::to_value(resource)?;
    inject_owner_reference(owner, resource, ownership, &mut value)?;
    Ok(prune_nulls(value))
}

fn json_patch_test(path: &str, value: &str) -> JsonPatchEntry {
    JsonPatchEntry {
        op: JsonPatchOperation::Test,
        path: path.to_string(),
        value: Some(json!(value)),
        from: None,
    }
}

fn inject_owner_reference(
    owner: &ObjectRef,
    resource: &KubernetesObject,
    ownership: Option<&ApplyOwnership>,
    value: &mut Value,
) -> Result<(), RuntimeBridgeError> {
    let Some(metadata) = value.get_mut("metadata").and_then(Value::as_object_mut) else {
        return Ok(());
    };

    let explicit_owner_references = metadata.contains_key("ownerReferences");
    let selected_owner = match ownership {
        Some(ApplyOwnership::None) => return Ok(()),
        Some(ApplyOwnership::Auto) | None => {
            if explicit_owner_references || !should_default_owner_reference(owner, resource) {
                return Ok(());
            }
            OwnerReferenceSelection {
                ref_: owner,
                block_owner_deletion: None,
                source: "auto",
            }
        }
        Some(ApplyOwnership::Reference {
            ref_,
            block_owner_deletion,
        }) => {
            if explicit_owner_references {
                return Err(RuntimeBridgeError::InvalidPayload(
                    "apply.ownership reference cannot be combined with resource.metadata.ownerReferences".to_string(),
                ));
            }
            OwnerReferenceSelection {
                ref_,
                block_owner_deletion: *block_owner_deletion,
                source: "reference",
            }
        }
    };

    validate_owner_reference_selection(selected_owner.ref_, resource, selected_owner.source)?;
    let Some(uid) = selected_owner.ref_.uid.as_deref() else {
        return Err(RuntimeBridgeError::InvalidPayload(format!(
            "apply.ownership {} owner ref must include uid",
            selected_owner.source
        )));
    };

    let mut owner_reference = json!({
        "apiVersion": selected_owner.ref_.api_version,
        "kind": selected_owner.ref_.kind,
        "name": selected_owner.ref_.name,
        "uid": uid,
        "controller": true,
    });
    if let Some(block_owner_deletion) = selected_owner.block_owner_deletion {
        owner_reference["blockOwnerDeletion"] = json!(block_owner_deletion);
    }
    metadata.insert("ownerReferences".to_string(), json!([owner_reference]));
    Ok(())
}

#[derive(Clone, Copy)]
struct OwnerReferenceSelection<'a> {
    ref_: &'a ObjectRef,
    block_owner_deletion: Option<bool>,
    source: &'static str,
}

fn should_default_owner_reference(owner: &ObjectRef, resource: &KubernetesObject) -> bool {
    if owner.uid.as_deref().is_none_or(str::is_empty) || is_same_object(owner, resource) {
        return false;
    }
    matches!(
        (owner.namespace.as_deref(), resource.metadata.namespace.as_deref()),
        (Some(owner_namespace), Some(resource_namespace)) if owner_namespace == resource_namespace
    )
}

fn validate_owner_reference_selection(
    owner: &ObjectRef,
    resource: &KubernetesObject,
    source: &str,
) -> Result<(), RuntimeBridgeError> {
    if owner.uid.as_deref().is_none_or(str::is_empty) {
        return Err(RuntimeBridgeError::InvalidPayload(format!(
            "apply.ownership {source} owner ref must include uid"
        )));
    }
    if is_same_object(owner, resource) {
        return Err(RuntimeBridgeError::InvalidPayload(format!(
            "apply.ownership {source} owner ref must not reference the applied resource itself"
        )));
    }

    match (
        owner.namespace.as_deref(),
        resource.metadata.namespace.as_deref(),
    ) {
        (Some(owner_namespace), Some(resource_namespace))
            if owner_namespace != resource_namespace =>
        {
            Err(RuntimeBridgeError::InvalidPayload(format!(
                "apply.ownership {source} owner ref crosses namespaces: owner namespace {owner_namespace}, resource namespace {resource_namespace}"
            )))
        }
        (Some(owner_namespace), None) => Err(RuntimeBridgeError::InvalidPayload(format!(
            "apply.ownership {source} namespaced owner {owner_namespace} cannot own a cluster-scoped resource"
        ))),
        _ => Ok(()),
    }
}

fn is_same_object(owner: &ObjectRef, resource: &KubernetesObject) -> bool {
    owner.api_version == resource.api_version
        && owner.kind == resource.kind
        && owner.name == resource.metadata.name
        && owner.namespace == resource.metadata.namespace
}

pub fn validate_operation_plan(
    owner: &ObjectRef,
    plan: &NormalizedOperationPlan,
) -> Result<(), RuntimeBridgeError> {
    validate_ref(owner, "owner")?;
    let mut previous_order = 0;
    let mut mutation_connections = BTreeSet::new();
    for (index, operation) in plan.operations.iter().enumerate() {
        let current_order = canonical_operation_order(operation);
        if current_order < previous_order {
            return invalid_plan(
                index,
                &format!(
                    "operation order is not canonical: {} cannot appear after earlier operations with higher canonical order",
                    operation_kind(operation)
                ),
            );
        }
        previous_order = current_order;
        match operation {
            Operation::Apply {
                resource,
                field_manager,
                ownership,
                connection,
                authority,
                ..
            } => {
                validate_kubernetes_object(resource, index)?;
                if let Some(field_manager) = field_manager.as_deref() {
                    validate_field_manager(index, field_manager)?;
                }
                validate_apply_ownership(resource, ownership.as_ref(), index)?;
                validate_connection(connection.as_ref(), index)?;
                if connection.is_some() && !matches!(ownership, Some(ApplyOwnership::None)) {
                    return invalid_plan(
                        index,
                        "connection-scoped apply must set ownership.mode=none because Kubernetes owner references cannot cross clusters",
                    );
                }
                validate_remote_authority(
                    owner,
                    connection.as_ref(),
                    authority.as_ref(),
                    index,
                    true,
                )?;
                if let Some(connection) = connection {
                    mutation_connections.insert(connection.clone());
                }
            }
            Operation::Patch {
                ref_,
                patch,
                connection,
                authority,
            } => {
                validate_ref(ref_, "patch.ref")?;
                validate_connection(connection.as_ref(), index)?;
                if patch.is_empty() {
                    return invalid_plan(
                        index,
                        "patch.patch must contain at least one JSON Patch operation",
                    );
                }
                validate_json_patch(index, patch)?;
                validate_remote_authority(
                    owner,
                    connection.as_ref(),
                    authority.as_ref(),
                    index,
                    false,
                )?;
                if let Some(connection) = connection {
                    mutation_connections.insert(connection.clone());
                }
            }
            Operation::Delete {
                ref_,
                options,
                connection,
                authority,
            } => {
                validate_ref(ref_, "delete.ref")?;
                validate_connection(connection.as_ref(), index)?;
                validate_delete_options(index, options.as_ref())?;
                validate_remote_authority(
                    owner,
                    connection.as_ref(),
                    authority.as_ref(),
                    index,
                    false,
                )?;
                if let Some(connection) = connection {
                    mutation_connections.insert(connection.clone());
                }
            }
            Operation::Status { status, ref_ } => {
                if !status.is_object() {
                    return invalid_plan(index, "status.status must be a JSON object");
                }
                if let Some(ref_) = ref_ {
                    validate_ref(ref_, "status.ref")?;
                }
            }
            Operation::Event {
                reason,
                message,
                regarding,
                ..
            } => {
                if reason.trim().is_empty() {
                    return invalid_plan(index, "event.reason must not be empty");
                }
                if message.trim().is_empty() {
                    return invalid_plan(index, "event.message must not be empty");
                }
                validate_event_regarding(index, owner, regarding.as_ref())?;
            }
            Operation::Finalizer { finalizer, .. } => {
                if finalizer.trim().is_empty() || !finalizer.contains('/') {
                    return invalid_plan(
                        index,
                        "finalizer.finalizer must be a qualified Kubernetes finalizer name",
                    );
                }
            }
            Operation::Requeue { policy } => {
                if matches!(policy.after_seconds, Some(seconds) if seconds < 0.0) {
                    return invalid_plan(index, "requeue.policy.afterSeconds must not be negative");
                }
            }
        }
    }
    if mutation_connections.len() > 1 {
        return invalid_plan(
            0,
            "a v1 mutation plan may address at most one non-local Kubernetes connection",
        );
    }
    Ok(())
}

fn validate_connection(
    connection: Option<&KubernetesConnectionName>,
    index: usize,
) -> Result<(), RuntimeBridgeError> {
    let Some(connection) = connection else {
        return Ok(());
    };
    if connection.is_empty()
        || connection.len() > 63
        || !connection
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        || !connection.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return invalid_plan(
            index,
            "connection must be a declared DNS-label-like logical alias",
        );
    }
    Ok(())
}

fn canonical_operation_order(operation: &Operation) -> u8 {
    match operation {
        Operation::Finalizer { operation, .. } => match operation {
            FinalizerOperation::Add => 0,
            FinalizerOperation::Remove => 6,
        },
        Operation::Apply { .. } => 1,
        Operation::Patch { .. } => 2,
        Operation::Delete { .. } => 3,
        Operation::Status { .. } => 4,
        Operation::Event { .. } => 5,
        Operation::Requeue { .. } => 7,
    }
}

fn validate_delete_options(
    index: usize,
    options: Option<&applik8s_runtime_contract::DeleteOptions>,
) -> Result<(), RuntimeBridgeError> {
    let Some(options) = options else {
        return Ok(());
    };
    if let Some(grace_period_seconds) = options.grace_period_seconds {
        if grace_period_seconds < 0.0 {
            return invalid_plan(
                index,
                "delete.options.gracePeriodSeconds must not be negative",
            );
        }
        if grace_period_seconds.fract() != 0.0 {
            return invalid_plan(
                index,
                "delete.options.gracePeriodSeconds must be an integer number of seconds",
            );
        }
    }
    Ok(())
}

fn validate_event_regarding(
    index: usize,
    owner: &ObjectRef,
    regarding: Option<&ObjectRef>,
) -> Result<(), RuntimeBridgeError> {
    let target = if let Some(regarding) = regarding {
        validate_ref(regarding, "event.regarding")?;
        regarding
    } else {
        owner
    };
    if target.namespace.as_deref().is_none_or(str::is_empty) {
        return invalid_plan(
            index,
            "event.regarding must be namespaced; provide an explicit namespaced regarding object or reconcile a namespaced owner",
        );
    }
    Ok(())
}

fn validate_json_patch(
    operation_index: usize,
    patch: &[JsonPatchEntry],
) -> Result<(), RuntimeBridgeError> {
    for (patch_index, entry) in patch.iter().enumerate() {
        if !is_json_pointer(&entry.path) {
            return invalid_plan(
                operation_index,
                &format!("patch.patch[{patch_index}].path must be a JSON Pointer starting with /"),
            );
        }

        match entry.op {
            JsonPatchOperation::Add | JsonPatchOperation::Replace | JsonPatchOperation::Test => {
                if entry.value.is_none() {
                    return invalid_plan(
                        operation_index,
                        &format!(
                            "patch.patch[{patch_index}].value is required for {:?}",
                            entry.op
                        ),
                    );
                }
                if entry.from.is_some() {
                    return invalid_plan(
                        operation_index,
                        &format!(
                            "patch.patch[{patch_index}].from is not valid for {:?}",
                            entry.op
                        ),
                    );
                }
            }
            JsonPatchOperation::Remove => {
                if entry.value.is_some() {
                    return invalid_plan(
                        operation_index,
                        &format!("patch.patch[{patch_index}].value is not valid for remove"),
                    );
                }
                if entry.from.is_some() {
                    return invalid_plan(
                        operation_index,
                        &format!("patch.patch[{patch_index}].from is not valid for remove"),
                    );
                }
            }
            JsonPatchOperation::Move | JsonPatchOperation::Copy => {
                if entry
                    .from
                    .as_deref()
                    .is_none_or(|from| !is_json_pointer(from))
                {
                    return invalid_plan(
                        operation_index,
                        &format!(
                            "patch.patch[{patch_index}].from must be a JSON Pointer starting with /"
                        ),
                    );
                }
                if entry.value.is_some() {
                    return invalid_plan(
                        operation_index,
                        &format!(
                            "patch.patch[{patch_index}].value is not valid for {:?}",
                            entry.op
                        ),
                    );
                }
            }
        }
    }
    Ok(())
}

fn validate_field_manager(index: usize, field_manager: &str) -> Result<(), RuntimeBridgeError> {
    if field_manager.trim().is_empty() {
        return invalid_plan(index, "apply.fieldManager must not be empty");
    }
    if field_manager.len() > 128 {
        return invalid_plan(index, "apply.fieldManager must be at most 128 characters");
    }
    if field_manager.chars().any(char::is_control) {
        return invalid_plan(
            index,
            "apply.fieldManager must not contain control characters",
        );
    }
    Ok(())
}

fn is_json_pointer(value: &str) -> bool {
    value.starts_with('/')
}

fn validate_kubernetes_object(
    object: &KubernetesObject,
    index: usize,
) -> Result<(), RuntimeBridgeError> {
    if object.api_version.trim().is_empty() {
        return invalid_plan(index, "apply.resource.apiVersion must not be empty");
    }
    if object.kind.trim().is_empty() {
        return invalid_plan(index, "apply.resource.kind must not be empty");
    }
    if object.metadata.name.trim().is_empty() {
        return invalid_plan(index, "apply.resource.metadata.name must not be empty");
    }
    if let Some(message) = resource_scope_validation_message(
        &object.api_version,
        &object.kind,
        object.metadata.namespace.as_deref(),
        "apply.resource",
    ) {
        return invalid_plan(index, &message);
    }
    validate_apply_metadata(index, object)?;
    Ok(())
}

fn validate_apply_metadata(
    index: usize,
    object: &KubernetesObject,
) -> Result<(), RuntimeBridgeError> {
    let disallowed_field = if object.metadata.uid.is_some() {
        Some("uid")
    } else if object.metadata.resource_version.is_some() {
        Some("resourceVersion")
    } else if object.metadata.generation.is_some() {
        Some("generation")
    } else if object.metadata.deletion_timestamp.is_some() {
        Some("deletionTimestamp")
    } else if object.metadata.creation_timestamp.is_some() {
        Some("creationTimestamp")
    } else {
        ["managedFields", "selfLink"]
            .into_iter()
            .find(|field| object.metadata.extra.contains_key(*field))
    };

    if let Some(field) = disallowed_field {
        return invalid_plan(
            index,
            &format!(
                "apply.resource.metadata.{field} is server-populated and must not be set by handlers"
            ),
        );
    }

    Ok(())
}

fn validate_apply_ownership(
    resource: &KubernetesObject,
    ownership: Option<&ApplyOwnership>,
    index: usize,
) -> Result<(), RuntimeBridgeError> {
    match ownership {
        Some(ApplyOwnership::None) | Some(ApplyOwnership::Auto) | None => Ok(()),
        Some(ApplyOwnership::Reference { ref_, .. }) => {
            if resource.metadata.extra.contains_key("ownerReferences") {
                return invalid_plan(
                    index,
                    "apply.ownership reference cannot be combined with resource.metadata.ownerReferences",
                );
            }
            validate_owner_reference_selection(ref_, resource, "reference").map_err(|error| {
                match error {
                    RuntimeBridgeError::InvalidPayload(message) => {
                        RuntimeBridgeError::InvalidPayload(format!(
                            "operation plan operation {index} is invalid: {message}"
                        ))
                    }
                    other => other,
                }
            })
        }
    }
}

fn validate_ref(ref_: &ObjectRef, field: &str) -> Result<(), RuntimeBridgeError> {
    if ref_.api_version.trim().is_empty()
        || ref_.kind.trim().is_empty()
        || ref_.name.trim().is_empty()
    {
        return Err(RuntimeBridgeError::InvalidPayload(format!(
            "operation plan {field} must include non-empty apiVersion, kind, and name"
        )));
    }
    if let Some(message) = resource_scope_validation_message(
        &ref_.api_version,
        &ref_.kind,
        ref_.namespace.as_deref(),
        field,
    ) {
        return Err(RuntimeBridgeError::InvalidPayload(format!(
            "operation plan {message}"
        )));
    }
    Ok(())
}

fn resource_scope_validation_message(
    api_version: &str,
    kind: &str,
    namespace: Option<&str>,
    field: &str,
) -> Option<String> {
    match known_resource_scope(api_version, kind) {
        Some(ResourceScope::Namespaced) if namespace.is_none_or(str::is_empty) => Some(format!(
            "{field} {api_version}/{kind} is namespaced and must include metadata.namespace"
        )),
        Some(ResourceScope::Cluster)
            if namespace.is_some_and(|namespace| !namespace.is_empty()) =>
        {
            Some(format!(
                "{field} {api_version}/{kind} is cluster-scoped and must not include metadata.namespace"
            ))
        }
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResourceScope {
    Namespaced,
    Cluster,
}

fn known_resource_scope(api_version: &str, kind: &str) -> Option<ResourceScope> {
    match (api_version, kind) {
        (
            "v1",
            "ConfigMap"
            | "Secret"
            | "Service"
            | "ServiceAccount"
            | "Pod"
            | "PersistentVolumeClaim"
            | "Event",
        ) => Some(ResourceScope::Namespaced),
        ("v1", "Namespace" | "PersistentVolume") => Some(ResourceScope::Cluster),
        ("apps/v1", "Deployment" | "StatefulSet" | "DaemonSet" | "ReplicaSet") => {
            Some(ResourceScope::Namespaced)
        }
        ("batch/v1", "Job" | "CronJob") => Some(ResourceScope::Namespaced),
        ("rbac.authorization.k8s.io/v1", "Role" | "RoleBinding") => Some(ResourceScope::Namespaced),
        ("rbac.authorization.k8s.io/v1", "ClusterRole" | "ClusterRoleBinding") => {
            Some(ResourceScope::Cluster)
        }
        ("apiextensions.k8s.io/v1", "CustomResourceDefinition") => Some(ResourceScope::Cluster),
        ("storage.k8s.io/v1", "StorageClass") => Some(ResourceScope::Cluster),
        _ => None,
    }
}

fn invalid_plan<T>(index: usize, message: &str) -> Result<T, RuntimeBridgeError> {
    Err(RuntimeBridgeError::InvalidPayload(format!(
        "operation plan operation {index} is invalid: {message}"
    )))
}

fn operation_failed(
    index: usize,
    operation: &Operation,
    owner: &ObjectRef,
    default_field_manager: &str,
    summary: &AppliedOperationSummary,
    error: RuntimeBridgeError,
) -> RuntimeBridgeError {
    RuntimeBridgeError::OperationFailed {
        index,
        kind: operation_kind(operation).to_string(),
        target: operation_target(operation, owner),
        field_manager: operation_field_manager(operation, default_field_manager),
        progress: summary.progress(),
        cause: error.to_string(),
    }
}

fn operation_field_manager(operation: &Operation, default_field_manager: &str) -> Option<String> {
    match operation {
        Operation::Apply { field_manager, .. } => Some(
            field_manager
                .as_deref()
                .unwrap_or(default_field_manager)
                .to_string(),
        ),
        Operation::Status { .. } => Some(default_field_manager.to_string()),
        _ => None,
    }
}

fn operation_kind(operation: &Operation) -> &'static str {
    match operation {
        Operation::Apply { .. } => "apply",
        Operation::Patch { .. } => "patch",
        Operation::Delete { .. } => "delete",
        Operation::Status { .. } => "status",
        Operation::Event { .. } => "event",
        Operation::Finalizer { .. } => "finalizer",
        Operation::Requeue { .. } => "requeue",
    }
}

fn operation_target(operation: &Operation, owner: &ObjectRef) -> String {
    match operation {
        Operation::Apply { resource, .. } => ref_label(
            &resource.api_version,
            &resource.kind,
            &resource.metadata.name,
            resource.metadata.namespace.as_deref(),
        ),
        Operation::Patch { ref_, .. } | Operation::Delete { ref_, .. } => ref_label(
            &ref_.api_version,
            &ref_.kind,
            &ref_.name,
            ref_.namespace.as_deref(),
        ),
        Operation::Status { ref_, .. } => ref_
            .as_ref()
            .map(|ref_| {
                ref_label(
                    &ref_.api_version,
                    &ref_.kind,
                    &ref_.name,
                    ref_.namespace.as_deref(),
                )
            })
            .unwrap_or_else(|| object_ref_label(owner)),
        Operation::Event { regarding, .. } => regarding
            .as_ref()
            .map(|ref_| {
                ref_label(
                    &ref_.api_version,
                    &ref_.kind,
                    &ref_.name,
                    ref_.namespace.as_deref(),
                )
            })
            .unwrap_or_else(|| object_ref_label(owner)),
        Operation::Finalizer { finalizer, .. } => {
            format!("{} {finalizer}", object_ref_label(owner))
        }
        Operation::Requeue { .. } => "controller-action".to_string(),
    }
}

fn object_ref_label(ref_: &ObjectRef) -> String {
    ref_label(
        &ref_.api_version,
        &ref_.kind,
        &ref_.name,
        ref_.namespace.as_deref(),
    )
}

fn ref_label(api_version: &str, kind: &str, name: &str, namespace: Option<&str>) -> String {
    match namespace {
        Some(namespace) => format!("{api_version}/{kind} {namespace}/{name}"),
        None => format!("{api_version}/{kind} {name}"),
    }
}

fn api_resource(
    api_version: &str,
    kind: &str,
    plural_overrides: &BTreeMap<(String, String), String>,
) -> Result<ApiResource, RuntimeBridgeError> {
    let (group, version) = split_api_version(api_version)?;
    let gvk = GroupVersionKind::gvk(&group, &version, kind);
    Ok(
        match plural_overrides.get(&(api_version.to_string(), kind.to_string())) {
            Some(plural) => ApiResource::from_gvk_with_plural(&gvk, plural),
            None => ApiResource::from_gvk(&gvk),
        },
    )
}

fn split_api_version(api_version: &str) -> Result<(String, String), RuntimeBridgeError> {
    if let Some((group, version)) = api_version.split_once('/') {
        if group.is_empty() || version.is_empty() {
            return Err(RuntimeBridgeError::InvalidPayload(format!(
                "invalid apiVersion {api_version}"
            )));
        }
        return Ok((group.to_string(), version.to_string()));
    }
    if api_version.is_empty() {
        return Err(RuntimeBridgeError::InvalidPayload(
            "apiVersion must not be empty".to_string(),
        ));
    }
    Ok((String::new(), api_version.to_string()))
}

fn default_plural_overrides() -> BTreeMap<(String, String), String> {
    BTreeMap::from([
        (
            ("v1".to_string(), "ConfigMap".to_string()),
            "configmaps".to_string(),
        ),
        (
            ("v1".to_string(), "Event".to_string()),
            "events".to_string(),
        ),
        (
            ("v1".to_string(), "Secret".to_string()),
            "secrets".to_string(),
        ),
        (
            ("v1".to_string(), "Service".to_string()),
            "services".to_string(),
        ),
        (
            ("batch/v1".to_string(), "Job".to_string()),
            "jobs".to_string(),
        ),
        (
            ("apps/v1".to_string(), "Deployment".to_string()),
            "deployments".to_string(),
        ),
        (
            ("apps/v1".to_string(), "StatefulSet".to_string()),
            "statefulsets".to_string(),
        ),
    ])
}

fn dns_label(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|character| match character {
            'a'..='z' | '0'..='9' => character,
            'A'..='Z' => character.to_ascii_lowercase(),
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if normalized.is_empty() {
        "event".to_string()
    } else {
        normalized.chars().take(63).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_the_temporary_remote_create_owner() {
        let object: DynamicObject = serde_json::from_value(json!({
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": "remote",
                "managedFields": [
                    { "manager": "applik8s-remote-create", "operation": "Update" },
                    { "manager": "applik8s-remote", "operation": "Apply", "subresource": "status" },
                    { "manager": "another-manager", "operation": "Apply" }
                ]
            }
        }))
        .expect("managed object deserializes");
        assert!(has_remote_create_ownership(&object));

        let claimed: DynamicObject = serde_json::from_value(json!({
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": "remote",
                "managedFields": [
                    { "manager": "applik8s-remote", "operation": "Apply" }
                ]
            }
        }))
        .expect("claimed object deserializes");
        assert!(!has_remote_create_ownership(&claimed));
    }

    #[test]
    fn default_owner_reference_is_injected_for_same_namespace_children() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let resource = config_map("hero-output", Some("media"), None);

        let patch = apply_resource_patch(&owner, &resource, None).expect("apply patch builds");

        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/apiVersion"),
            Some(&json!("media.applik8s.dev/v1alpha1"))
        );
        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/kind"),
            Some(&json!("ImageJob"))
        );
        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/name"),
            Some(&json!("hero-image"))
        );
        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/uid"),
            Some(&json!("owner-uid"))
        );
        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/controller"),
            Some(&json!(true))
        );
    }

    #[test]
    fn default_owner_reference_preserves_explicit_owner_references() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let resource = config_map(
            "hero-output",
            Some("media"),
            Some(
                json!([{ "apiVersion": "v1", "kind": "ConfigMap", "name": "explicit", "uid": "explicit-uid" }]),
            ),
        );

        let patch = apply_resource_patch(&owner, &resource, None).expect("apply patch builds");

        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/name"),
            Some(&json!("explicit"))
        );
        assert_eq!(patch.pointer("/metadata/ownerReferences/1"), None);
    }

    #[test]
    fn default_owner_reference_skips_missing_uid_and_cross_namespace_children() {
        let owner_without_uid = owner_ref(Some("media"), None);
        let cross_namespace_owner = owner_ref(Some("media"), Some("owner-uid"));

        let missing_uid_patch = apply_resource_patch(
            &owner_without_uid,
            &config_map("hero-output", Some("media"), None),
            None,
        )
        .expect("apply patch builds");
        let cross_namespace_patch = apply_resource_patch(
            &cross_namespace_owner,
            &config_map("hero-output", Some("other"), None),
            None,
        )
        .expect("apply patch builds");

        assert_eq!(missing_uid_patch.pointer("/metadata/ownerReferences"), None);
        assert_eq!(
            cross_namespace_patch.pointer("/metadata/ownerReferences"),
            None
        );
    }

    #[test]
    fn ownership_none_skips_runtime_owner_reference_injection() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let resource = config_map("hero-output", Some("media"), None);

        let patch = apply_resource_patch(&owner, &resource, Some(&ApplyOwnership::None))
            .expect("apply patch builds");

        assert_eq!(patch.pointer("/metadata/ownerReferences"), None);
    }

    #[test]
    fn ownership_reference_injects_valid_explicit_owner_reference() {
        let default_owner = owner_ref(Some("media"), Some("owner-uid"));
        let cluster_owner = ObjectRef {
            api_version: "infra.applik8s.dev/v1alpha1".to_string(),
            kind: "MediaPipeline".to_string(),
            name: "pipeline".to_string(),
            namespace: None,
            uid: Some("pipeline-uid".to_string()),
            resource_version: None,
        };
        let ownership = ApplyOwnership::Reference {
            ref_: cluster_owner,
            block_owner_deletion: Some(true),
        };

        let patch = apply_resource_patch(
            &default_owner,
            &config_map("hero-output", Some("media"), None),
            Some(&ownership),
        )
        .expect("apply patch builds");

        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/apiVersion"),
            Some(&json!("infra.applik8s.dev/v1alpha1"))
        );
        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/uid"),
            Some(&json!("pipeline-uid"))
        );
        assert_eq!(
            patch.pointer("/metadata/ownerReferences/0/blockOwnerDeletion"),
            Some(&json!(true))
        );
    }

    #[test]
    fn ownership_reference_invalid_scope_fails_plan_validation_before_effects() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let foreign_owner = owner_ref(Some("other"), Some("foreign-uid"));
        let plan = NormalizedOperationPlan {
            operations: vec![Operation::Apply {
                resource: config_map("hero-output", Some("media"), None),
                field_manager: None,
                force: None,
                ownership: Some(ApplyOwnership::Reference {
                    ref_: foreign_owner,
                    block_owner_deletion: None,
                }),
                connection: None,
                authority: None,
            }],
            diagnostics: None,
        };

        let error = validate_operation_plan(&owner, &plan).expect_err("cross namespace rejected");

        assert!(error.to_string().contains("crosses namespaces"));
    }

    #[test]
    fn connection_scoped_apply_requires_explicit_no_ownership() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let connection = "destination".to_string();
        let operation = |ownership| Operation::Apply {
            resource: config_map("hero-output", Some("media"), None),
            field_manager: None,
            force: None,
            ownership,
            connection: Some(connection.clone()),
            authority: Some(RemoteMutationAuthority::Managed {
                identity: "imagejob/hero/config".to_string(),
                source_uid: "owner-uid".to_string(),
            }),
        };

        let invalid = NormalizedOperationPlan {
            operations: vec![operation(None)],
            diagnostics: None,
        };
        let error = validate_operation_plan(&owner, &invalid)
            .expect_err("implicit local ownership must be rejected for a remote apply");
        assert!(error.to_string().contains("ownership.mode=none"));

        let valid = NormalizedOperationPlan {
            operations: vec![operation(Some(ApplyOwnership::None))],
            diagnostics: None,
        };
        validate_operation_plan(&owner, &valid)
            .expect("explicit no-ownership remote apply validates");
    }

    #[test]
    fn remote_mutations_require_authority_and_one_connection_scope() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let ref_ = owner_ref(Some("media"), Some("remote-uid"));
        let unguarded = NormalizedOperationPlan {
            operations: vec![Operation::Delete {
                ref_: ref_.clone(),
                options: None,
                connection: Some("destination".to_string()),
                authority: None,
            }],
            diagnostics: None,
        };
        assert!(
            validate_operation_plan(&owner, &unguarded)
                .expect_err("authority is required")
                .to_string()
                .contains("authority")
        );

        let two_connections = NormalizedOperationPlan {
            operations: vec![
                Operation::Patch {
                    ref_: ref_.clone(),
                    patch: vec![json_patch_test("/metadata/name", "pipeline")],
                    connection: Some("source".to_string()),
                    authority: Some(RemoteMutationAuthority::Existing {
                        precondition: RemoteMutationPrecondition {
                            uid: "remote-uid".to_string(),
                            resource_version: "1".to_string(),
                        },
                    }),
                },
                Operation::Delete {
                    ref_,
                    options: None,
                    connection: Some("destination".to_string()),
                    authority: Some(RemoteMutationAuthority::Existing {
                        precondition: RemoteMutationPrecondition {
                            uid: "remote-uid".to_string(),
                            resource_version: "1".to_string(),
                        },
                    }),
                },
            ],
            diagnostics: None,
        };
        assert!(
            validate_operation_plan(&owner, &two_connections)
                .expect_err("multiple remote mutation connections are rejected")
                .to_string()
                .contains("at most one")
        );
    }

    #[test]
    fn managed_remote_authority_is_owner_bound_and_apply_is_optimistically_guarded() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let stale_source = NormalizedOperationPlan {
            operations: vec![Operation::Apply {
                resource: config_map("hero-output", Some("media"), None),
                field_manager: None,
                force: None,
                ownership: Some(ApplyOwnership::None),
                connection: Some("destination".to_string()),
                authority: Some(RemoteMutationAuthority::Managed {
                    identity: "imagejob/hero/config".to_string(),
                    source_uid: "invented-uid".to_string(),
                }),
            }],
            diagnostics: None,
        };
        assert!(
            validate_operation_plan(&owner, &stale_source)
                .expect_err("handler-asserted source identities fail closed")
                .to_string()
                .contains("reconciled owner metadata.uid")
        );

        let patch = inject_remote_apply_precondition(
            serde_json::json!({ "metadata": { "name": "hero-output" } }),
            "42",
        )
        .expect("precondition injects");
        assert_eq!(
            patch.pointer("/metadata/resourceVersion"),
            Some(&json!("42"))
        );
    }

    #[test]
    fn operation_failure_includes_explicit_apply_field_manager() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let operation = Operation::Apply {
            resource: config_map("hero-output", Some("media"), None),
            field_manager: Some("image-pipeline".to_string()),
            force: None,
            ownership: None,
            connection: None,
            authority: None,
        };

        let error = operation_failed(
            3,
            &operation,
            &owner,
            "applik8s",
            &AppliedOperationSummary {
                applied: 2,
                ..AppliedOperationSummary::default()
            },
            RuntimeBridgeError::InvalidPayload("conflict".to_string()),
        );

        match error {
            RuntimeBridgeError::OperationFailed {
                index,
                kind,
                target,
                field_manager,
                progress,
                cause,
            } => {
                assert_eq!(index, 3);
                assert_eq!(kind, "apply");
                assert_eq!(target, "v1/ConfigMap media/hero-output");
                assert_eq!(field_manager.as_deref(), Some("image-pipeline"));
                assert_eq!(progress.completed_operations, 2);
                assert_eq!(progress.applied, 2);
                assert!(cause.contains("conflict"));
            }
            other => panic!("expected operation failure, got {other:?}"),
        }
    }

    #[test]
    fn operation_failure_includes_default_status_field_manager() {
        let owner = owner_ref(Some("media"), Some("owner-uid"));
        let operation = Operation::Status {
            status: json!({ "phase": "Ready" }),
            ref_: None,
        };

        let error = operation_failed(
            4,
            &operation,
            &owner,
            "applik8s",
            &AppliedOperationSummary::default(),
            RuntimeBridgeError::InvalidPayload("status conflict".to_string()),
        );

        match error {
            RuntimeBridgeError::OperationFailed {
                index,
                kind,
                target,
                field_manager,
                progress,
                cause,
            } => {
                assert_eq!(index, 4);
                assert_eq!(kind, "status");
                assert_eq!(
                    target,
                    "media.applik8s.dev/v1alpha1/ImageJob media/hero-image"
                );
                assert_eq!(field_manager.as_deref(), Some("applik8s"));
                assert_eq!(progress.completed_operations, 0);
                assert!(cause.contains("status conflict"));
            }
            other => panic!("expected operation failure, got {other:?}"),
        }
    }

    fn owner_ref(namespace: Option<&str>, uid: Option<&str>) -> ObjectRef {
        ObjectRef {
            api_version: "media.applik8s.dev/v1alpha1".to_string(),
            kind: "ImageJob".to_string(),
            name: "hero-image".to_string(),
            namespace: namespace.map(str::to_string),
            uid: uid.map(str::to_string),
            resource_version: None,
        }
    }

    fn config_map(
        name: &str,
        namespace: Option<&str>,
        owner_references: Option<Value>,
    ) -> KubernetesObject {
        let mut metadata_extra = BTreeMap::new();
        if let Some(owner_references) = owner_references {
            metadata_extra.insert("ownerReferences".to_string(), owner_references);
        }
        KubernetesObject {
            api_version: "v1".to_string(),
            kind: "ConfigMap".to_string(),
            metadata: applik8s_runtime_contract::ObjectMeta {
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
                extra: metadata_extra,
            },
            spec: None,
            status: None,
            extra: BTreeMap::from([(
                "data".to_string(),
                json!({ "sourceUrl": "s3://bucket/hero.png" }),
            )]),
        }
    }
}
