import { describe, expect, it, vi } from "vitest";

import {
	APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION,
	type ApplicationKroProviderMigrationRuntime,
	type ApplicationKubernetesObject,
	KRO_RECONCILIATION_ANNOTATION,
	migrateApplicationKroOwnedProviderData,
	POSTGRES_PREPARATION_FACTORY,
	resolveKroSchemaString,
} from "../src/application-kro-provider-migration.js";
import {
	applicationKubernetesStatusCode,
	assertSafeResourceGraphManagedFieldsHandoff,
	instanceReconciliationPatch,
	kubernetesLeaseMicroTime,
	kroProviderMigrationLeaseExpired,
	kroProviderMigrationLeaseHolder,
	kroProviderMigrationLeaseName,
	kroOwnershipRemovalPatch,
	providerNodeExternalizationPatch,
	requireRunningKroController,
	resourceGraphOwnershipApplyObject,
} from "../src/application-kro-provider-migration-kubernetes.js";

const schema = {
	group: "applications.chirp.dev",
	version: "v1alpha1",
	kind: "ChirpInstallation",
} satisfies Readonly<Record<"group" | "version" | "kind", string>>;

describe("KRO-owned provider-data migration", () => {
	it("derives a bounded Lease identity and fails closed on malformed active lease expiry", () => {
		expect(
			kubernetesLeaseMicroTime(new Date("2026-07-21T22:32:07.803Z")),
		).toBe("2026-07-21T22:32:07.803000Z");
		expect(kroProviderMigrationLeaseName("kro-system", "kro")).toMatch(
			/^applik8s-kro-migration-[a-f0-9]{16}$/,
		);
		const active = {
			spec: {
				holderIdentity: "deploy-a",
				leaseDurationSeconds: 60,
				renewTime: "2026-07-21T12:00:00.000Z",
			},
		};
		expect(kroProviderMigrationLeaseHolder(active)).toBe("deploy-a");
		expect(
			kroProviderMigrationLeaseExpired(
				active,
				new Date("2026-07-21T12:00:59.999Z"),
			),
		).toBe(false);
		expect(
			kroProviderMigrationLeaseExpired(
				active,
				new Date("2026-07-21T12:01:00.000Z"),
			),
		).toBe(true);
		expect(
			kroProviderMigrationLeaseExpired({
				spec: { holderIdentity: "deploy-a", renewTime: "not-a-date" },
			}),
		).toBe(false);
	});

	it("requires a running KRO controller before recording a quiescence journal", () => {
		expect(requireRunningKroController({ spec: {} })).toBe(1);
		expect(requireRunningKroController({ spec: { replicas: 2 } })).toBe(2);
		expect(() =>
			requireRunningKroController(
				{ spec: { replicas: 0 } },
				"custom-kro/kro-controller",
			),
		).toThrow("KRO controller custom-kro/kro-controller has zero replicas");
	});

	it("recognizes current Kubernetes SDK status error shapes for idempotent absence", () => {
		expect(applicationKubernetesStatusCode({ code: 404 })).toBe(404);
		expect(applicationKubernetesStatusCode({ statusCode: 409 })).toBe(409);
		expect(applicationKubernetesStatusCode({ response: { status: 422 } })).toBe(
			422,
		);
		expect(
			applicationKubernetesStatusCode({ body: '{"kind":"Status","code":404}' }),
		).toBe(404);
	});

	it("releases the process Lease after successful completion and pre-mutation failure", async () => {
		const successfulBase = fakeRuntime({ instances: [], providers: [], events: [] });
		const successfulRelease = vi.fn(async () => undefined);
		await migrateApplicationKroOwnedProviderData({
			resourceGraphDefinitionName: "chirp",
			desiredResourceGraphDefinition: definition("externalRef"),
			runtime: {
				...successfulBase,
				releaseKroControllerMigration: successfulRelease,
			},
		});
		expect(successfulRelease).toHaveBeenCalledOnce();

		const failingBase = fakeRuntime({ instances: [], providers: [], events: [] });
		const failingRelease = vi.fn(async () => undefined);
		await expect(
			migrateApplicationKroOwnedProviderData({
				resourceGraphDefinitionName: "chirp",
				desiredResourceGraphDefinition: definition("externalRef"),
				runtime: {
					...failingBase,
					async listInstances() {
						throw new Error("simulated discovery failure");
					},
					releaseKroControllerMigration: failingRelease,
				},
			}),
		).rejects.toThrow("simulated discovery failure");
		expect(failingRelease).toHaveBeenCalledOnce();
	});

	it("suspends every instance, preserves provider UIDs, externalizes once, and resumes", async () => {
		const events: string[] = [];
		const instances = [
			installation("chirp-a", "control-a"),
			installation("chirp-b", "control-b"),
		];
		const providers = instances.map((instance, index) =>
			kroCluster(instance, `uid-${index + 1}`),
		);
		const runtime = fakeRuntime({ instances, providers, events });

		const receipt = await migrateApplicationKroOwnedProviderData({
			resourceGraphDefinitionName: "chirp",
			desiredResourceGraphDefinition: definition("externalRef"),
			runtime,
		});

		expect(receipt).toEqual({
			apiVersion: "applik8s.deployment/v1alpha1",
			kind: "ApplicationKroProviderMigrationReceipt",
			resourceGraphDefinition: "chirp",
			state: "completed",
			suspendedInstances: 2,
			adoptedResources: [
				expect.objectContaining({
					namespace: "chirp-a",
					name: "chirp",
					uid: "uid-1",
					nodeId: "accountModelStoreCluster",
				}),
				expect.objectContaining({
					namespace: "chirp-b",
					name: "chirp",
					uid: "uid-2",
					nodeId: "accountModelStoreCluster",
				}),
			],
			externalizedNodeIds: ["accountModelStoreCluster"],
		});
		expect(events).toEqual([
			"controller:quiesce:ResourceGraphDefinition/chirp",
			"log:Suspending KRO reconciliation for control-a/chirp-a",
			"reconcile:control-a/chirp-a:undefined->suspended",
			"log:Suspending KRO reconciliation for control-b/chirp-b",
			"reconcile:control-b/chirp-b:undefined->suspended",
			"controller:mutation:ResourceGraphDefinition/chirp",
			"log:Adopting Cluster chirp-a/chirp without replacement",
			"adopt:chirp-a/chirp",
			"detach:chirp-a/chirp",
			"log:Adopting Cluster chirp-b/chirp without replacement",
			"adopt:chirp-b/chirp",
			"detach:chirp-b/chirp",
			"log:Externalizing provider node accountModelStoreCluster in ResourceGraphDefinition/chirp",
			"externalize:accountModelStoreCluster",
			"controller:restore:ResourceGraphDefinition/chirp",
			"wait:chirp",
			"reconcile:control-a/chirp-a:suspended->undefined",
			"log:Resumed KRO reconciliation for control-a/chirp-a",
			"reconcile:control-b/chirp-b:suspended->undefined",
			"log:Resumed KRO reconciliation for control-b/chirp-b",
		]);
	});

	it("does not resume instances after adoption starts and a UID invariant fails", async () => {
		const events: string[] = [];
		const instance = installation("chirp", "chirp-control");
		const runtime = fakeRuntime({
			instances: [instance],
			providers: [kroCluster(instance, "uid-before")],
			events,
		});
		runtime.adoptProviderResource = vi.fn(async (adoption) => ({
			...adoption.resource,
			metadata: {
				...adoption.resource.metadata,
				uid: "uid-after",
				labels: directLabels(adoption.resource.metadata?.labels),
			},
		}));

		await expect(
			migrateApplicationKroOwnedProviderData({
				resourceGraphDefinitionName: "chirp",
				desiredResourceGraphDefinition: definition("externalRef"),
				runtime,
			}),
		).rejects.toThrow(
			/instances? suspended.*rerun deploy with --migrate-kro-owned-provider-data.*changed UID/s,
		);

		expect(events).toContain(
			"reconcile:chirp-control/chirp:undefined->suspended",
		);
		expect(events.some((event) => event.includes("suspended->undefined"))).toBe(
			false,
		);
		expect(events.some((event) => event.startsWith("externalize:"))).toBe(
			false,
		);
	});

	it("recovers an interrupted migration whose resource is already direct-owned", async () => {
		const events: string[] = [];
		const instance = installation(
			"chirp",
			"chirp-control",
			"suspended",
			JSON.stringify({
				version: 1,
				migrationId: "ResourceGraphDefinition/chirp",
				ownedSuspension: true,
				previousReconciliation: { present: false },
			}),
		);
		const provider = directCluster(instance, "uid-stable");
		const runtime = fakeRuntime({
			instances: [instance],
			providers: [provider],
			events,
			ownershipMutationStarted: true,
		});

		const receipt = await migrateApplicationKroOwnedProviderData({
			resourceGraphDefinitionName: "chirp",
			desiredResourceGraphDefinition: definition("externalRef"),
			runtime,
		});

		expect(receipt.state).toBe("completed");
		expect(receipt.adoptedResources).toEqual([]);
		expect(receipt.suspendedInstances).toBe(1);
		expect(events).toEqual([
			"controller:quiesce:ResourceGraphDefinition/chirp",
			"log:Externalizing provider node accountModelStoreCluster in ResourceGraphDefinition/chirp",
			"externalize:accountModelStoreCluster",
			"controller:restore:ResourceGraphDefinition/chirp",
			"wait:chirp",
			"reconcile:chirp-control/chirp:suspended->undefined",
			"log:Resumed KRO reconciliation for chirp-control/chirp",
		]);
	});

	it("fails closed before mutation when a KRO template points at an ambiguously owned resource", async () => {
		const events: string[] = [];
		const instance = installation("chirp", "chirp-control");
		const direct = directCluster(instance, "uid-stable");
		const provider = {
			...direct,
			metadata: { ...direct.metadata, labels: {} },
		};
		const runtime = fakeRuntime({
			instances: [instance],
			providers: [provider],
			events,
		});

		await expect(
			migrateApplicationKroOwnedProviderData({
				resourceGraphDefinitionName: "chirp",
				desiredResourceGraphDefinition: definition("externalRef"),
				runtime,
			}),
		).rejects.toThrow(/neither matching KRO nor direct TypeKro ownership/);
		expect(events).toEqual([
			"controller:quiesce:ResourceGraphDefinition/chirp",
			"controller:restore:ResourceGraphDefinition/chirp",
		]);
	});

	it("restores already-suspended instances exactly and rejects conditional ownership", async () => {
		const events: string[] = [];
		const instance = installation("chirp", "chirp-control", "suspended");
		const desired = definition("externalRef");
		const live = definition("template");
		const resources =
			live.spec && typeof live.spec === "object"
				? Reflect.get(live.spec, "resources")
				: undefined;
		const firstResource = Array.isArray(resources) ? resources[0] : undefined;
		if (
			!firstResource ||
			typeof firstResource !== "object" ||
			Array.isArray(firstResource)
		)
			throw new Error("Test fixture RGD must contain an object resource.");
		resources[0] = {
			...firstResource,
			includeWhen: [`\${schema.spec.profile != "external"}`],
		};
		const runtime = fakeRuntime({
			instances: [instance],
			providers: [kroCluster(instance, "uid")],
			events,
			liveDefinition: live,
		});

		await expect(
			migrateApplicationKroOwnedProviderData({
				resourceGraphDefinitionName: "chirp",
				desiredResourceGraphDefinition: desired,
				runtime,
			}),
		).rejects.toThrow(/conditional.*refuses to externalize/s);
		expect(events).toEqual([]);
	});

	it("supports only concrete schema paths for provider identities", () => {
		expect(
			resolveKroSchemaString(`\${schema.spec.name}`, { name: "chirp" }),
		).toBe("chirp");
		expect(
			resolveKroSchemaString(`\${schema.spec.providers.database.namespace}`, {
				providers: { database: { namespace: "database" } },
			}),
		).toBe("database");
		expect(() =>
			resolveKroSchemaString(`\${schema.spec.name + "-db"}`, { name: "chirp" }),
		).toThrow(/computed KRO identity expression/);
		expect(() =>
			resolveKroSchemaString(`\${schema.spec.name}`, { name: "" }),
		).toThrow(/non-empty string/);
	});

	it("reasserts the normal field manager without gating a corrective deploy on an already-invalid graph", async () => {
		const events: string[] = [];
		const instance = installation("chirp", "chirp-control");
		const direct = directCluster(instance, "uid-stable");
		const provider = {
			...direct,
			metadata: { ...direct.metadata, labels: {} },
		};
		const external = definition("externalRef");
		const runtime = fakeRuntime({
			instances: [instance],
			providers: [provider],
			events,
			liveDefinition: external,
		});

		const receipt = await migrateApplicationKroOwnedProviderData({
			resourceGraphDefinitionName: "chirp",
			desiredResourceGraphDefinition: external,
			runtime,
		});

		expect(receipt.state).toBe("not-required");
		expect(events).toEqual([
			"controller:quiesce:ResourceGraphDefinition/chirp",
			"externalize:accountModelStoreCluster",
			"controller:restore:ResourceGraphDefinition/chirp",
		]);
	});

	it("journals but preserves a user-owned suspension exactly", async () => {
		const events: string[] = [];
		const instance = installation("chirp", "chirp-control", "suspended");
		const runtime = fakeRuntime({
			instances: [instance],
			providers: [kroCluster(instance, "uid")],
			events,
		});

		const receipt = await migrateApplicationKroOwnedProviderData({
			resourceGraphDefinitionName: "chirp",
			desiredResourceGraphDefinition: definition("externalRef"),
			runtime,
		});

		expect(receipt.suspendedInstances).toBe(0);
		expect(events).toContain(
			"reconcile:chirp-control/chirp:suspended->suspended",
		);
		expect(events).toContain(
			"log:Preserved user-owned KRO suspension for chirp-control/chirp",
		);
		expect(
			events.indexOf("controller:restore:ResourceGraphDefinition/chirp"),
		).toBeLessThan(events.indexOf("wait:chirp"));
	});

	it("builds optimistic JSON patches for suspension, ownership detachment, and RGD externalization", () => {
		const instance = installation("chirp", "chirp-control");
		expect(
			instanceReconciliationPatch(instance, "suspended", undefined),
		).toEqual([
			{ op: "test", path: "/metadata/resourceVersion", value: "1" },
			{
				op: "add",
				path: "/metadata/annotations",
				value: { "kro.run/reconcile": "suspended" },
			},
		]);
		const suspended = installation("chirp", "chirp-control", "suspended");
		expect(
			instanceReconciliationPatch(suspended, undefined, "suspended"),
		).toEqual([
			{ op: "test", path: "/metadata/resourceVersion", value: "1" },
			{
				op: "test",
				path: "/metadata/annotations/kro.run~1reconcile",
				value: "suspended",
			},
			{ op: "remove", path: "/metadata/annotations/kro.run~1reconcile" },
		]);

		const provider = {
			...kroCluster(instance, "uid"),
			metadata: {
				...kroCluster(instance, "uid").metadata,
				resourceVersion: "7",
			},
		};
		const ownershipPatch = kroOwnershipRemovalPatch(provider);
		expect(ownershipPatch[0]).toEqual({
			op: "test",
			path: "/metadata/resourceVersion",
			value: "7",
		});
		expect(ownershipPatch).toContainEqual({
			op: "remove",
			path: "/metadata/labels/applyset.kubernetes.io~1part-of",
		});
		expect(ownershipPatch).toContainEqual({
			op: "remove",
			path: "/metadata/labels/kro.run~1owned",
		});
		expect(ownershipPatch).toContainEqual({
			op: "replace",
			path: "/metadata/labels/app.kubernetes.io~1managed-by",
			value: "typekro",
		});

		expect(
			providerNodeExternalizationPatch(
				definition("template"),
				definition("externalRef"),
				["accountModelStoreCluster"],
			),
		).toEqual([
			{ op: "test", path: "/metadata/resourceVersion", value: "10" },
			{
				op: "test",
				path: "/spec/resources/0/id",
				value: "accountModelStoreCluster",
			},
			{
				op: "add",
				path: "/spec/resources/0/externalRef",
				value: expect.objectContaining({ kind: "Cluster" }),
			},
			{ op: "remove", path: "/spec/resources/0/template" },
		]);
		expect(
			providerNodeExternalizationPatch(
				definition("externalRef"),
				definition("externalRef"),
				["accountModelStoreCluster"],
			),
		).toEqual([
			{ op: "test", path: "/metadata/resourceVersion", value: "10" },
			{
				op: "test",
				path: "/spec/resources/0/id",
				value: "accountModelStoreCluster",
			},
			{
				op: "test",
				path: "/spec/resources/0/externalRef",
				value: expect.objectContaining({ kind: "Cluster" }),
			},
			{
				op: "replace",
				path: "/spec/resources/0/externalRef",
				value: expect.objectContaining({ kind: "Cluster" }),
			},
		]);
		expect(
			resourceGraphOwnershipApplyObject(definition("externalRef")),
		).toEqual({
			apiVersion: "kro.run/v1alpha1",
			kind: "ResourceGraphDefinition",
			metadata: { name: "chirp" },
			spec: {
				schema: expect.objectContaining({ kind: "ChirpInstallation" }),
				resources: expect.arrayContaining([
					expect.objectContaining({
						id: "accountModelStoreCluster",
						externalRef: expect.any(Object),
					}),
				]),
			},
		});
	});

	it("permits only the known resources-list migration manager during scoped SSA handoff", () => {
		const live = definition("externalRef");
		const safe = {
			...live,
			metadata: {
				...live.metadata,
				managedFields: [
					{
						manager: "applik8s-typekro",
						fieldsV1: { "f:spec": { "f:schema": {} } },
					},
					{
						manager: "applik8s-provider-ownership-migration",
						operation: "Update",
						fieldsV1: { "f:spec": { "f:resources": {} } },
					},
					{
						manager: "kro",
						subresource: "status",
						fieldsV1: { "f:status": {} },
					},
				],
			},
		};
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(safe),
		).not.toThrow();
		const legacyTypeKro = {
			...live,
			metadata: {
				...live.metadata,
				managedFields: [
					{
						manager: "node-fetch",
						operation: "Update",
						apiVersion: "kro.run/v1alpha1",
						fieldsV1: {
							"f:spec": { ".": {}, "f:schema": {}, "f:resources": {} },
						},
					},
				],
			},
		};
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(legacyTypeKro, live),
		).toThrow(/explicit legacy TypeKro manager confirmation/);
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(legacyTypeKro, live, true),
		).not.toThrow();
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(
				legacyTypeKro,
				undefined,
				true,
			),
		).toThrow(/requires the pre-migration graph/);
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(
				{
					...legacyTypeKro,
					spec: { schema: { changed: true }, resources: [] },
				},
				live,
				true,
			),
		).toThrow(/changed after migration planning/);
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(
				{
					...legacyTypeKro,
					metadata: {
						...legacyTypeKro.metadata,
						managedFields: [
							{
								manager: "node-fetch",
								operation: "Apply",
								apiVersion: "kro.run/v1alpha1",
								fieldsV1: { "f:spec": { "f:schema": {}, "f:resources": {} } },
							},
						],
					},
				},
				live,
				true,
			),
		).toThrow(/unexpected manager "node-fetch"/);
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff(
				{
					...legacyTypeKro,
					metadata: {
						...legacyTypeKro.metadata,
						managedFields: [
							{
								manager: "node-fetch",
								operation: "Update",
								apiVersion: "kro.run/v1alpha1",
								fieldsV1: {
									"f:spec": {
										".": {},
										"f:resources": {},
										"f:schema": {},
										"f:unexpected": {},
									},
								},
							},
						],
					},
				},
				live,
				true,
			),
		).toThrow(/unexpected manager "node-fetch"/);
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff({
				...safe,
				metadata: {
					...safe.metadata,
					managedFields: [
						{
							manager: "someone-else",
							fieldsV1: { "f:spec": { "f:schema": {} } },
						},
					],
				},
			}),
		).toThrow(/unexpected manager "someone-else"/);
		expect(() =>
			assertSafeResourceGraphManagedFieldsHandoff({
				...live,
				metadata: { ...live.metadata },
			}),
		).toThrow(/managedFields are unavailable/);
	});
});

function definition(
	mode: "template" | "externalRef",
): ApplicationKubernetesObject {
	const resource = {
		apiVersion: "postgresql.cnpg.io/v1",
		kind: "Cluster",
		metadata: { name: "chirp", namespace: `\${schema.spec.name}` },
	};
	return {
		apiVersion: "kro.run/v1alpha1",
		kind: "ResourceGraphDefinition",
		metadata: { name: "chirp", uid: "rgd-uid", resourceVersion: "10" },
		spec: {
			schema: {
				...schema,
				apiVersion: schema.version,
				spec: { name: "string" },
			},
			resources: [
				{
					id: "accountModelStoreCluster",
					[mode]:
						mode === "template"
							? { ...resource, spec: { instances: 1 } }
							: resource,
				},
			],
		},
	};
}

function installation(
	name: string,
	namespace: string,
	reconciliation?: string,
	journal?: string,
): ApplicationKubernetesObject {
	return {
		apiVersion: `${schema.group}/${schema.version}`,
		kind: schema.kind,
		metadata: {
			name,
			namespace,
			uid: `instance-${namespace}-${name}`,
			resourceVersion: "1",
			...(reconciliation || journal
				? {
						annotations: {
							...(reconciliation
								? { [KRO_RECONCILIATION_ANNOTATION]: reconciliation }
								: {}),
							...(journal
								? { [APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION]: journal }
								: {}),
						},
					}
				: {}),
		},
		spec: { name },
	};
}

function kroCluster(
	instance: ApplicationKubernetesObject,
	uid: string,
): ApplicationKubernetesObject {
	return {
		apiVersion: "postgresql.cnpg.io/v1",
		kind: "Cluster",
		metadata: {
			name: "chirp",
			namespace: String(
				instance.spec && typeof instance.spec === "object"
					? Reflect.get(instance.spec, "name")
					: "",
			),
			uid,
			resourceVersion: "1",
			labels: {
				"app.kubernetes.io/managed-by": "kro",
				"applyset.kubernetes.io/part-of": "applyset-test",
				"kro.run/owned": "true",
				"kro.run/node-id": "accountModelStoreCluster",
				"kro.run/instance-group": schema.group,
				"kro.run/instance-version": schema.version,
				"kro.run/instance-kind": schema.kind,
				"kro.run/instance-namespace": String(instance.metadata?.namespace),
				"kro.run/instance-name": String(instance.metadata?.name),
			},
		},
		spec: { instances: 1 },
	};
}

function directCluster(
	instance: ApplicationKubernetesObject,
	uid: string,
): ApplicationKubernetesObject {
	const resource = kroCluster(instance, uid);
	return {
		...resource,
		metadata: { ...resource.metadata, labels: directLabels() },
	};
}

function directLabels(
	existing: Readonly<Record<string, string>> = {},
): Record<string, string> {
	return {
		...existing,
		"app.kubernetes.io/managed-by": "typekro",
		"typekro.io/managed-by": "typekro",
		"typekro.io/factory-name": POSTGRES_PREPARATION_FACTORY,
		"typekro.io/instance-name": "chirp",
	};
}

function fakeRuntime(input: {
	readonly instances: readonly ApplicationKubernetesObject[];
	readonly providers: readonly ApplicationKubernetesObject[];
	readonly events: string[];
	readonly liveDefinition?: ApplicationKubernetesObject;
	readonly ownershipMutationStarted?: boolean;
}): ApplicationKroProviderMigrationRuntime {
	const liveDefinition = input.liveDefinition ?? definition("template");
	return {
		async readResourceGraphDefinition() {
			return liveDefinition;
		},
		async listInstances() {
			return input.instances;
		},
		async listProviderResources() {
			return input.providers;
		},
		async setInstanceMigrationState(_schema, instance, desired, expected) {
			const namespace = String(instance.metadata?.namespace);
			const name = String(instance.metadata?.name);
			input.events.push(
				`reconcile:${namespace}/${name}:${String(expected.reconciliation)}->${String(desired.reconciliation)}`,
			);
			const annotations = { ...(instance.metadata?.annotations ?? {}) };
			if (desired.reconciliation === undefined)
				delete annotations[KRO_RECONCILIATION_ANNOTATION];
			else annotations[KRO_RECONCILIATION_ANNOTATION] = desired.reconciliation;
			if (desired.journal === undefined)
				delete annotations[APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION];
			else
				annotations[APPLIK8S_KRO_PROVIDER_MIGRATION_ANNOTATION] =
					desired.journal;
			return {
				...instance,
				metadata: {
					...instance.metadata,
					annotations,
					resourceVersion: String(
						Number(instance.metadata?.resourceVersion ?? "0") + 1,
					),
				},
			};
		},
		async quiesceKroController(migrationId) {
			input.events.push(`controller:quiesce:${migrationId}`);
			return {
				ownershipMutationStarted: input.ownershipMutationStarted ?? false,
			};
		},
		async releaseKroControllerMigration() {},
		async markKroControllerOwnershipMutationStarted(migrationId) {
			input.events.push(`controller:mutation:${migrationId}`);
		},
		async restoreKroController(migrationId) {
			input.events.push(`controller:restore:${migrationId}`);
		},
		async adoptProviderResource(adoption) {
			input.events.push(
				`adopt:${adoption.identity.namespace}/${adoption.identity.name}`,
			);
			return {
				...adoption.resource,
				metadata: {
					...adoption.resource.metadata,
					labels: directLabels(adoption.resource.metadata?.labels),
				},
			};
		},
		async removeKroOwnership(resource) {
			input.events.push(
				`detach:${resource.metadata?.namespace}/${resource.metadata?.name}`,
			);
			const labels = { ...(resource.metadata?.labels ?? {}) };
			for (const key of Object.keys(labels)) {
				if (
					key.startsWith("kro.run/") ||
					key.startsWith("applyset.kubernetes.io/")
				)
					delete labels[key];
			}
			if (labels["app.kubernetes.io/managed-by"] === "kro")
				labels["app.kubernetes.io/managed-by"] = "typekro";
			return { ...resource, metadata: { ...resource.metadata, labels } };
		},
		async externalizeProviderNodes(_live, _desired, nodeIds) {
			input.events.push(`externalize:${nodeIds.join(",")}`);
			return definition("externalRef");
		},
		async waitForResourceGraphDefinition(name) {
			input.events.push(`wait:${name}`);
		},
		log(message) {
			input.events.push(`log:${message}`);
		},
	};
}
