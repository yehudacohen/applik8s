// typecast-file-boundary: Kubernetes API objects are validated structurally before ownership migration.

export const KRO_RECONCILIATION_ANNOTATION = "kro.run/reconcile";
export const KRO_RECONCILIATION_SUSPENDED = "suspended";
export const APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION =
	"applik8s.dev/kro-provider-migration";
export const POSTGRES_PREPARATION_FACTORY =
	"applik8s-postgres-cluster-preparation";

const KRO_OWNED_LABEL = "kro.run/owned";
const KRO_NODE_ID_LABEL = "kro.run/node-id";
const KRO_INSTANCE_GROUP_LABEL = "kro.run/instance-group";
const KRO_INSTANCE_VERSION_LABEL = "kro.run/instance-version";
const KRO_INSTANCE_KIND_LABEL = "kro.run/instance-kind";
const KRO_INSTANCE_NAMESPACE_LABEL = "kro.run/instance-namespace";
const KRO_INSTANCE_NAME_LABEL = "kro.run/instance-name";
const APPLYSET_PART_OF_LABEL = "applyset.kubernetes.io/part-of";

const TYPEKRO_MANAGED_BY_LABEL = "typekro.io/managed-by";
const TYPEKRO_FACTORY_NAME_LABEL = "typekro.io/factory-name";
const TYPEKRO_INSTANCE_NAME_LABEL = "typekro.io/instance-name";

export interface ApplicationKubernetesObject {
	readonly apiVersion?: string;
	readonly kind?: string;
	readonly metadata?: {
		readonly name?: string;
		readonly namespace?: string;
		readonly uid?: string;
		readonly resourceVersion?: string;
		readonly deletionTimestamp?: string;
		readonly labels?: Readonly<Record<string, string>>;
		readonly annotations?: Readonly<Record<string, string>>;
		readonly managedFields?: readonly {
			readonly manager?: string;
			readonly operation?: string;
			readonly apiVersion?: string;
			readonly subresource?: string;
			readonly fieldsV1?: Readonly<Record<string, unknown>>;
		}[];
	};
	readonly spec?: unknown;
	readonly [key: string]: unknown;
}

export interface ApplicationKroSchemaIdentity {
	readonly group: string;
	readonly version: string;
	readonly kind: string;
}

export interface ApplicationKroProviderResourceIdentity {
	readonly apiVersion: string;
	readonly kind: string;
	readonly namespace: string;
	readonly name: string;
}

export interface ApplicationKroProviderAdoption {
	readonly nodeId: string;
	readonly instance: ApplicationKubernetesObject;
	readonly resource: ApplicationKubernetesObject;
	readonly identity: ApplicationKroProviderResourceIdentity;
	readonly factoryName: typeof POSTGRES_PREPARATION_FACTORY;
}

export interface ApplicationKroProviderMigrationRuntime {
	readResourceGraphDefinition(
		name: string,
	): Promise<ApplicationKubernetesObject | undefined>;
	listInstances(
		schema: ApplicationKroSchemaIdentity,
	): Promise<readonly ApplicationKubernetesObject[]>;
	listProviderResources(
		apiVersion: string,
		kind: string,
	): Promise<readonly ApplicationKubernetesObject[]>;
	setInstanceMigrationState(
		schema: ApplicationKroSchemaIdentity,
		instance: ApplicationKubernetesObject,
		desired: ApplicationKroInstanceMigrationState,
		expected: ApplicationKroInstanceMigrationState,
	): Promise<ApplicationKubernetesObject>;
	quiesceKroController(
		migrationId: string,
	): Promise<{ readonly ownershipMutationStarted: boolean }>;
	/** Release the renewable Kubernetes Lease guarding this process's migration attempt. */
	releaseKroControllerMigration(migrationId: string): Promise<void>;
	markKroControllerOwnershipMutationStarted(migrationId: string): Promise<void>;
	restoreKroController(migrationId: string): Promise<void>;
	adoptProviderResource(
		adoption: ApplicationKroProviderAdoption,
	): Promise<ApplicationKubernetesObject>;
	removeKroOwnership(
		resource: ApplicationKubernetesObject,
	): Promise<ApplicationKubernetesObject>;
	externalizeProviderNodes(
		resourceGraphDefinition: ApplicationKubernetesObject,
		desiredResourceGraphDefinition: ApplicationKubernetesObject,
		nodeIds: readonly string[],
	): Promise<ApplicationKubernetesObject>;
	waitForResourceGraphDefinition(name: string): Promise<void>;
	log(message: string): void;
}

export interface ApplicationKroInstanceMigrationState {
	readonly reconciliation: string | undefined;
	readonly journal: string | undefined;
}

export interface ApplicationKroProviderMigrationReceipt {
	readonly apiVersion: "applik8s.deployment/v1alpha1";
	readonly kind: "ApplicationKroProviderMigrationReceipt";
	readonly resourceGraphDefinition: string;
	readonly state: "not-required" | "completed";
	readonly suspendedInstances: number;
	readonly adoptedResources: readonly {
		readonly nodeId: string;
		readonly apiVersion: string;
		readonly kind: string;
		readonly namespace: string;
		readonly name: string;
		readonly uid: string;
	}[];
	readonly externalizedNodeIds: readonly string[];
}

interface ResourceGraphNode {
	readonly id: string;
	readonly template?: ApplicationKubernetesObject;
	readonly externalRef?: ApplicationKubernetesObject;
	readonly includeWhen?: readonly unknown[];
}

interface ProviderTarget {
	readonly id: string;
	readonly desired: ResourceGraphNode;
	readonly live: ResourceGraphNode;
	readonly factoryName: typeof POSTGRES_PREPARATION_FACTORY;
}

interface InstanceSuspension {
	readonly instance: ApplicationKubernetesObject;
	readonly previousValue: string | undefined;
	readonly journal: string;
	readonly existingJournal: boolean;
	current: ApplicationKubernetesObject;
	changed: boolean;
}

interface InstanceMigrationJournal {
	readonly version: 1;
	readonly migrationId: string;
	readonly ownedSuspension: boolean;
	readonly previousReconciliation: {
		readonly present: boolean;
		readonly value?: string;
	};
}

/**
 * Move provider data out of a legacy KRO ApplySet without replacing it.
 *
 * The operation is deliberately forward-only after adoption begins. A failure
 * leaves instances suspended so KRO cannot reacquire or prune the provider;
 * rerunning the same migration completes the remaining idempotent steps.
 */
export async function migrateApplicationKroOwnedProviderData(input: {
	readonly resourceGraphDefinitionName: string;
	readonly desiredResourceGraphDefinition: ApplicationKubernetesObject;
	readonly runtime: ApplicationKroProviderMigrationRuntime;
}): Promise<ApplicationKroProviderMigrationReceipt> {
	const {
		resourceGraphDefinitionName,
		desiredResourceGraphDefinition,
		runtime,
	} = input;
	let liveDefinition = await runtime.readResourceGraphDefinition(
		resourceGraphDefinitionName,
	);
	if (!liveDefinition) return emptyReceipt(resourceGraphDefinitionName);

	const desiredSchema = resourceGraphSchema(desiredResourceGraphDefinition);
	const liveSchema = resourceGraphSchema(liveDefinition);
	if (!sameSchema(desiredSchema, liveSchema)) {
		throw new Error(
			`ResourceGraphDefinition/${resourceGraphDefinitionName} schema changed from ${schemaLabel(liveSchema)} to ${schemaLabel(desiredSchema)}; ` +
				"provider-data ownership migration refuses to infer instance identity across a schema change.",
		);
	}

	let targets = providerTargets(desiredResourceGraphDefinition, liveDefinition);
	if (targets.length === 0) return emptyReceipt(resourceGraphDefinitionName);
	for (const target of targets) {
		if ((target.live.includeWhen?.length ?? 0) > 0) {
			throw new Error(
				`KRO-owned provider node ${target.id} is conditional. Migration cannot prove whether every concrete instance owns the resource, so it refuses to externalize it.`,
			);
		}
	}
	const migrationId = `ResourceGraphDefinition/${resourceGraphDefinitionName}`;
	let controllerState: { readonly ownershipMutationStarted: boolean };
	try {
		controllerState = await runtime.quiesceKroController(migrationId);
	} catch (cause) {
		try {
			await runtime.releaseKroControllerMigration(migrationId);
		} catch (releaseCause) {
			throw new AggregateError(
				[cause, releaseCause],
				"KRO provider migration failed while quiescing the controller and its Kubernetes migration Lease could not be released.",
			);
		}
		throw cause;
	}
	const mutationState = { started: controllerState.ownershipMutationStarted };
	let controllerRestored = false;
	try {
		const quiescedDefinition = await runtime.readResourceGraphDefinition(
			resourceGraphDefinitionName,
		);
		if (
			!quiescedDefinition ||
			requiredObjectUid(
				quiescedDefinition,
				`ResourceGraphDefinition/${resourceGraphDefinitionName}`,
			) !==
				requiredObjectUid(
					liveDefinition,
					`ResourceGraphDefinition/${resourceGraphDefinitionName}`,
				) ||
			stableJson(quiescedDefinition.spec) !== stableJson(liveDefinition.spec)
		) {
			throw new Error(
				`ResourceGraphDefinition/${resourceGraphDefinitionName} changed while the KRO controller was being quiesced; ` +
					"refusing to migrate from a stale ownership plan.",
			);
		}
		liveDefinition = quiescedDefinition;
		targets = providerTargets(desiredResourceGraphDefinition, liveDefinition);
		const instances = await runtime.listInstances(desiredSchema);
		for (const instance of instances) {
			const identity = objectIdentity(
				instance,
				`${schemaLabel(desiredSchema)} instance`,
			);
			if (instance.metadata?.deletionTimestamp) {
				throw new Error(
					`Cannot migrate provider ownership while ${identity.namespace}/${identity.name} is terminating.`,
				);
			}
		}

		const resourcesByGvk = new Map<
			string,
			readonly ApplicationKubernetesObject[]
		>();
		const migrations: ApplicationKroProviderAdoption[] = [];
		const externalizedNodeIds: string[] = [];
		for (const target of targets) {
			if (target.live.template) externalizedNodeIds.push(target.id);
			const reference = requiredExternalReference(target.desired);
			const gvkKey = `${reference.apiVersion}/${reference.kind}`;
			let providerResources = resourcesByGvk.get(gvkKey);
			if (!providerResources) {
				providerResources = await runtime.listProviderResources(
					reference.apiVersion,
					reference.kind,
				);
				resourcesByGvk.set(gvkKey, providerResources);
			}
			for (const instance of instances) {
				const identity = concreteProviderIdentity(reference, instance.spec);
				const resource = providerResources.find((candidate) =>
					sameObjectIdentity(candidate, identity),
				);
				if (!resource) {
					if (target.live.template) {
						throw new Error(
							`KRO-owned provider node ${target.id} should materialize ${identity.kind} ${identity.namespace}/${identity.name}, but the object is absent. ` +
								"Wait for the current graph to reconcile successfully before migrating ownership.",
						);
					}
					continue;
				}
				const ownership = providerOwnership(
					resource,
					target.id,
					desiredSchema,
					instance,
				);
				if (target.live.template && ownership === "external") {
					throw new Error(
						`${identity.kind} ${identity.namespace}/${identity.name} backs KRO template node ${target.id} but has neither matching KRO nor direct TypeKro ownership. ` +
							"Refusing to orphan or adopt an ambiguously owned data resource.",
					);
				}
				if (ownership === "kro" || ownership === "transitioning") {
					migrations.push({
						nodeId: target.id,
						instance,
						resource,
						identity,
						factoryName: target.factoryName,
					});
				}
			}
		}

		if (migrations.length === 0 && externalizedNodeIds.length === 0) {
			// Re-touch the already external provider nodes with the normal generated
			// artifact manager. This completes an interrupted migration's managed
			// fields handoff without changing graph values. Do not gate an idempotent
			// rerun on the currently installed graph becoming Ready: the ordinary
			// deployment that follows may be carrying the fix for an unrelated graph
			// validation failure. Because no ownership or graph value changed here,
			// there is no unsafe transition to wait for.
			await runtime.externalizeProviderNodes(
				liveDefinition,
				desiredResourceGraphDefinition,
				targets.map((target) => target.id),
			);
				const receipt = emptyReceipt(resourceGraphDefinitionName);
				await runtime.restoreKroController(migrationId);
				await runtime.releaseKroControllerMigration(migrationId);
				return receipt;
		}

		const suspensions = instances.map((instance) =>
			instanceSuspension(instance, migrationId),
		);
		await suspendInstances(desiredSchema, suspensions, runtime);

		const adoptedResources: ApplicationKroProviderMigrationReceipt["adoptedResources"][number][] =
			[];
		try {
			for (const migration of migrations) {
				if (!mutationState.started) {
					await runtime.markKroControllerOwnershipMutationStarted(migrationId);
					mutationState.started = true;
				}
				runtime.log(
					`Adopting ${migration.identity.kind} ${migration.identity.namespace}/${migration.identity.name} without replacement`,
				);
				const beforeUid = requiredUid(migration.resource, migration.identity);
				const adopted = await runtime.adoptProviderResource(migration);
				const adoptedUid = requiredUid(adopted, migration.identity);
				if (adoptedUid !== beforeUid) {
					throw new Error(
						`${migration.identity.kind} ${migration.identity.namespace}/${migration.identity.name} changed UID during ownership adoption (${beforeUid} -> ${adoptedUid}). ` +
							"The migration will leave KRO instances suspended; investigate before resuming them.",
					);
				}
				assertDirectOwnership(adopted, migration);
				const detached = await runtime.removeKroOwnership(adopted);
				assertDetachedKroOwnership(detached, migration.identity);
				if (requiredUid(detached, migration.identity) !== beforeUid) {
					throw new Error(
						`${migration.identity.kind} ${migration.identity.namespace}/${migration.identity.name} changed UID while removing KRO ownership.`,
					);
				}
				adoptedResources.push({
					...migration.identity,
					uid: beforeUid,
					nodeId: migration.nodeId,
				});
			}

			if (externalizedNodeIds.length > 0) {
				if (!mutationState.started) {
					await runtime.markKroControllerOwnershipMutationStarted(migrationId);
					mutationState.started = true;
				}
				runtime.log(
					`Externalizing provider node${externalizedNodeIds.length === 1 ? "" : "s"} ${externalizedNodeIds.join(", ")} in ResourceGraphDefinition/${resourceGraphDefinitionName}`,
				);
				// Touch every provider target so a prior migration field manager cannot
				// retain ownership of the atomic resources list.
				await runtime.externalizeProviderNodes(
					liveDefinition,
					desiredResourceGraphDefinition,
					targets.map((target) => target.id),
				);
				// The controller must be running to validate and project the new RGD
				// generation. Provider ownership is detached and the RGD no longer
				// contains its template at this point. Every affected instance remains
				// journal-suspended, so no instance reconcile can cross the handoff
				// boundary while the graph definition itself is being accepted.
				await runtime.restoreKroController(migrationId);
				controllerRestored = true;
				await runtime.waitForResourceGraphDefinition(
					resourceGraphDefinitionName,
				);
			}
		} catch (cause) {
			throw new Error(
				`Provider ownership migration stopped with ${suspensions.length} KRO instance${suspensions.length === 1 ? "" : "s"} suspended. ` +
					(controllerRestored
						? "The provider node is externalized and affected instances remain journal-suspended while the KRO controller validates the graph. "
						: "The KRO controller remains quiesced so it cannot reacquire or prune partially migrated provider data. ") +
					"The operation is resumable: correct the reported cause and rerun deploy with --migrate-kro-owned-provider-data. " +
					`Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause },
			);
		}

		await resumeInstances(desiredSchema, suspensions, runtime);
		const receipt: ApplicationKroProviderMigrationReceipt = {
			apiVersion: "applik8s.deployment/v1alpha1",
			kind: "ApplicationKroProviderMigrationReceipt",
			resourceGraphDefinition: resourceGraphDefinitionName,
			state: "completed",
			suspendedInstances: suspensions.filter((suspension) => suspension.changed)
				.length,
			adoptedResources,
			externalizedNodeIds,
		};
			if (!controllerRestored) {
				await runtime.restoreKroController(migrationId);
				controllerRestored = true;
			}
			await runtime.releaseKroControllerMigration(migrationId);
			return receipt;
		} catch (cause) {
			let failure: unknown = cause;
			if (!mutationState.started && !controllerRestored) {
				try {
					await runtime.restoreKroController(migrationId);
				} catch (restoreCause) {
					failure = new AggregateError(
						[cause, restoreCause],
						`Provider ownership migration failed before changing provider ownership, and the KRO controller could not be restored.`,
					);
				}
			}
			try {
				await runtime.releaseKroControllerMigration(migrationId);
			} catch (releaseCause) {
				throw new AggregateError(
					[failure, releaseCause],
					"Provider ownership migration failed and its Kubernetes migration Lease could not be released.",
				);
			}
			throw failure;
		}
}

async function suspendInstances(
	schema: ApplicationKroSchemaIdentity,
	suspensions: InstanceSuspension[],
	runtime: ApplicationKroProviderMigrationRuntime,
): Promise<void> {
	const changed: InstanceSuspension[] = [];
	try {
		for (const suspension of suspensions) {
			if (suspension.existingJournal) continue;
			const identity = objectIdentity(
				suspension.instance,
				`${schema.kind} instance`,
			);
			runtime.log(
				`Suspending KRO reconciliation for ${identity.namespace}/${identity.name}`,
			);
			suspension.current = await runtime.setInstanceMigrationState(
				schema,
				suspension.current,
				{
					reconciliation: KRO_RECONCILIATION_SUSPENDED,
					journal: suspension.journal,
				},
				{ reconciliation: suspension.previousValue, journal: undefined },
			);
			changed.push(suspension);
		}
	} catch (cause) {
		const restorationErrors: string[] = [];
		for (const suspension of changed.reverse()) {
			try {
				suspension.current = await runtime.setInstanceMigrationState(
					schema,
					suspension.current,
					{ reconciliation: suspension.previousValue, journal: undefined },
					{
						reconciliation: KRO_RECONCILIATION_SUSPENDED,
						journal: suspension.journal,
					},
				);
			} catch (restoreCause) {
				restorationErrors.push(
					restoreCause instanceof Error
						? restoreCause.message
						: String(restoreCause),
				);
			}
		}
		throw new Error(
			`Could not suspend every ${schema.kind} instance; no provider ownership was changed. ${cause instanceof Error ? cause.message : String(cause)}` +
				(restorationErrors.length > 0
					? ` Restoration also failed: ${restorationErrors.join("; ")}`
					: ""),
			{ cause },
		);
	}
}

async function resumeInstances(
	schema: ApplicationKroSchemaIdentity,
	suspensions: InstanceSuspension[],
	runtime: ApplicationKroProviderMigrationRuntime,
): Promise<void> {
	const failures: string[] = [];
	for (const suspension of suspensions) {
		const identity = objectIdentity(
			suspension.instance,
			`${schema.kind} instance`,
		);
		try {
			suspension.current = await runtime.setInstanceMigrationState(
				schema,
				suspension.current,
				{ reconciliation: suspension.previousValue, journal: undefined },
				{
					reconciliation: KRO_RECONCILIATION_SUSPENDED,
					journal: suspension.journal,
				},
			);
			runtime.log(
				suspension.changed
					? `Resumed KRO reconciliation for ${identity.namespace}/${identity.name}`
					: `Preserved user-owned KRO suspension for ${identity.namespace}/${identity.name}`,
			);
		} catch (cause) {
			failures.push(
				`${identity.namespace}/${identity.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
			);
		}
	}
	if (failures.length > 0) {
		throw new Error(
			`Provider ownership migration completed safely, but some instances remain suspended: ${failures.join("; ")}. ` +
				"Rerun the migration to restore the journaled annotations safely.",
		);
	}
}

function instanceSuspension(
	instance: ApplicationKubernetesObject,
	migrationId: string,
): InstanceSuspension {
	const annotations = instance.metadata?.annotations ?? {};
	const reconciliation = annotations[KRO_RECONCILIATION_ANNOTATION];
	const encodedJournal =
		annotations[APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION];
	if (encodedJournal !== undefined) {
		const journal = parseInstanceMigrationJournal(encodedJournal);
		if (journal.migrationId !== migrationId) {
			throw new Error(
				`${instance.kind ?? "KRO instance"} ${instance.metadata?.namespace ?? "<cluster>"}/${instance.metadata?.name ?? "<unknown>"} ` +
					`has an active provider migration journal for ${journal.migrationId}; refusing concurrent ownership migration ${migrationId}.`,
			);
		}
		if (reconciliation !== KRO_RECONCILIATION_SUSPENDED) {
			throw new Error(
				`${instance.kind ?? "KRO instance"} ${instance.metadata?.namespace ?? "<cluster>"}/${instance.metadata?.name ?? "<unknown>"} ` +
					"has an Applik8s provider migration journal but is no longer suspended; refusing to overwrite the concurrent annotation change.",
			);
		}
		const previousValue = journal.previousReconciliation.present
			? journal.previousReconciliation.value
			: undefined;
		return {
			instance,
			current: instance,
			previousValue,
			journal: encodedJournal,
			existingJournal: true,
			changed: journal.ownedSuspension,
		};
	}
	const changed = reconciliation !== KRO_RECONCILIATION_SUSPENDED;
	const journal: InstanceMigrationJournal = {
		version: 1,
		migrationId,
		ownedSuspension: changed,
		previousReconciliation:
			reconciliation === undefined
				? { present: false }
				: { present: true, value: reconciliation },
	};
	return {
		instance,
		current: instance,
		previousValue: reconciliation,
		journal: JSON.stringify(journal),
		existingJournal: false,
		changed,
	};
}

function parseInstanceMigrationJournal(
	value: string,
): InstanceMigrationJournal {
	let candidate: unknown;
	try {
		candidate = JSON.parse(value) as unknown;
	} catch {
		throw new Error(
			`Invalid ${APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION} annotation: expected JSON.`,
		);
	}
	if (
		!candidate ||
		typeof candidate !== "object" ||
		Array.isArray(candidate) ||
		Reflect.get(candidate, "version") !== 1 ||
		typeof Reflect.get(candidate, "migrationId") !== "string" ||
		typeof Reflect.get(candidate, "ownedSuspension") !== "boolean"
	) {
		throw new Error(
			`Invalid ${APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION} annotation shape.`,
		);
	}
	const previous = Reflect.get(candidate, "previousReconciliation");
	if (
		!previous ||
		typeof previous !== "object" ||
		Array.isArray(previous) ||
		typeof Reflect.get(previous, "present") !== "boolean" ||
		(Reflect.get(previous, "present") === true &&
			typeof Reflect.get(previous, "value") !== "string") ||
		(Reflect.get(previous, "present") === false &&
			Reflect.get(previous, "value") !== undefined)
	) {
		throw new Error(
			`Invalid ${APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION} previous reconciliation state.`,
		);
	}
	return candidate as InstanceMigrationJournal;
}

function providerTargets(
	desiredDefinition: ApplicationKubernetesObject,
	liveDefinition: ApplicationKubernetesObject,
): ProviderTarget[] {
	const desired = resourceGraphNodes(desiredDefinition);
	const live = new Map(
		resourceGraphNodes(liveDefinition).map((node) => [node.id, node]),
	);
	const targets: ProviderTarget[] = [];
	for (const desiredNode of desired) {
		const reference = desiredNode.externalRef;
		if (
			reference?.apiVersion !== "postgresql.cnpg.io/v1" ||
			reference.kind !== "Cluster"
		)
			continue;
		const liveNode = live.get(desiredNode.id);
		if (!liveNode) continue;
		if (
			liveNode.template?.apiVersion === reference.apiVersion &&
			liveNode.template.kind === reference.kind
		) {
			targets.push({
				id: desiredNode.id,
				desired: desiredNode,
				live: liveNode,
				factoryName: POSTGRES_PREPARATION_FACTORY,
			});
			continue;
		}
		if (
			liveNode.externalRef?.apiVersion === reference.apiVersion &&
			liveNode.externalRef.kind === reference.kind
		) {
			targets.push({
				id: desiredNode.id,
				desired: desiredNode,
				live: liveNode,
				factoryName: POSTGRES_PREPARATION_FACTORY,
			});
			continue;
		}
		throw new Error(
			`ResourceGraphDefinition provider node ${desiredNode.id} changed GVK while moving to external ownership; ` +
				"automatic data-resource migration supports ownership-only transitions.",
		);
	}
	return targets;
}

function providerOwnership(
	resource: ApplicationKubernetesObject,
	nodeId: string,
	schema: ApplicationKroSchemaIdentity,
	instance: ApplicationKubernetesObject,
): "kro" | "direct" | "transitioning" | "external" {
	const labels = resource.metadata?.labels ?? {};
	const instanceIdentity = objectIdentity(instance, `${schema.kind} instance`);
	const hasKroOwnership =
		labels[KRO_OWNED_LABEL] === "true" ||
		labels[APPLYSET_PART_OF_LABEL] !== undefined ||
		labels["app.kubernetes.io/managed-by"] === "kro";
	if (hasKroOwnership) {
		const expected = {
			[KRO_NODE_ID_LABEL]: nodeId,
			[KRO_INSTANCE_GROUP_LABEL]: schema.group,
			[KRO_INSTANCE_VERSION_LABEL]: schema.version,
			[KRO_INSTANCE_KIND_LABEL]: schema.kind,
			[KRO_INSTANCE_NAMESPACE_LABEL]: instanceIdentity.namespace,
			[KRO_INSTANCE_NAME_LABEL]: instanceIdentity.name,
		};
		for (const [key, value] of Object.entries(expected)) {
			if (labels[key] !== value) {
				throw new Error(
					`${resource.kind ?? "Resource"} ${resource.metadata?.namespace ?? "<cluster>"}/${resource.metadata?.name ?? "<unknown>"} ` +
						`has KRO ownership metadata ${key}=${JSON.stringify(labels[key])}, expected ${JSON.stringify(value)}.`,
				);
			}
		}
	}
	const direct =
		labels[TYPEKRO_MANAGED_BY_LABEL] === "typekro" &&
		labels[TYPEKRO_FACTORY_NAME_LABEL] === POSTGRES_PREPARATION_FACTORY &&
		labels[TYPEKRO_INSTANCE_NAME_LABEL] === resource.metadata?.name;
	if (hasKroOwnership && direct) return "transitioning";
	if (hasKroOwnership) return "kro";
	if (direct) return "direct";
	return "external";
}

function assertDirectOwnership(
	adopted: ApplicationKubernetesObject,
	migration: ApplicationKroProviderAdoption,
): void {
	const labels = adopted.metadata?.labels ?? {};
	if (
		labels[TYPEKRO_MANAGED_BY_LABEL] !== "typekro" ||
		labels[TYPEKRO_FACTORY_NAME_LABEL] !== migration.factoryName ||
		labels[TYPEKRO_INSTANCE_NAME_LABEL] !== migration.identity.name
	) {
		throw new Error(
			`${migration.identity.kind} ${migration.identity.namespace}/${migration.identity.name} did not acquire the expected direct TypeKro ownership labels.`,
		);
	}
}

function assertDetachedKroOwnership(
	resource: ApplicationKubernetesObject,
	identity: ApplicationKroProviderResourceIdentity,
): void {
	const labels = resource.metadata?.labels ?? {};
	const remaining = Object.keys(labels).filter(
		(key) =>
			key.startsWith("kro.run/") || key.startsWith("applyset.kubernetes.io/"),
	);
	if (
		remaining.length > 0 ||
		labels["app.kubernetes.io/managed-by"] === "kro"
	) {
		throw new Error(
			`${identity.kind} ${identity.namespace}/${identity.name} retained KRO ownership labels: ${remaining.join(", ") || "app.kubernetes.io/managed-by"}.`,
		);
	}
}

function resourceGraphSchema(
	definition: ApplicationKubernetesObject,
): ApplicationKroSchemaIdentity {
	const spec = requiredRecord(definition.spec, "ResourceGraphDefinition.spec");
	const schema = requiredRecord(
		spec.schema,
		"ResourceGraphDefinition.spec.schema",
	);
	const group = requiredString(
		schema.group,
		"ResourceGraphDefinition.spec.schema.group",
	);
	const version = requiredString(
		schema.apiVersion,
		"ResourceGraphDefinition.spec.schema.apiVersion",
	);
	const kind = requiredString(
		schema.kind,
		"ResourceGraphDefinition.spec.schema.kind",
	);
	return { group, version, kind };
}

function resourceGraphNodes(
	definition: ApplicationKubernetesObject,
): ResourceGraphNode[] {
	const spec = requiredRecord(definition.spec, "ResourceGraphDefinition.spec");
	if (!Array.isArray(spec.resources))
		throw new Error("ResourceGraphDefinition.spec.resources must be an array.");
	return spec.resources.map((candidate, index) => {
		const node = requiredRecord(
			candidate,
			`ResourceGraphDefinition.spec.resources[${index}]`,
		);
		return {
			id: requiredString(
				node.id,
				`ResourceGraphDefinition.spec.resources[${index}].id`,
			),
			...(node.template &&
			typeof node.template === "object" &&
			!Array.isArray(node.template)
				? { template: node.template as ApplicationKubernetesObject }
				: {}),
			...(node.externalRef &&
			typeof node.externalRef === "object" &&
			!Array.isArray(node.externalRef)
				? { externalRef: node.externalRef as ApplicationKubernetesObject }
				: {}),
			...(Array.isArray(node.includeWhen)
				? { includeWhen: node.includeWhen }
				: {}),
		};
	});
}

function requiredExternalReference(
	node: ResourceGraphNode,
): Required<Pick<ApplicationKubernetesObject, "apiVersion" | "kind">> &
	ApplicationKubernetesObject {
	if (!node.externalRef?.apiVersion || !node.externalRef.kind) {
		throw new Error(
			`Provider node ${node.id} must contain a complete externalRef.`,
		);
	}
	return node.externalRef as Required<
		Pick<ApplicationKubernetesObject, "apiVersion" | "kind">
	> &
		ApplicationKubernetesObject;
}

function concreteProviderIdentity(
	reference: ApplicationKubernetesObject,
	spec: unknown,
): ApplicationKroProviderResourceIdentity {
	const metadata = requiredRecord(
		reference.metadata,
		"provider externalRef.metadata",
	);
	return {
		apiVersion: requiredString(
			reference.apiVersion,
			"provider externalRef.apiVersion",
		),
		kind: requiredString(reference.kind, "provider externalRef.kind"),
		name: resolveSchemaString(
			requiredString(metadata.name, "provider externalRef.metadata.name"),
			spec,
		),
		namespace: resolveSchemaString(
			requiredString(
				metadata.namespace,
				"provider externalRef.metadata.namespace",
			),
			spec,
		),
	};
}

export function resolveKroSchemaString(value: string, spec: unknown): string {
	return resolveSchemaString(value, spec);
}

function resolveSchemaString(value: string, spec: unknown): string {
	const match = /^\$\{schema\.spec\.([A-Za-z_][A-Za-z0-9_.]*)\}$/.exec(value);
	if (!match) {
		if (value.includes("${")) {
			throw new Error(
				`Cannot safely concretize computed KRO identity expression ${JSON.stringify(value)} during provider ownership migration.`,
			);
		}
		if (!value.trim())
			throw new Error("Provider externalRef identity cannot be empty.");
		return value;
	}
	const path = match[1];
	if (!path)
		throw new Error(`KRO identity expression ${value} has no schema path.`);
	let current: unknown = spec;
	for (const segment of path.split(".")) {
		if (!current || typeof current !== "object" || Array.isArray(current)) {
			throw new Error(
				`KRO identity expression ${value} does not resolve against the concrete instance spec.`,
			);
		}
		current = Reflect.get(current, segment);
	}
	if (typeof current !== "string" || !current.trim()) {
		throw new Error(
			`KRO identity expression ${value} must resolve to a non-empty string.`,
		);
	}
	return current;
}

function objectIdentity(
	resource: ApplicationKubernetesObject,
	label: string,
): { readonly namespace: string; readonly name: string } {
	return {
		namespace: requiredString(
			resource.metadata?.namespace,
			`${label}.metadata.namespace`,
		),
		name: requiredString(resource.metadata?.name, `${label}.metadata.name`),
	};
}

function sameObjectIdentity(
	resource: ApplicationKubernetesObject,
	identity: ApplicationKroProviderResourceIdentity,
): boolean {
	return (
		resource.apiVersion === identity.apiVersion &&
		resource.kind === identity.kind &&
		resource.metadata?.namespace === identity.namespace &&
		resource.metadata?.name === identity.name
	);
}

function requiredUid(
	resource: ApplicationKubernetesObject,
	identity: ApplicationKroProviderResourceIdentity,
): string {
	return requiredString(
		resource.metadata?.uid,
		`${identity.kind} ${identity.namespace}/${identity.name}.metadata.uid`,
	);
}

function requiredObjectUid(
	resource: ApplicationKubernetesObject,
	label: string,
): string {
	return requiredString(resource.metadata?.uid, `${label}.metadata.uid`);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "undefined";
}

function requiredRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${label} must be a non-empty string.`);
	return value;
}

function sameSchema(
	left: ApplicationKroSchemaIdentity,
	right: ApplicationKroSchemaIdentity,
): boolean {
	return (
		left.group === right.group &&
		left.version === right.version &&
		left.kind === right.kind
	);
}

function schemaLabel(schema: ApplicationKroSchemaIdentity): string {
	return `${schema.group}/${schema.version}/${schema.kind}`;
}

function emptyReceipt(
	resourceGraphDefinition: string,
): ApplicationKroProviderMigrationReceipt {
	return {
		apiVersion: "applik8s.deployment/v1alpha1",
		kind: "ApplicationKroProviderMigrationReceipt",
		resourceGraphDefinition,
		state: "not-required",
		suspendedInstances: 0,
		adoptedResources: [],
		externalizedNodeIds: [],
	};
}
