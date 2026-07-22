// typecast-file-boundary: live Kubernetes custom objects are structurally checked by the migration planner.
import { createHash, randomUUID } from "node:crypto";
import {
	APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION,
	type ApplicationKroInstanceMigrationState,
	type ApplicationKroProviderMigrationRuntime,
	type ApplicationKroProviderResourceIdentity,
	type ApplicationKroSchemaIdentity,
	type ApplicationKubernetesObject,
	KRO_RECONCILIATION_ANNOTATION,
	POSTGRES_PREPARATION_FACTORY,
} from "./application-kro-provider-migration.js";
import { applicationPostgresClusterPreparation } from "./application-postgres-preparation.js";
import { makeKubernetesApiClient } from "./kubernetes-api-client.js";

export const APPLICATION_TYPEKRO_FIELD_MANAGER = "applik8s-typekro";
export const APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION =
	"applik8s.dev/kro-provider-migration-controller";
export const APPLIK8S_KRO_MIGRATION_LEASE_ANNOTATION =
	"applik8s.dev/kro-provider-migration-id";
const APPLICATION_KRO_MIGRATION_FIELD_MANAGER =
	"applik8s-provider-ownership-migration";
const APPLICATION_KRO_MIGRATION_LEASE_DURATION_SECONDS = 60;

export interface JsonPatchOperation {
	readonly op: "add" | "remove" | "replace" | "test";
	readonly path: string;
	readonly value?: unknown;
}

interface KubernetesMigrationRuntimeOptions {
	readonly context: string;
	readonly log: (message: string) => void;
	readonly readinessTimeoutMs?: number;
	readonly kroControllerNamespace?: string;
	readonly kroControllerDeploymentName?: string;
	readonly allowLegacyTypeKroNodeFetchHandoff?: boolean;
	/** Deterministic injection used by concurrency tests; ordinary callers receive a process-unique holder. */
	readonly migrationLeaseHolderIdentity?: string;
}

interface KroControllerQuiescenceJournal {
	readonly version: 1;
	readonly migrationId: string;
	readonly originalReplicas: number;
	readonly ownershipMutationStarted: boolean;
}

/** Construct the live Kubernetes side of the fail-closed provider migration. */
export async function createKubernetesKroProviderMigrationRuntime(
	options: KubernetesMigrationRuntimeOptions,
): Promise<ApplicationKroProviderMigrationRuntime> {
	// static-import-exception: the optional Kubernetes SDK loads only for an explicit live ownership migration.
	const kubernetes = await import("@kubernetes/client-node");
	const kubeConfig = new kubernetes.KubeConfig();
	kubeConfig.loadFromDefault();
	kubeConfig.setCurrentContext(options.context);
	const customObjects = makeKubernetesApiClient(
		kubeConfig,
		kubernetes.CustomObjectsApi,
	);
	const extensions = makeKubernetesApiClient(
		kubeConfig,
		kubernetes.ApiextensionsV1Api,
	);
	const objects = makeKubernetesApiClient(
		kubeConfig,
		kubernetes.KubernetesObjectApi,
	);
	const apps = makeKubernetesApiClient(kubeConfig, kubernetes.AppsV1Api);
	const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
	const pluralCache = new Map<string, string>();
	const kroControllerNamespace = options.kroControllerNamespace ?? "kro-system";
	const kroControllerDeploymentName =
		options.kroControllerDeploymentName ?? "kro";
	const migrationLeaseName = kroProviderMigrationLeaseName(
		kroControllerNamespace,
		kroControllerDeploymentName,
	);
	const migrationLeaseHolderIdentity =
		options.migrationLeaseHolderIdentity ??
		`applik8s-${process.pid}-${randomUUID()}`;
	let activeControllerMigrationId: string | undefined;
	let activeMigrationLeaseId: string | undefined;
	let migrationLeaseHeartbeat: ReturnType<typeof setInterval> | undefined;
	let migrationLeaseRenewal: Promise<void> | undefined;
	let migrationLeaseFailure: Error | undefined;

	const pluralFor = async (
		schema: ApplicationKroSchemaIdentity,
	): Promise<string> => {
		const key = `${schema.group}/${schema.version}/${schema.kind}`;
		const cached = pluralCache.get(key);
		if (cached) return cached;
		const crds = await extensions.listCustomResourceDefinition({});
		const plural = crds.items.find(
			(candidate) =>
				candidate.spec.group === schema.group &&
				candidate.spec.names.kind === schema.kind &&
				candidate.spec.versions.some(
					(version) => version.name === schema.version && version.served,
				),
		)?.spec.names.plural;
		if (!plural) throw new Error(`No served CRD matches ${key}.`);
		pluralCache.set(key, plural);
		return plural;
	};

	const readNamespaced = async (
		schema: ApplicationKroSchemaIdentity,
		namespace: string,
		name: string,
	): Promise<ApplicationKubernetesObject> => {
		const value = await customObjects.getNamespacedCustomObject({
			group: schema.group,
			version: schema.version,
			namespace,
			plural: await pluralFor(schema),
			name,
		});
		return kubernetesObject(value, `${schema.kind} ${namespace}/${name}`);
	};

	const patchNamespaced = async (
		schema: ApplicationKroSchemaIdentity,
		namespace: string,
		name: string,
		patch: readonly JsonPatchOperation[],
	): Promise<ApplicationKubernetesObject> =>
		kubernetesObject(
			await customObjects.patchNamespacedCustomObject({
				group: schema.group,
				version: schema.version,
				namespace,
				plural: await pluralFor(schema),
				name,
				body: patch,
				fieldManager: "applik8s-provider-ownership-migration",
			}),
			`${schema.kind} ${namespace}/${name}`,
		);

	const patchKroControllerDeployment = async (
		deployment: ApplicationKubernetesObject,
		journal: string,
		replicas: number,
	): Promise<ApplicationKubernetesObject> => {
		const annotations = deployment.metadata?.annotations;
		const patch: JsonPatchOperation[] = [
			{
				op: "test",
				path: "/metadata/resourceVersion",
				value: requiredMetadataString(deployment, "resourceVersion"),
			},
		];
		if (!annotations) {
			patch.push({
				op: "add",
				path: "/metadata/annotations",
				value: { [APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION]: journal },
			});
		} else {
			patch.push({
				op: "add",
				path: `/metadata/annotations/${jsonPointerSegment(APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION)}`,
				value: journal,
			});
		}
		patch.push({ op: "add", path: "/spec/replicas", value: replicas });
		return kubernetesObject(
			await apps.patchNamespacedDeployment({
				namespace: kroControllerNamespace,
				name: kroControllerDeploymentName,
				body: patch,
				fieldManager: APPLICATION_KRO_MIGRATION_FIELD_MANAGER,
			}),
			`Deployment ${kroControllerNamespace}/${kroControllerDeploymentName}`,
		);
	};

	const currentKroController = async (): Promise<ApplicationKubernetesObject> =>
		kubernetesObject(
			await apps.readNamespacedDeployment({
				namespace: kroControllerNamespace,
				name: kroControllerDeploymentName,
			}),
			`Deployment ${kroControllerNamespace}/${kroControllerDeploymentName}`,
		);

	const assertKroControllerQuiesced = async (
		migrationId: string,
	): Promise<void> => {
		await assertMigrationLeaseHealthy(migrationId);
		if (activeControllerMigrationId !== migrationId) {
			throw new Error(
				`KRO controller quiescence was not established for ${migrationId}.`,
			);
		}
		const deployment = await currentKroController();
		const encoded =
			deployment.metadata?.annotations?.[
				APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION
			];
		if (
			encoded === undefined ||
			parseKroControllerQuiescenceJournal(encoded).migrationId !== migrationId
		) {
			throw new Error(
				`KRO controller quiescence journal is missing or does not match ${migrationId}.`,
			);
		}
		if (deploymentReplicas(deployment) !== 0) {
			throw new Error(
				"KRO controller spec.replicas changed from zero during provider ownership migration.",
			);
		}
		const pods = await core.listNamespacedPod({
			namespace: kroControllerNamespace,
			labelSelector: deploymentSelector(deployment),
		});
		if (pods.items.length > 0) {
			throw new Error(
				`KRO controller still has ${pods.items.length} pod${pods.items.length === 1 ? "" : "s"}; ownership mutation is not quiescent.`,
			);
		}
	};

	const waitForKroControllerQuiescence = async (
		migrationId: string,
	): Promise<void> => {
		const startedAt = Date.now();
		const timeoutMs = options.readinessTimeoutMs ?? 2 * 60_000;
		let last = "controller state unavailable";
		while (Date.now() - startedAt < timeoutMs) {
			try {
				await assertKroControllerQuiesced(migrationId);
				return;
			} catch (cause) {
				last = cause instanceof Error ? cause.message : String(cause);
			}
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		throw new Error(
			`Timed out after ${timeoutMs}ms quiescing the KRO controller: ${last}`,
		);
	};

	const restoreKroController = async (migrationId: string): Promise<void> => {
		await assertMigrationLeaseHealthy(migrationId);
		const deployment = await currentKroController();
		const encoded =
			deployment.metadata?.annotations?.[
				APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION
			];
		if (encoded === undefined) {
			activeControllerMigrationId = undefined;
			return;
		}
		const journal = parseKroControllerQuiescenceJournal(encoded);
		if (journal.migrationId !== migrationId) {
			throw new Error(
				`KRO controller quiescence belongs to ${journal.migrationId}, not ${migrationId}.`,
			);
		}
		if (deploymentReplicas(deployment) !== 0) {
			throw new Error(
				"Refusing to restore a KRO controller whose replica count changed concurrently.",
			);
		}
		const patch: JsonPatchOperation[] = [
			{
				op: "test",
				path: "/metadata/resourceVersion",
				value: requiredMetadataString(deployment, "resourceVersion"),
			},
			{
				op: "test",
				path: `/metadata/annotations/${jsonPointerSegment(APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION)}`,
				value: encoded,
			},
			{ op: "test", path: "/spec/replicas", value: 0 },
			{
				op: "replace",
				path: "/spec/replicas",
				value: journal.originalReplicas,
			},
			{
				op: "remove",
				path: `/metadata/annotations/${jsonPointerSegment(APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION)}`,
			},
		];
		await apps.patchNamespacedDeployment({
			namespace: kroControllerNamespace,
			name: kroControllerDeploymentName,
			body: patch,
			fieldManager: APPLICATION_KRO_MIGRATION_FIELD_MANAGER,
		});
		activeControllerMigrationId = undefined;
		if (journal.originalReplicas === 0) return;
		const startedAt = Date.now();
		const timeoutMs = options.readinessTimeoutMs ?? 2 * 60_000;
		while (Date.now() - startedAt < timeoutMs) {
			const current = await currentKroController();
			const status =
				current.status &&
				typeof current.status === "object" &&
				!Array.isArray(current.status)
					? (current.status as Readonly<Record<string, unknown>>)
					: {};
			if (
				Number(status.availableReplicas ?? 0) >= journal.originalReplicas &&
				Number(status.readyReplicas ?? 0) >= journal.originalReplicas
			)
				return;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		throw new Error(
			`Restored KRO controller replicas to ${journal.originalReplicas}, but it did not become Ready within ${timeoutMs}ms.`,
		);
	};

	const readMigrationLease = async (): Promise<ApplicationKubernetesObject | undefined> =>
		objects
			.read({
				apiVersion: "coordination.k8s.io/v1",
				kind: "Lease",
				metadata: {
					name: migrationLeaseName,
					namespace: kroControllerNamespace,
				},
			})
			.then((value) => kubernetesObject(value, `Lease ${kroControllerNamespace}/${migrationLeaseName}`))
			.catch((cause: unknown) => {
				if (applicationKubernetesStatusCode(cause) === 404) return undefined;
				throw cause;
			});

	const replaceMigrationLease = async (
		current: ApplicationKubernetesObject,
		migrationId: string,
		now: Date,
		options: { readonly releasing?: boolean; readonly takeover?: boolean } = {},
	): Promise<void> => {
		const currentSpec = objectRecord(current.spec);
		const previousTransitions = Number(currentSpec.leaseTransitions ?? 0);
		const acquiredAt = options.takeover
			? kubernetesLeaseMicroTime(now)
			: typeof currentSpec.acquireTime === "string"
				? currentSpec.acquireTime
				: kubernetesLeaseMicroTime(now);
		const replacement: ApplicationKubernetesObject = {
			apiVersion: "coordination.k8s.io/v1",
			kind: "Lease",
			metadata: {
				name: migrationLeaseName,
				namespace: kroControllerNamespace,
				resourceVersion: requiredMetadataString(current, "resourceVersion", "Lease"),
				annotations: {
					...current.metadata?.annotations,
					[APPLIK8S_KRO_MIGRATION_LEASE_ANNOTATION]: migrationId,
				},
			},
			spec: options.releasing
				? {
						leaseDurationSeconds: 1,
						acquireTime: acquiredAt,
						renewTime: kubernetesLeaseMicroTime(now),
						leaseTransitions: previousTransitions,
					}
				: {
						holderIdentity: migrationLeaseHolderIdentity,
						leaseDurationSeconds: APPLICATION_KRO_MIGRATION_LEASE_DURATION_SECONDS,
						acquireTime: acquiredAt,
						renewTime: kubernetesLeaseMicroTime(now),
						leaseTransitions: previousTransitions + (options.takeover ? 1 : 0),
					},
		};
		await objects.replace(
			replacement as never,
			undefined,
			undefined,
			APPLICATION_KRO_MIGRATION_FIELD_MANAGER,
		);
	};

	const renewMigrationLease = async (migrationId: string): Promise<void> => {
		const current = await readMigrationLease();
		if (!current) throw new Error(`KRO provider migration Lease ${kroControllerNamespace}/${migrationLeaseName} disappeared.`);
		const holder = kroProviderMigrationLeaseHolder(current);
		const recordedMigration = current.metadata?.annotations?.[APPLIK8S_KRO_MIGRATION_LEASE_ANNOTATION];
		if (holder !== migrationLeaseHolderIdentity || recordedMigration !== migrationId) {
			throw new Error(
				`KRO provider migration Lease ${kroControllerNamespace}/${migrationLeaseName} is no longer held by this migration process.`,
			);
		}
		await replaceMigrationLease(current, migrationId, new Date());
		migrationLeaseFailure = undefined;
	};

	async function assertMigrationLeaseHealthy(migrationId: string): Promise<void> {
		if (activeMigrationLeaseId !== migrationId) {
			throw new Error(`KRO provider migration Lease was not acquired for ${migrationId}.`);
		}
		if (migrationLeaseFailure) {
			try {
				await renewMigrationLease(migrationId);
			} catch (cause) {
				throw new Error(
					`KRO provider migration Lease renewal failed; refusing further ownership mutation: ${cause instanceof Error ? cause.message : String(cause)}`,
					{ cause: migrationLeaseFailure },
				);
			}
		}
	}

	const startMigrationLeaseHeartbeat = (migrationId: string): void => {
		if (migrationLeaseHeartbeat) clearInterval(migrationLeaseHeartbeat);
		migrationLeaseHeartbeat = setInterval(() => {
			if (migrationLeaseRenewal || activeMigrationLeaseId !== migrationId) return;
			migrationLeaseRenewal = renewMigrationLease(migrationId)
				.catch((cause: unknown) => {
					migrationLeaseFailure = cause instanceof Error ? cause : new Error(String(cause));
				})
				.finally(() => {
					migrationLeaseRenewal = undefined;
				});
		}, Math.floor(APPLICATION_KRO_MIGRATION_LEASE_DURATION_SECONDS * 1_000 / 3));
		migrationLeaseHeartbeat.unref?.();
	};

	const acquireMigrationLease = async (migrationId: string): Promise<void> => {
		if (activeMigrationLeaseId) {
			if (activeMigrationLeaseId !== migrationId) throw new Error(`This process already holds the KRO provider migration Lease for ${activeMigrationLeaseId}.`);
			await renewMigrationLease(migrationId);
			return;
		}
		for (let attempt = 0; attempt < 6; attempt += 1) {
			const now = new Date();
			const current = await readMigrationLease();
			if (!current) {
				const lease: ApplicationKubernetesObject = {
					apiVersion: "coordination.k8s.io/v1",
					kind: "Lease",
					metadata: {
						name: migrationLeaseName,
						namespace: kroControllerNamespace,
						annotations: { [APPLIK8S_KRO_MIGRATION_LEASE_ANNOTATION]: migrationId },
					},
					spec: {
						holderIdentity: migrationLeaseHolderIdentity,
						leaseDurationSeconds: APPLICATION_KRO_MIGRATION_LEASE_DURATION_SECONDS,
						acquireTime: kubernetesLeaseMicroTime(now),
						renewTime: kubernetesLeaseMicroTime(now),
						leaseTransitions: 0,
					},
				};
				try {
					await objects.create(lease as never, undefined, undefined, APPLICATION_KRO_MIGRATION_FIELD_MANAGER);
					activeMigrationLeaseId = migrationId;
					migrationLeaseFailure = undefined;
					startMigrationLeaseHeartbeat(migrationId);
					return;
				} catch (cause) {
					if (applicationKubernetesStatusCode(cause) === 409) continue;
					throw cause;
				}
			}
			const holder = kroProviderMigrationLeaseHolder(current);
			const recordedMigration = current.metadata?.annotations?.[APPLIK8S_KRO_MIGRATION_LEASE_ANNOTATION];
			if (holder && holder !== migrationLeaseHolderIdentity && !kroProviderMigrationLeaseExpired(current, now)) {
				throw new Error(
					`KRO provider migration Lease ${kroControllerNamespace}/${migrationLeaseName} is held by another active process for ${recordedMigration ?? "an unknown migration"}; refusing concurrent migration ${migrationId}.`,
				);
			}
			try {
				await replaceMigrationLease(current, migrationId, now, { takeover: holder !== migrationLeaseHolderIdentity });
				activeMigrationLeaseId = migrationId;
				migrationLeaseFailure = undefined;
				startMigrationLeaseHeartbeat(migrationId);
				return;
			} catch (cause) {
				if (applicationKubernetesStatusCode(cause) === 409) continue;
				throw cause;
			}
		}
		throw new Error(`KRO provider migration Lease ${kroControllerNamespace}/${migrationLeaseName} changed repeatedly while being acquired.`);
	};

	const releaseMigrationLease = async (migrationId: string): Promise<void> => {
		if (activeMigrationLeaseId === undefined) return;
		if (activeMigrationLeaseId !== migrationId) {
			throw new Error(`This process holds the KRO provider migration Lease for ${activeMigrationLeaseId}, not ${migrationId}.`);
		}
		if (migrationLeaseHeartbeat) clearInterval(migrationLeaseHeartbeat);
		migrationLeaseHeartbeat = undefined;
		await migrationLeaseRenewal?.catch(() => undefined);
		migrationLeaseRenewal = undefined;
		const current = await readMigrationLease();
		if (!current) {
			activeMigrationLeaseId = undefined;
			migrationLeaseFailure = undefined;
			return;
		}
		const holder = kroProviderMigrationLeaseHolder(current);
		const recordedMigration = current.metadata?.annotations?.[APPLIK8S_KRO_MIGRATION_LEASE_ANNOTATION];
		if (holder !== migrationLeaseHolderIdentity || recordedMigration !== migrationId) {
			throw new Error(`Refusing to release KRO provider migration Lease ${kroControllerNamespace}/${migrationLeaseName} because this process no longer owns it.`);
		}
		await replaceMigrationLease(current, migrationId, new Date(), { releasing: true });
		activeMigrationLeaseId = undefined;
		migrationLeaseFailure = undefined;
	};

	return {
		async readResourceGraphDefinition(name) {
			return customObjects
				.getClusterCustomObject({
					group: "kro.run",
					version: "v1alpha1",
					plural: "resourcegraphdefinitions",
					name,
				})
				.then((value) =>
					kubernetesObject(value, `ResourceGraphDefinition/${name}`),
				)
				.catch((cause: unknown) => {
					if (applicationKubernetesStatusCode(cause) === 404) return undefined;
					throw cause;
				});
		},

		async listInstances(schema) {
			const result = await customObjects.listClusterCustomObject({
				group: schema.group,
				version: schema.version,
				plural: await pluralFor(schema),
			});
			return kubernetesObjectList(result, `${schema.kind} instances`);
		},

		async listProviderResources(apiVersion, kind) {
			const schema = groupedSchema(apiVersion, kind);
			const result = await customObjects.listClusterCustomObject({
				group: schema.group,
				version: schema.version,
				plural: await pluralFor(schema),
			});
			return kubernetesObjectList(result, `${apiVersion}/${kind} resources`);
		},

		async setInstanceMigrationState(schema, instance, desired, expected) {
			const identity = namespacedIdentity(instance, schema.kind);
			const current = await readNamespaced(
				schema,
				identity.namespace,
				identity.name,
			);
			const actual = instanceMigrationState(current);
			if (stableJson(actual) !== stableJson(expected)) {
				throw new Error(
					`${schema.kind} ${identity.namespace}/${identity.name} migration annotations changed concurrently: ` +
						`expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`,
				);
			}
			if (stableJson(actual) === stableJson(desired)) return current;
			const patch = instanceMigrationStatePatch(current, desired, expected);
			return patchNamespaced(schema, identity.namespace, identity.name, patch);
		},

		async quiesceKroController(migrationId) {
			await acquireMigrationLease(migrationId);
			const deployment = kubernetesObject(
				await apps.readNamespacedDeployment({
					namespace: kroControllerNamespace,
					name: kroControllerDeploymentName,
				}),
				`Deployment ${kroControllerNamespace}/${kroControllerDeploymentName}`,
			);
			const existing =
				deployment.metadata?.annotations?.[
					APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION
				];
			let journal: KroControllerQuiescenceJournal;
			if (existing !== undefined) {
				journal = parseKroControllerQuiescenceJournal(existing);
				if (journal.migrationId !== migrationId) {
					throw new Error(
						`KRO controller ${kroControllerNamespace}/${kroControllerDeploymentName} is already quiesced for ${journal.migrationId}; ` +
							`refusing concurrent migration ${migrationId}.`,
					);
				}
				if (deploymentReplicas(deployment) !== 0) {
					throw new Error(
						"The KRO controller has a migration quiescence journal but spec.replicas is not zero.",
					);
				}
			} else {
				const originalReplicas = requireRunningKroController(
					deployment,
					`${kroControllerNamespace}/${kroControllerDeploymentName}`,
				);
				journal = {
					version: 1,
					migrationId,
					originalReplicas,
					ownershipMutationStarted: false,
				};
				await patchKroControllerDeployment(
					deployment,
					JSON.stringify(journal),
					0,
				);
			}
			activeControllerMigrationId = migrationId;
			try {
				await waitForKroControllerQuiescence(migrationId);
			} catch (cause) {
				if (!journal.ownershipMutationStarted) {
					await restoreKroController(migrationId).catch(() => undefined);
				}
				throw cause;
			}
			return { ownershipMutationStarted: journal.ownershipMutationStarted };
		},

		async releaseKroControllerMigration(migrationId) {
			await releaseMigrationLease(migrationId);
		},

		async markKroControllerOwnershipMutationStarted(migrationId) {
			await assertKroControllerQuiesced(migrationId);
			const deployment = kubernetesObject(
				await apps.readNamespacedDeployment({
					namespace: kroControllerNamespace,
					name: kroControllerDeploymentName,
				}),
				`Deployment ${kroControllerNamespace}/${kroControllerDeploymentName}`,
			);
			const encoded =
				deployment.metadata?.annotations?.[
					APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION
				];
			if (encoded === undefined)
				throw new Error(
					"KRO controller quiescence journal disappeared before ownership mutation.",
				);
			const journal = parseKroControllerQuiescenceJournal(encoded);
			if (journal.migrationId !== migrationId)
				throw new Error(
					"KRO controller quiescence journal changed migrations.",
				);
			if (!journal.ownershipMutationStarted) {
				await patchKroControllerDeployment(
					deployment,
					JSON.stringify({ ...journal, ownershipMutationStarted: true }),
					0,
				);
			}
			await assertKroControllerQuiesced(migrationId);
		},

		async restoreKroController(migrationId) {
			await restoreKroController(migrationId);
		},

		async adoptProviderResource(adoption) {
			if (!activeControllerMigrationId)
				throw new Error(
					"Provider adoption requires a quiesced KRO controller.",
				);
			await assertKroControllerQuiesced(activeControllerMigrationId);
			if (
				adoption.factoryName !== POSTGRES_PREPARATION_FACTORY ||
				adoption.identity.apiVersion !== "postgresql.cnpg.io/v1" ||
				adoption.identity.kind !== "Cluster"
			) {
				throw new Error(
					`No direct adoption implementation exists for ${adoption.identity.apiVersion}/${adoption.identity.kind}.`,
				);
			}
			const spec = adoption.resource.spec;
			if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
				throw new Error(
					`${adoption.identity.kind} ${adoption.identity.namespace}/${adoption.identity.name}.spec must be an object.`,
				);
			}
			const factory = applicationPostgresClusterPreparation.factory("direct", {
				namespace: adoption.identity.namespace,
				kubeConfig,
				waitForReady: true,
				timeout: 10 * 60_000,
			});
			try {
				await factory.deploy({
					name: adoption.identity.name,
					namespace: adoption.identity.namespace,
					spec: spec as never,
				});
			} finally {
				await factory.dispose();
			}
			return readNamespaced(
				groupedSchema(adoption.identity.apiVersion, adoption.identity.kind),
				adoption.identity.namespace,
				adoption.identity.name,
			);
		},

		async removeKroOwnership(resource) {
			if (!activeControllerMigrationId)
				throw new Error(
					"Removing KRO ownership requires a quiesced KRO controller.",
				);
			await assertKroControllerQuiesced(activeControllerMigrationId);
			const identity = completeIdentity(resource);
			const schema = groupedSchema(identity.apiVersion, identity.kind);
			const current = await readNamespaced(
				schema,
				identity.namespace,
				identity.name,
			);
			if (
				requiredMetadataString(current, "uid") !==
				requiredMetadataString(resource, "uid")
			) {
				throw new Error(
					`${identity.kind} ${identity.namespace}/${identity.name} changed UID before KRO ownership could be removed.`,
				);
			}
			const patch = kroOwnershipRemovalPatch(current);
			if (patch.length === 1) return current;
			return patchNamespaced(schema, identity.namespace, identity.name, patch);
		},

		async externalizeProviderNodes(
			resourceGraphDefinition,
			desiredResourceGraphDefinition,
			nodeIds,
		) {
			if (!activeControllerMigrationId)
				throw new Error(
					"Provider externalization requires a quiesced KRO controller.",
				);
			await assertKroControllerQuiesced(activeControllerMigrationId);
			const desiredName = requiredMetadataString(
				desiredResourceGraphDefinition,
				"name",
			);
			const current = kubernetesObject(
				await customObjects.getClusterCustomObject({
					group: "kro.run",
					version: "v1alpha1",
					plural: "resourcegraphdefinitions",
					name: desiredName,
				}),
				`ResourceGraphDefinition/${desiredName}`,
			);
			assertSafeResourceGraphManagedFieldsHandoff(
				current,
				resourceGraphDefinition,
				options.allowLegacyTypeKroNodeFetchHandoff ?? false,
			);
			const patch = providerNodeExternalizationPatch(
				current,
				desiredResourceGraphDefinition,
				nodeIds,
			);
			if (patch.length === 1) return current;
			const externalized = kubernetesObject(
				await customObjects.patchClusterCustomObject({
					group: "kro.run",
					version: "v1alpha1",
					plural: "resourcegraphdefinitions",
					name: desiredName,
					body: patch,
					fieldManager: APPLICATION_TYPEKRO_FIELD_MANAGER,
				}),
				`ResourceGraphDefinition/${desiredName}`,
			);
			// `spec.resources` is atomic in the KRO CRD. JSON Patch can update it
			// safely with resourceVersion tests, but it cannot evict an earlier SSA
			// manager. Re-apply the resulting live value under the normal generated
			// artifact manager so the next ordinary deploy does not need a broad
			// --force-conflicts escape hatch.
			await objects.patch(
				resourceGraphOwnershipApplyObject(externalized) as never,
				undefined,
				undefined,
				APPLICATION_TYPEKRO_FIELD_MANAGER,
				true,
				kubernetes.PatchStrategy.ServerSideApply,
			);
			return kubernetesObject(
				await customObjects.getClusterCustomObject({
					group: "kro.run",
					version: "v1alpha1",
					plural: "resourcegraphdefinitions",
					name: desiredName,
				}),
				`ResourceGraphDefinition/${desiredName}`,
			);
		},

		async waitForResourceGraphDefinition(name) {
			const startedAt = Date.now();
			const timeoutMs = options.readinessTimeoutMs ?? 2 * 60_000;
			let last = "status unavailable";
			while (Date.now() - startedAt < timeoutMs) {
				const current = kubernetesObject(
					await customObjects.getClusterCustomObject({
						group: "kro.run",
						version: "v1alpha1",
						plural: "resourcegraphdefinitions",
						name,
					}),
					`ResourceGraphDefinition/${name}`,
				);
				const readiness = resourceGraphReadiness(current);
				last = readiness.summary;
				if (readiness.state === "ready") return;
				if (readiness.state === "failed")
					throw new Error(
						`ResourceGraphDefinition/${name} rejected the externalized graph: ${last}`,
					);
				await new Promise((resolve) => setTimeout(resolve, 1_000));
			}
			throw new Error(
				`Timed out after ${timeoutMs}ms waiting for ResourceGraphDefinition/${name}: ${last}.`,
			);
		},

		log: options.log,
	};
}

export function instanceReconciliationPatch(
	current: ApplicationKubernetesObject,
	value: string | undefined,
	expectedValue: string | undefined,
): readonly JsonPatchOperation[] {
	return instanceMigrationStatePatch(
		current,
		{
			reconciliation: value,
			journal:
				current.metadata?.annotations?.[
					APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION
				],
		},
		{
			reconciliation: expectedValue,
			journal:
				current.metadata?.annotations?.[
					APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION
				],
		},
	);
}

export function instanceMigrationStatePatch(
	current: ApplicationKubernetesObject,
	desired: ApplicationKroInstanceMigrationState,
	expected: ApplicationKroInstanceMigrationState,
): readonly JsonPatchOperation[] {
	const actual = instanceMigrationState(current);
	if (stableJson(actual) !== stableJson(expected)) {
		throw new Error(
			`Migration annotations changed concurrently: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}.`,
		);
	}
	const patch: JsonPatchOperation[] = [
		{
			op: "test",
			path: "/metadata/resourceVersion",
			value: requiredMetadataString(current, "resourceVersion"),
		},
	];
	if (!current.metadata?.annotations) {
		const annotations = Object.fromEntries(
			[
				[KRO_RECONCILIATION_ANNOTATION, desired.reconciliation],
				[APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION, desired.journal],
			].filter((entry): entry is [string, string] => entry[1] !== undefined),
		);
		if (Object.keys(annotations).length > 0)
			patch.push({
				op: "add",
				path: "/metadata/annotations",
				value: annotations,
			});
		return patch;
	}
	appendAnnotationPatch(
		patch,
		KRO_RECONCILIATION_ANNOTATION,
		actual.reconciliation,
		desired.reconciliation,
	);
	appendAnnotationPatch(
		patch,
		APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION,
		actual.journal,
		desired.journal,
	);
	return patch;
}

function appendAnnotationPatch(
	patch: JsonPatchOperation[],
	key: string,
	actual: string | undefined,
	desired: string | undefined,
): void {
	const path = `/metadata/annotations/${jsonPointerSegment(key)}`;
	if (actual !== undefined) patch.push({ op: "test", path, value: actual });
	if (desired === undefined) {
		if (actual !== undefined) patch.push({ op: "remove", path });
	} else if (actual !== desired) {
		patch.push({ op: "add", path, value: desired });
	}
}

function instanceMigrationState(
	resource: ApplicationKubernetesObject,
): ApplicationKroInstanceMigrationState {
	return {
		reconciliation:
			resource.metadata?.annotations?.[KRO_RECONCILIATION_ANNOTATION],
		journal:
			resource.metadata?.annotations?.[
				APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION
			],
	};
}

export function kroOwnershipRemovalPatch(
	current: ApplicationKubernetesObject,
): readonly JsonPatchOperation[] {
	const labels = current.metadata?.labels ?? {};
	const keys = Object.keys(labels)
		.filter(
			(key) =>
				key.startsWith("kro.run/") || key.startsWith("applyset.kubernetes.io/"),
		)
		.sort();
	const patch: JsonPatchOperation[] = [
		{
			op: "test",
			path: "/metadata/resourceVersion",
			value: requiredMetadataString(current, "resourceVersion"),
		},
	];
	for (const key of keys) {
		const path = `/metadata/labels/${jsonPointerSegment(key)}`;
		patch.push(
			{ op: "test", path, value: labels[key] },
			{ op: "remove", path },
		);
	}
	if (labels["app.kubernetes.io/managed-by"] === "kro") {
		const path = "/metadata/labels/app.kubernetes.io~1managed-by";
		patch.push(
			{ op: "test", path, value: "kro" },
			{ op: "replace", path, value: "typekro" },
		);
	}
	return patch;
}

export function providerNodeExternalizationPatch(
	current: ApplicationKubernetesObject,
	desired: ApplicationKubernetesObject,
	nodeIds: readonly string[],
): readonly JsonPatchOperation[] {
	const currentNodes = resourceGraphNodes(current);
	const desiredNodes = resourceGraphNodes(desired);
	const patch: JsonPatchOperation[] = [
		{
			op: "test",
			path: "/metadata/resourceVersion",
			value: requiredMetadataString(current, "resourceVersion"),
		},
	];
	for (const nodeId of nodeIds) {
		const currentIndex = currentNodes.findIndex((node) => node.id === nodeId);
		const desiredNode = desiredNodes.find((node) => node.id === nodeId);
		if (currentIndex < 0 || !desiredNode?.externalRef) {
			throw new Error(
				`Cannot externalize missing ResourceGraphDefinition node ${nodeId}.`,
			);
		}
		const currentNode = currentNodes[currentIndex];
		if (!currentNode)
			throw new Error(
				`Cannot externalize missing ResourceGraphDefinition node ${nodeId}.`,
			);
		const base = `/spec/resources/${currentIndex}`;
		if (currentNode.externalRef) {
			if (
				stableJson(currentNode.externalRef) !==
				stableJson(desiredNode.externalRef)
			) {
				throw new Error(
					`ResourceGraphDefinition node ${nodeId} already has a different externalRef.`,
				);
			}
			// An identical replace is deliberate: JSON Patch records the normal
			// generated-artifact field manager as the owner of the atomic resources
			// list, completing the handoff from an interrupted migration manager.
			patch.push(
				{ op: "test", path: `${base}/id`, value: nodeId },
				{
					op: "test",
					path: `${base}/externalRef`,
					value: currentNode.externalRef,
				},
				{
					op: "replace",
					path: `${base}/externalRef`,
					value: desiredNode.externalRef,
				},
			);
			continue;
		}
		if (!currentNode.template)
			throw new Error(
				`ResourceGraphDefinition node ${nodeId} has neither template nor externalRef.`,
			);
		patch.push(
			{ op: "test", path: `${base}/id`, value: nodeId },
			{
				op: "add",
				path: `${base}/externalRef`,
				value: desiredNode.externalRef,
			},
			{ op: "remove", path: `${base}/template` },
		);
	}
	return patch;
}

/** The smallest CRD-valid SSA object capable of transferring generated spec ownership. */
export function resourceGraphOwnershipApplyObject(
	current: ApplicationKubernetesObject,
): ApplicationKubernetesObject {
	const name = requiredMetadataString(
		current,
		"name",
		"ResourceGraphDefinition",
	);
	const spec =
		current.spec &&
		typeof current.spec === "object" &&
		!Array.isArray(current.spec)
			? (current.spec as Readonly<Record<string, unknown>>)
			: undefined;
	if (!spec || !Array.isArray(spec.resources)) {
		throw new Error("ResourceGraphDefinition.spec.resources must be an array.");
	}
	return {
		apiVersion: "kro.run/v1alpha1",
		kind: "ResourceGraphDefinition",
		metadata: { name },
		// KRO requires spec.schema during admission even when SSA intends to touch
		// only resources, so apply the complete live spec without metadata/status.
		spec,
	};
}

/** Reject a scoped force-apply if any unrelated actor owns generated spec fields. */
export function assertSafeResourceGraphManagedFieldsHandoff(
	current: ApplicationKubernetesObject,
	expected?: ApplicationKubernetesObject,
	allowLegacyTypeKroNodeFetchHandoff = false,
): void {
	const managedFields = current.metadata?.managedFields;
	if (!managedFields || managedFields.length === 0) {
		throw new Error(
			"ResourceGraphDefinition managedFields are unavailable; refusing a force-conflict ownership handoff.",
		);
	}
	const legacyTypeKroManagerPresent = managedFields.some(
		(field) =>
			Reflect.get(field.fieldsV1 ?? {}, "f:spec") !== undefined &&
			field.manager === "node-fetch",
	);
	if (legacyTypeKroManagerPresent) {
		if (!allowLegacyTypeKroNodeFetchHandoff) {
			throw new Error(
				'ResourceGraphDefinition spec is owned by the ambiguous legacy manager "node-fetch". ' +
					"Refusing automatic force-conflict handoff without explicit legacy TypeKro manager confirmation.",
			);
		}
		if (!expected) {
			throw new Error(
				"Legacy TypeKro ResourceGraphDefinition ownership requires the pre-migration graph for an exact concurrency check.",
			);
		}
		if (
			requiredMetadataString(current, "uid", "ResourceGraphDefinition") !==
				requiredMetadataString(expected, "uid", "ResourceGraphDefinition") ||
			stableJson(current.spec) !== stableJson(expected.spec)
		) {
			throw new Error(
				"Legacy TypeKro ResourceGraphDefinition changed after migration planning; refusing the ownership handoff.",
			);
		}
	}
	const allowedMigrationFields = { "f:spec": { "f:resources": {} } };
	for (const field of managedFields) {
		const fields = field.fieldsV1;
		if (!fields || Reflect.get(fields, "f:spec") === undefined) continue;
		if (field.manager === APPLICATION_TYPEKRO_FIELD_MANAGER) continue;
		if (
			field.manager === "applik8s-provider-ownership-migration" &&
			stableJson(fields) === stableJson(allowedMigrationFields)
		)
			continue;
		// TypeKro <=0.28 applies imperative KRO-factory RGDs with client-node's
		// merge-patch helper and no explicit fieldManager. Kubernetes records that
		// narrowly identifiable legacy write as manager "node-fetch" / Update.
		// The exact live-vs-planned spec check above prevents this compatibility
		// path from authorizing a concurrent or unrelated graph, and the caller's
		// next SSA transfers the complete spec to APPLICATION_TYPEKRO_FIELD_MANAGER.
		if (
			field.manager === "node-fetch" &&
			field.operation === "Update" &&
			field.subresource === undefined &&
			field.apiVersion === "kro.run/v1alpha1" &&
			isKnownLegacyTypeKroManagedFields(field.fieldsV1)
		)
			continue;
		throw new Error(
			`ResourceGraphDefinition spec fields are owned by unexpected manager ${JSON.stringify(field.manager ?? "<unknown>")}; ` +
				"refusing the scoped force-conflict handoff.",
		);
	}
}

function isKnownLegacyTypeKroManagedFields(
	fields: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (!fields || Object.keys(fields).length !== 1) return false;
	const spec = Reflect.get(fields, "f:spec");
	if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
	const keys = Object.keys(spec).sort();
	if (stableJson(keys) !== stableJson([".", "f:resources", "f:schema"]))
		return false;
	const ownsObject = (value: unknown): boolean =>
		Boolean(value && typeof value === "object" && !Array.isArray(value));
	return (
		stableJson(Reflect.get(spec, ".")) === "{}" &&
		stableJson(Reflect.get(spec, "f:resources")) === "{}" &&
		ownsObject(Reflect.get(spec, "f:schema"))
	);
}

function resourceGraphReadiness(resource: ApplicationKubernetesObject): {
	readonly state: "pending" | "ready" | "failed";
	readonly summary: string;
} {
	const generation =
		resource.metadata && Reflect.get(resource.metadata, "generation");
	const status = resource.status;
	if (
		typeof generation !== "number" ||
		!status ||
		typeof status !== "object" ||
		Array.isArray(status)
	) {
		return { state: "pending", summary: "generation has not been observed" };
	}
	const conditions = Array.isArray(Reflect.get(status, "conditions"))
		? (Reflect.get(status, "conditions") as readonly unknown[])
		: [];
	const current = conditions.filter((condition): condition is object => {
		if (!condition || typeof condition !== "object") return false;
		return Reflect.get(condition, "observedGeneration") === generation;
	});
	const rejected = current.find(
		(condition) =>
			Reflect.get(condition, "type") === "GraphAccepted" &&
			Reflect.get(condition, "status") === "False",
	);
	if (rejected && typeof rejected === "object") {
		return {
			state: "failed",
			summary: [
				Reflect.get(rejected, "reason"),
				Reflect.get(rejected, "message"),
			]
				.filter((value): value is string => typeof value === "string")
				.join(": "),
		};
	}
	const accepted = current.some(
		(condition) =>
			Reflect.get(condition, "type") === "GraphAccepted" &&
			Reflect.get(condition, "status") === "True",
	);
	const ready = current.some(
		(condition) =>
			Reflect.get(condition, "type") === "Ready" &&
			Reflect.get(condition, "status") === "True",
	);
	return accepted && ready
		? { state: "ready", summary: `generation ${generation} accepted` }
		: { state: "pending", summary: `waiting for generation ${generation}` };
}

function groupedSchema(
	apiVersion: string,
	kind: string,
): ApplicationKroSchemaIdentity {
	const separator = apiVersion.indexOf("/");
	if (separator <= 0 || separator === apiVersion.length - 1) {
		throw new Error(
			`Provider ${apiVersion}/${kind} must use a grouped Kubernetes apiVersion.`,
		);
	}
	return {
		group: apiVersion.slice(0, separator),
		version: apiVersion.slice(separator + 1),
		kind,
	};
}

function kubernetesObject(
	value: unknown,
	label: string,
): ApplicationKubernetesObject {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} response must be an object.`);
	return value as ApplicationKubernetesObject;
}

function kubernetesObjectList(
	value: unknown,
	label: string,
): readonly ApplicationKubernetesObject[] {
	const object = kubernetesObject(value, label);
	const items = Reflect.get(object, "items");
	if (!Array.isArray(items))
		throw new Error(`${label} response must contain an items array.`);
	return items.map((item, index) =>
		kubernetesObject(item, `${label}[${index}]`),
	);
}

function namespacedIdentity(
	value: ApplicationKubernetesObject,
	label: string,
): { readonly namespace: string; readonly name: string } {
	return {
		namespace: requiredMetadataString(value, "namespace", label),
		name: requiredMetadataString(value, "name", label),
	};
}

function completeIdentity(
	value: ApplicationKubernetesObject,
): ApplicationKroProviderResourceIdentity {
	return {
		apiVersion: requiredString(value.apiVersion, "resource.apiVersion"),
		kind: requiredString(value.kind, "resource.kind"),
		namespace: requiredMetadataString(value, "namespace"),
		name: requiredMetadataString(value, "name"),
	};
}

function requiredMetadataString(
	value: ApplicationKubernetesObject,
	key: "name" | "namespace" | "uid" | "resourceVersion",
	label = value.kind ?? "resource",
): string {
	return requiredString(value.metadata?.[key], `${label}.metadata.${key}`);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${label} must be a non-empty string.`);
	return value;
}

function deploymentReplicas(deployment: ApplicationKubernetesObject): number {
	const spec = deployment.spec;
	const replicas =
		spec && typeof spec === "object" && !Array.isArray(spec)
			? (Reflect.get(spec, "replicas") ?? 1)
			: undefined;
	if (!Number.isSafeInteger(replicas) || Number(replicas) < 0) {
		throw new Error(
			"KRO controller Deployment.spec.replicas must be a non-negative integer.",
		);
	}
	return Number(replicas);
}

/** Fail closed before migration when there is no controller to accept the externalized RGD. */
export function requireRunningKroController(
	deployment: ApplicationKubernetesObject,
	identity = "kro-system/kro",
): number {
	const replicas = deploymentReplicas(deployment);
	if (replicas < 1) {
		throw new Error(
			`KRO controller ${identity} has zero replicas. ` +
				"Provider ownership migration requires a running controller so the externalized ResourceGraphDefinition can be accepted before instances resume.",
		);
	}
	return replicas;
}

function deploymentSelector(deployment: ApplicationKubernetesObject): string {
	const spec = deployment.spec;
	const selector =
		spec && typeof spec === "object" && !Array.isArray(spec)
			? Reflect.get(spec, "selector")
			: undefined;
	const matchLabels =
		selector && typeof selector === "object" && !Array.isArray(selector)
			? Reflect.get(selector, "matchLabels")
			: undefined;
	if (
		!matchLabels ||
		typeof matchLabels !== "object" ||
		Array.isArray(matchLabels)
	) {
		throw new Error(
			"KRO controller Deployment must use a concrete spec.selector.matchLabels map.",
		);
	}
	const entries = Object.entries(matchLabels).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	if (
		entries.length === 0 ||
		entries.some(([, value]) => typeof value !== "string" || !value)
	) {
		throw new Error(
			"KRO controller Deployment selector labels must be non-empty strings.",
		);
	}
	return entries.map(([key, value]) => `${key}=${String(value)}`).join(",");
}

function parseKroControllerQuiescenceJournal(
	value: string,
): KroControllerQuiescenceJournal {
	let candidate: unknown;
	try {
		candidate = JSON.parse(value) as unknown;
	} catch {
		throw new Error(
			`Invalid ${APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION} annotation: expected JSON.`,
		);
	}
	if (
		!candidate ||
		typeof candidate !== "object" ||
		Array.isArray(candidate) ||
		Reflect.get(candidate, "version") !== 1 ||
		typeof Reflect.get(candidate, "migrationId") !== "string" ||
		!Number.isSafeInteger(Reflect.get(candidate, "originalReplicas")) ||
		Number(Reflect.get(candidate, "originalReplicas")) < 1 ||
		typeof Reflect.get(candidate, "ownershipMutationStarted") !== "boolean"
	) {
		throw new Error(
			`Invalid ${APPLIK8S_KRO_CONTROLLER_QUIESCENCE_ANNOTATION} annotation shape.`,
		);
	}
	return candidate as KroControllerQuiescenceJournal;
}

export function kroProviderMigrationLeaseName(
	namespace: string,
	deploymentName: string,
): string {
	const digest = createHash("sha256")
		.update(`${namespace}\0${deploymentName}`)
		.digest("hex")
		.slice(0, 16);
	return `applik8s-kro-migration-${digest}`;
}

export function kroProviderMigrationLeaseHolder(
	lease: ApplicationKubernetesObject,
): string | undefined {
	const holder = objectRecord(lease.spec).holderIdentity;
	return typeof holder === "string" && holder.length > 0 ? holder : undefined;
}

/** Invalid active lease timestamps fail closed instead of permitting an unsafe takeover. */
export function kroProviderMigrationLeaseExpired(
	lease: ApplicationKubernetesObject,
	now = new Date(),
): boolean {
	const spec = objectRecord(lease.spec);
	const duration = spec.leaseDurationSeconds;
	const renewedAt = spec.renewTime ?? spec.acquireTime;
	if (
		typeof duration !== "number" ||
		!Number.isSafeInteger(duration) ||
		duration < 1 ||
		typeof renewedAt !== "string"
	) return false;
	const timestamp = Date.parse(renewedAt);
	if (!Number.isFinite(timestamp)) return false;
	return timestamp + duration * 1_000 <= now.getTime();
}

/** Kubernetes MicroTime requires exactly six fractional digits on the wire. */
export function kubernetesLeaseMicroTime(value: Date): string {
	const iso = value.toISOString();
	return `${iso.slice(0, -1)}000Z`;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: {};
}

function resourceGraphNodes(resource: ApplicationKubernetesObject): readonly {
	readonly id: string;
	readonly template?: unknown;
	readonly externalRef?: unknown;
}[] {
	const resources =
		resource.spec &&
		typeof resource.spec === "object" &&
		!Array.isArray(resource.spec)
			? Reflect.get(resource.spec, "resources")
			: undefined;
	if (!Array.isArray(resources))
		throw new Error("ResourceGraphDefinition.spec.resources must be an array.");
	return resources.map((candidate, index) => {
		if (
			!candidate ||
			typeof candidate !== "object" ||
			Array.isArray(candidate)
		) {
			throw new Error(
				`ResourceGraphDefinition.spec.resources[${index}] must be an object.`,
			);
		}
		return {
			id: requiredString(
				Reflect.get(candidate, "id"),
				`ResourceGraphDefinition.spec.resources[${index}].id`,
			),
			...(Reflect.get(candidate, "template") !== undefined
				? { template: Reflect.get(candidate, "template") }
				: {}),
			...(Reflect.get(candidate, "externalRef") !== undefined
				? { externalRef: Reflect.get(candidate, "externalRef") }
				: {}),
		};
	});
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

function jsonPointerSegment(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function applicationKubernetesStatusCode(
	cause: unknown,
): number | undefined {
	if (!cause || typeof cause !== "object") return undefined;
	const direct =
		Reflect.get(cause, "statusCode") ??
		Reflect.get(cause, "status") ??
		Reflect.get(cause, "code");
	if (typeof direct === "number") return direct;
	const response = Reflect.get(cause, "response");
	const responseStatus =
		response && typeof response === "object"
			? (Reflect.get(response, "statusCode") ?? Reflect.get(response, "status"))
			: undefined;
	if (typeof responseStatus === "number") return responseStatus;
	const body = Reflect.get(cause, "body");
	const parsedBody =
		typeof body === "string"
			? (() => {
					try {
						return JSON.parse(body) as unknown;
					} catch {
						return undefined;
					}
				})()
			: body;
	const bodyCode =
		parsedBody && typeof parsedBody === "object"
			? Reflect.get(parsedBody, "code")
			: undefined;
	return typeof bodyCode === "number" ? bodyCode : undefined;
}
