// typecast-file-boundary: live Kubernetes responses are inspected only after their concrete resource identity is asserted.
import { KubeConfig } from "@kubernetes/client-node";
import { type } from "arktype";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parse } from "yaml";
import { externalRef, kubernetesComposition } from "typekro";
import { cluster } from "typekro/cnpg";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
	type ApplicationKubernetesObject,
	migrateApplicationKroOwnedProviderData,
} from "../../applik8s/src/application-kro-provider-migration.js";
import { createKubernetesKroProviderMigrationRuntime } from "../../applik8s/src/application-kro-provider-migration-kubernetes.js";
import { applicationPostgresClusterPreparation } from "../../applik8s/src/application-postgres-preparation.js";
import {
	collectV06ClusterIdentity,
	collectV06GitIdentity,
	createV06AssertionEvidence,
	discardV06Evidence,
	writeV06EvidenceReceipt,
} from "../../../scripts/v06-evidence.js";
import {
	assertExpectedKubectlContext,
	describeLive,
	kubectl,
} from "./live-e2e-helpers.js";

const context = process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack";
const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? "default";
const kroNamespace = process.env.APPLIK8S_E2E_KRO_NAMESPACE ?? "kro-system";
const suffix = `${process.pid}`;
const graphName = `provider-migration-${suffix}`;
const instanceName = `provider-migration-${suffix}`;
const apiGroup = `${graphName}.applik8s.dev`;
const kind = `ProviderMigration${suffix}`;
const providerNodeId = "databaseCluster";
const evidencePath = join(
	process.cwd(),
	".applik8s-tmp/evidence/v0.6/provider-migration.json",
);
const evidenceRunId = randomUUID();
const evidenceStartedAt = new Date().toISOString();

const ProviderMigrationSpec = type({ name: "string", namespace: "string" });
const ProviderMigrationStatus = type({ ready: "boolean" });

const legacyComposition = kubernetesComposition(
	{
		name: graphName,
		apiVersion: `${apiGroup}/v1alpha1`,
		kind,
		spec: ProviderMigrationSpec,
		status: ProviderMigrationStatus,
	},
	(spec) => {
		cluster({
			id: providerNodeId,
			name: spec.name,
			namespace: spec.namespace,
			spec: {
				instances: 1,
				bootstrap: { initdb: { database: "application", owner: "app" } },
				storage: { size: "1Gi" },
			},
		});
		return { ready: true };
	},
);

const retainedComposition = kubernetesComposition(
	{
		name: graphName,
		apiVersion: `${apiGroup}/v1alpha1`,
		kind,
		spec: ProviderMigrationSpec,
		status: ProviderMigrationStatus,
	},
	(spec) => {
		externalRef({
			id: providerNodeId,
			apiVersion: "postgresql.cnpg.io/v1",
			kind: "Cluster",
			metadata: { name: spec.name, namespace: spec.namespace },
		});
		return { ready: true };
	},
);

describeLive("live KRO-to-direct provider ownership migration", () => {
	const kubeConfig = new KubeConfig();
	kubeConfig.loadFromDefault();
	kubeConfig.setCurrentContext(context);
	const legacyFactory = legacyComposition.factory("kro", {
		namespace,
		kubeConfig,
		waitForReady: true,
		timeout: 10 * 60_000,
	});
	const retainedFactory = retainedComposition.factory("kro", {
		namespace,
		kubeConfig,
		waitForReady: true,
		timeout: 10 * 60_000,
	});
	const directFactory = applicationPostgresClusterPreparation.factory(
		"direct",
		{
			namespace,
			kubeConfig,
			waitForReady: true,
			timeout: 10 * 60_000,
		},
	);
	let instanceCreated = false;
	let providerAdopted = false;
	let originalControllerReplicas = 0;

	beforeAll(async () => {
		await discardV06Evidence(evidencePath);
		await assertExpectedKubectlContext();
		await kubectl([
			"get",
			"customresourcedefinition/clusters.postgresql.cnpg.io",
		]);
		const controller = JSON.parse(
			(
				await kubectl([
					"get",
					"deployment/kro",
					"--namespace",
					kroNamespace,
					"--output=json",
				])
			).stdout,
		) as {
			readonly spec?: { readonly replicas?: number };
		};
		originalControllerReplicas = controller.spec?.replicas ?? 1;
		expect(originalControllerReplicas).toBeGreaterThan(0);
	});

	afterAll(async () => {
		const failures: unknown[] = [];
		if (instanceCreated) {
			const owner = providerAdopted ? retainedFactory : legacyFactory;
			await owner
				.deleteInstance(instanceName)
				.catch((cause) => failures.push(cause));
			instanceCreated = false;
		}
		if (providerAdopted) {
			await directFactory
				.deleteInstance(instanceName)
				.catch((cause) => failures.push(cause));
			providerAdopted = false;
		}
		await Promise.all([
			legacyFactory.dispose(),
			retainedFactory.dispose(),
			directFactory.dispose(),
		]).catch((cause) => failures.push(cause));
		if (failures.length > 0)
			throw new AggregateError(
				failures,
				"Provider ownership migration cleanup did not complete through TypeKro.",
			);
	}, 15 * 60_000);

	it(
		"preserves the same database object and data across KRO externalization and TypeKro-first deletion",
		async () => {
			await legacyFactory.deploy({ name: instanceName, namespace });
			instanceCreated = true;
			await kubectl([
				"wait",
				"--for=condition=Ready",
				`cluster.postgresql.cnpg.io/${instanceName}`,
				"--namespace",
				namespace,
				"--timeout=600s",
			]);
			const before = await liveCluster();
			const beforeUid = requiredUid(before);

			await kubectl([
				"exec",
				"--namespace",
				namespace,
				`${instanceName}-1`,
				"--container",
				"postgres",
				"--",
				"psql",
				"--username=postgres",
				"--dbname=postgres",
				"--command",
				"CREATE TABLE IF NOT EXISTS ownership_migration_proof (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO ownership_migration_proof VALUES (1, 'preserved') ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;",
			]);

			const desired = parse(
				retainedFactory.toYaml(),
			) as ApplicationKubernetesObject;
			const runtime = await createKubernetesKroProviderMigrationRuntime({
				context,
				log() {},
				allowLegacyTypeKroNodeFetchHandoff: true,
			});
			const receipt = await migrateApplicationKroOwnedProviderData({
				resourceGraphDefinitionName: graphName,
				desiredResourceGraphDefinition: desired,
				runtime,
			});
			providerAdopted = true;

			const restoredController = JSON.parse(
				(
					await kubectl([
						"get",
						"deployment/kro",
						"--namespace",
						kroNamespace,
						"--output=json",
					])
				).stdout,
			) as {
				readonly metadata?: {
					readonly annotations?: Readonly<Record<string, string>>;
				};
				readonly spec?: { readonly replicas?: number };
				readonly status?: {
					readonly availableReplicas?: number;
					readonly observedGeneration?: number;
				};
			};
			expect(restoredController.spec?.replicas).toBe(
				originalControllerReplicas,
			);
			expect(restoredController.status?.availableReplicas).toBe(
				originalControllerReplicas,
			);
			expect(
				restoredController.metadata?.annotations?.[
					"applik8s.dev/kro-provider-migration-controller"
				],
			).toBeUndefined();

			expect(receipt).toMatchObject({
				state: "completed",
				externalizedNodeIds: [providerNodeId],
				adoptedResources: [{ namespace, name: instanceName, uid: beforeUid }],
			});
			const after = await liveCluster();
			expect(requiredUid(after)).toBe(beforeUid);
			expect(after.metadata?.labels).toMatchObject({
				"typekro.io/managed-by": "typekro",
				"typekro.io/factory-name": "applik8s-postgres-cluster-preparation",
				"typekro.io/instance-name": instanceName,
			});
			expect(after.metadata?.labels?.["kro.run/owned"]).toBeUndefined();
			expect(
				after.metadata?.labels?.["applyset.kubernetes.io/part-of"],
			).toBeUndefined();
			expect(
				(
					await kubectl([
						"exec",
						"--namespace",
						namespace,
						`${instanceName}-1`,
						"--container",
						"postgres",
						"--",
						"psql",
						"--tuples-only",
						"--no-align",
						"--username=postgres",
						"--dbname=postgres",
						"--command",
						"SELECT value FROM ownership_migration_proof WHERE id = 1;",
					])
				).stdout.trim(),
			).toBe("preserved");

			const graph = JSON.parse(
				(
					await kubectl([
						"get",
						`resourcegraphdefinition/${graphName}`,
						"--output=json",
					])
				).stdout,
			) as {
				readonly spec?: {
					readonly resources?: readonly {
						readonly id?: string;
						readonly template?: unknown;
						readonly externalRef?: unknown;
					}[];
				};
			};
			const providerNode = graph.spec?.resources?.find(
				(resource) => resource.id === providerNodeId,
			);
			expect(providerNode?.template).toBeUndefined();
			expect(providerNode?.externalRef).toMatchObject({
				apiVersion: "postgresql.cnpg.io/v1",
				kind: "Cluster",
			});

			await retainedFactory.deleteInstance(instanceName);
			instanceCreated = false;
			await expect(
				kubectl([
					"get",
					`${kind.toLowerCase()}s.${apiGroup}/${instanceName}`,
					"--namespace",
					namespace,
				]),
			).rejects.toThrow();
			expect(requiredUid(await liveCluster())).toBe(beforeUid);
			expect(
				(
					await kubectl([
						"exec",
						"--namespace",
						namespace,
						`${instanceName}-1`,
						"--container",
						"postgres",
						"--",
						"psql",
						"--tuples-only",
						"--no-align",
						"--username=postgres",
						"--dbname=postgres",
						"--command",
						"SELECT value FROM ownership_migration_proof WHERE id = 1;",
					])
				).stdout.trim(),
			).toBe("preserved");

			await directFactory.deleteInstance(instanceName);
			providerAdopted = false;
			await expect(
				kubectl([
					"get",
					`cluster.postgresql.cnpg.io/${instanceName}`,
					"--namespace",
					namespace,
				]),
			).rejects.toThrow();
			await expect(
				kubectl(["get", `resourcegraphdefinition/${graphName}`]),
			).rejects.toThrow();

			const completedAt = new Date().toISOString();
			const assertions = [
				"controller-quiesced-before-ownership-mutation",
				"provider-uid-preserved",
				"provider-data-preserved",
				"provider-externalized",
				"typekro-first-delete-preserves-provider",
				"direct-delete-removes-provider",
				"controller-restored",
			];
			await writeV06EvidenceReceipt(evidencePath, {
				suite: "provider-migration",
				run: { id: evidenceRunId, startedAt: evidenceStartedAt, completedAt },
				candidate: {
					git: await collectV06GitIdentity(),
					cluster: await collectV06ClusterIdentity(context),
				},
				environment: {
					context,
					namespace,
					kroNamespace,
					graphName,
					instanceName,
					originalControllerReplicas,
				},
				assertionEvidence: createV06AssertionEvidence(
					assertions.map((assertion) => ({
						assertion,
						test: "KRO provider ownership migration live lifecycle",
						observedAt: completedAt,
					})),
					evidenceRunId,
				),
			});
		},
		20 * 60_000,
	);

	async function liveCluster(): Promise<ApplicationKubernetesObject> {
		return JSON.parse(
			(
				await kubectl([
					"get",
					`cluster.postgresql.cnpg.io/${instanceName}`,
					"--namespace",
					namespace,
					"--output=json",
				])
			).stdout,
		) as ApplicationKubernetesObject;
	}
});

function requiredUid(resource: ApplicationKubernetesObject): string {
	const uid = resource.metadata?.uid;
	if (!uid) throw new Error("Live Cluster metadata.uid is missing.");
	return uid;
}
