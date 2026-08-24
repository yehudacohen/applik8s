// typecast-file-boundary: this live fixture preserves direct/KRO strategy literals and narrows observation-only Kubernetes JSON before assertions.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApplicationDeploymentGraph,
  applicationRuntimeAccessPlanDigest,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";
import {
  type ApplicationTypeKroCompositionSource,
} from "@applik8s/deployment-typekro";
import {
  applicationAlchemyStackIdentity,
  type ApplicationAlchemyDeployment,
  createApplicationAlchemyGraphDeployment,
} from "@applik8s/deployment-alchemy";
import { type } from "arktype";
import { kubernetesComposition } from "typekro";
import { ConfigMap } from "typekro/simple";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from "../../../scripts/v06-evidence";
import {
  assertExpectedKubectlContext,
  describeLive,
  kubectl,
  sleep,
} from "./live-e2e-helpers.js";

const controlPlaneNamespace =
  process.env.APPLIK8S_E2E_CONTROL_NAMESPACE ?? "typekro-system";
// Persistent clusters routinely reuse process IDs. A run-scoped token keeps
// interrupted historical graphs from being adopted by a later qualification.
const liveRunToken =
  process.env.APPLIK8S_E2E_LIFECYCLE_TOKEN ??
  `${process.pid}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const connectionDigest = digestApplicationDeploymentValue({
  provider: "kubernetes",
  context: process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack",
});
const stateRoots: string[] = [];
const activeDeployments: ApplicationAlchemyDeployment[] = [];
const evidencePath = join(
  process.cwd(),
  ".applik8s-tmp/evidence/v0.7/v07-lifecycle.json",
);
const evidenceRunId = randomUUID();
const evidenceStartedAt = new Date().toISOString();
const completedEvidence = new Map<
  string,
  { readonly test: string; readonly observedAt: string }
>();
let cleanupHealthy = true;

beforeAll(async () => {
  await discardV06Evidence(evidencePath);
});

afterEach(async () => {
  const cleanupErrors: string[] = [];
  for (const deployment of activeDeployments.splice(0).reverse()) {
    try {
      await deployment.destroy();
    } catch (cause) {
      cleanupErrors.push(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  for (const path of stateRoots.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
  if (cleanupErrors.length > 0) {
    cleanupHealthy = false;
    throw new Error(
      `Graph-backed lifecycle cleanup failed:\n${cleanupErrors
        .map((message) => `- ${message}`)
        .join("\n")}`,
    );
  }
});

afterAll(async () => {
  const requiredAssertions = [
    "direct-apply-noop-update-resume-destroy",
    "kro-apply-noop-update-destroy",
    "retained-resource-preserved",
    "retained-resource-drift-recovered",
    "external-resource-preserved",
    "owner-driven-cleanup",
  ] as const;
  if (
    !cleanupHealthy ||
    requiredAssertions.some((assertion) => !completedEvidence.has(assertion))
  ) {
    await discardV06Evidence(evidencePath);
    return;
  }
  const completedAt = new Date().toISOString();
  const [git, cluster] = await Promise.all([
    collectV06GitIdentity(),
    collectV06ClusterIdentity(
      process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack",
    ),
  ]);
  await writeV06EvidenceReceipt(evidencePath, {
    suite: "v07-lifecycle",
    run: {
      id: evidenceRunId,
      startedAt: evidenceStartedAt,
      completedAt,
    },
    candidate: { git, cluster },
    environment: {
      context: cluster.context,
      clusterUid: cluster.uid,
      typekro: "0.33.7",
      strategies: ["direct", "kro"],
    },
    assertionEvidence: createV06AssertionEvidence(
      requiredAssertions.map((assertion) => {
        const evidence = completedEvidence.get(assertion);
        if (!evidence) {
          throw new Error(`Missing lifecycle evidence ${assertion}.`);
        }
        return { assertion, ...evidence };
      }),
      evidenceRunId,
    ),
  });
});

describeLive("v0.7 TypeKro/Alchemy lifecycle", () => {
  for (const strategy of ["direct", "kro"] as const) {
    it(
      `${strategy} applies, no-ops, updates, resumes after failure, and destroys through one graph`,
      async () => {
        await assertExpectedKubectlContext();
        const suffix = `${liveRunToken}-${strategy}`;
        const application = `v07-lifecycle-${suffix}`;
        const namespace = application;
        const instance = "qualification";
        const stateRoot = await mkdtemp(
          join(
            process.env.TMPDIR ?? "/tmp",
            `applik8s-v07-lifecycle-${strategy}-`,
          ),
        );
        stateRoots.push(stateRoot);
        const source = lifecycleSource(application);

        if (strategy === "direct") {
          const invalid = await deployment({
            application,
            namespace,
            instance,
            stateRoot,
            source,
            strategy,
            version: "invalid",
            configName: "INVALID CONFIG NAME",
          });
          await expect(invalid.apply()).rejects.toThrow();
          // Alchemy may have committed the prerequisite Namespace before the
          // root provider failed. The corrected graph must adopt/resume it.
          await expect(kubectl(["get", `namespace/${namespace}`])).resolves.toBeDefined();
        }

        const initial = await deployment({
          application,
          namespace,
          instance,
          stateRoot,
          source,
          strategy,
          version: "v1",
        });
        activeDeployments.push(initial);
        await expect(initial.apply()).resolves.toMatchObject({
          transaction: "applied",
        });
        await expectConfig(namespace, "v1");

        const noOp = await initial.plan();
        expect(noOp.changes.length).toBeGreaterThan(0);
        expect(noOp.changes.every(({ action }) => action === "noop")).toBe(true);
        await expect(initial.apply()).resolves.toMatchObject({
          transaction: "applied",
        });

        const updated = await deployment({
          application,
          namespace,
          instance,
          stateRoot,
          source,
          strategy,
          version: "v2",
        });
        activeDeployments[activeDeployments.length - 1] = updated;
        const updatePlan = await updated.plan();
        expect(
          updatePlan.changes.some(
            ({ action }) => action === "update" || action === "replace",
          ),
        ).toBe(true);
        await expect(updated.apply()).resolves.toMatchObject({
          transaction: "applied",
        });
        await expectConfig(namespace, "v2");

        const destroyStartedAt = Date.now();
        await expect(updated.destroy()).resolves.toMatchObject({
          transaction: "destroyed",
        });
        activeDeployments.pop();
        await waitForAbsent("namespace", namespace, 600_000);
        if (strategy === "kro") {
          await waitForAbsent(
            "resourcegraphdefinition",
            application,
            180_000,
          );
        }
        console.log(
          JSON.stringify({
            evidence: "applik8s-v07-typekro-alchemy-lifecycle",
            strategy,
            namespace,
            graphBackedDestroyToNamespaceAbsentMs:
              Date.now() - destroyStartedAt,
          }),
        );
        completedEvidence.set(
          strategy === "direct"
            ? "direct-apply-noop-update-resume-destroy"
            : "kro-apply-noop-update-destroy",
          {
            test: `${strategy} applies, no-ops, updates, resumes after failure, and destroys through one graph`,
            observedAt: new Date().toISOString(),
          },
        );
      },
      900_000,
    );
  }

  it(
    "preserves retained and externally adopted resources while deleting managed ephemeral resources",
    async () => {
      await assertExpectedKubectlContext();
      const suffix = `${liveRunToken}-ownership`;
      const stateRoot = await mkdtemp(
        join(
          process.env.TMPDIR ?? "/tmp",
          "applik8s-v07-lifecycle-ownership-",
        ),
      );
      stateRoots.push(stateRoot);

      const ephemeralName = `v07-ephemeral-${suffix}`;
      const ephemeral = await secretDeployment({
        application: `v07-ephemeral-${suffix}`,
        stateRoot,
        nodeId: `external.generated-secret.ephemeral.${suffix}`,
        name: ephemeralName,
        deletion: "delete",
      });
      activeDeployments.push(ephemeral);
      await ephemeral.apply();
      await expectSecret(ephemeralName);
      await ephemeral.destroy();
      activeDeployments.pop();
      await waitForAbsent(
        "secret",
        ephemeralName,
        120_000,
        controlPlaneNamespace,
      );

      const retainedName = `v07-retained-${suffix}`;
      const retainedNodeId =
        `external.generated-secret.retained.${suffix}`;
      const retained = await secretDeployment({
        application: `v07-retained-${suffix}`,
        stateRoot,
        nodeId: retainedNodeId,
        name: retainedName,
        deletion: "retain",
      });
      activeDeployments.push(retained);
      await retained.apply();
      await kubectl([
        "delete",
        "secret",
        retainedName,
        "--namespace",
        controlPlaneNamespace,
        "--wait=true",
      ]);
      await waitForAbsent(
        "secret",
        retainedName,
        120_000,
        controlPlaneNamespace,
      );
      const retainedDriftPlan = await retained.plan();
      expect(
        retainedDriftPlan.changes.some(
          ({ action }) => action === "create" || action === "update",
        ),
      ).toBe(true);
      await retained.apply();
      await expectSecret(
        retainedName,
        retainedNodeId,
        secretOwnerId(`v07-retained-${suffix}`),
      );
      await retained.destroy();
      activeDeployments.pop();
      await expectSecret(
        retainedName,
        retainedNodeId,
        secretOwnerId(`v07-retained-${suffix}`),
      );

      // A fresh graph with the same exact ownership identity performs the
      // explicit retained-resource cleanup. Retention never requires kubectl
      // or an out-of-band ownership override.
      const retainedCleanup = await secretDeployment({
        application: `v07-retained-${suffix}`,
        stateRoot,
        nodeId: retainedNodeId,
        name: retainedName,
        deletion: "delete",
      });
      activeDeployments.push(retainedCleanup);
      await retainedCleanup.apply();
      await retainedCleanup.destroy();
      activeDeployments.pop();
      await waitForAbsent(
        "secret",
        retainedName,
        120_000,
        controlPlaneNamespace,
      );

      const externalName = `v07-external-${suffix}`;
      const seedNodeId = `external.generated-secret.seed.${suffix}`;
      const seed = await secretDeployment({
        application: `v07-external-seed-${suffix}`,
        stateRoot,
        nodeId: seedNodeId,
        name: externalName,
        deletion: "delete",
      });
      activeDeployments.push(seed);
      await seed.apply();
      await expectSecret(
        externalName,
        seedNodeId,
        secretOwnerId(`v07-external-seed-${suffix}`),
      );

      const consumer = await secretDeployment({
        application: `v07-external-consumer-${suffix}`,
        stateRoot,
        // Graph-local node ids may repeat across installations. Ownership
        // includes the installation identity, so this remains external.
        nodeId: seedNodeId,
        name: externalName,
        deletion: "delete",
      });
      activeDeployments.push(consumer);
      await consumer.apply();
      await consumer.destroy();
      activeDeployments.pop();
      // The consumer observed external ownership and could not rewrite or
      // delete the seed graph's resource.
      await expectSecret(
        externalName,
        seedNodeId,
        secretOwnerId(`v07-external-seed-${suffix}`),
      );

      await seed.destroy();
      activeDeployments.pop();
      await waitForAbsent(
        "secret",
        externalName,
        120_000,
        controlPlaneNamespace,
      );
      const observedAt = new Date().toISOString();
      completedEvidence.set("retained-resource-preserved", {
        test: "preserves retained and externally adopted resources while deleting managed ephemeral resources",
        observedAt,
      });
      completedEvidence.set("retained-resource-drift-recovered", {
        test: "preserves retained and externally adopted resources while deleting managed ephemeral resources",
        observedAt,
      });
      completedEvidence.set("external-resource-preserved", {
        test: "preserves retained and externally adopted resources while deleting managed ephemeral resources",
        observedAt,
      });
      completedEvidence.set("owner-driven-cleanup", {
        test: "preserves retained and externally adopted resources while deleting managed ephemeral resources",
        observedAt,
      });
    },
    600_000,
  );
});

async function deployment(options: {
  readonly application: string;
  readonly namespace: string;
  readonly instance: string;
  readonly stateRoot: string;
  readonly source: ApplicationTypeKroCompositionSource<
    { readonly name: string; readonly version: string },
    { readonly ready: boolean }
  >;
  readonly strategy: "direct" | "kro";
  readonly version: string;
  readonly configName?: string;
}): Promise<ApplicationAlchemyDeployment> {
  const graph = lifecycleGraph(options);
  return createApplicationAlchemyGraphDeployment({
    graph,
    source: options.source,
    spec: { name: options.instance, version: options.version },
    stateRoot: options.stateRoot,
    stage: "qualification",
    owner: `v07-lifecycle-${liveRunToken}`,
    factory: {
      namespace: controlPlaneNamespace,
      waitForReady: true,
      timeout: 120_000,
    },
  });
}

async function secretDeployment(options: {
  readonly application: string;
  readonly stateRoot: string;
  readonly nodeId: string;
  readonly name: string;
  readonly deletion: "delete" | "retain";
}): Promise<ApplicationAlchemyDeployment> {
  const source = lifecycleSource(options.application);
  try {
    return await createApplicationAlchemyGraphDeployment({
      graph: secretLifecycleGraph(options),
      source,
      spec: { name: "qualification", version: "v1" },
      stateRoot: options.stateRoot,
      stage: "qualification",
      owner: `v07-lifecycle-${liveRunToken}`,
      factory: {
        namespace: controlPlaneNamespace,
        waitForReady: true,
        timeout: 120_000,
      },
    });
  } catch (cause) {
    const context =
      cause && typeof cause === "object" ? Reflect.get(cause, "context") : undefined;
    throw new Error(
      `Secret lifecycle deployment ${options.application} could not be assembled${context ? `: ${JSON.stringify(context)}` : "."}`,
      { cause },
    );
  }
}

function lifecycleSource(
  application: string,
): ApplicationTypeKroCompositionSource<
  { readonly name: string; readonly version: string },
  { readonly ready: boolean }
> {
  const definition = {
    name: application,
    apiVersion: "qualification.applik8s.dev/v1alpha1",
    kind: `V07Lifecycle${digestApplicationDeploymentValue(application)
      .slice("sha256:".length, "sha256:".length + 16)}`,
    spec: type({ name: "string", version: "string" }),
    status: type({ ready: "boolean" }),
  };
  const source = kubernetesComposition(definition, () => {
    const witness = ConfigMap({
      id: "lifecycleWitness",
      name: `${application}-witness`,
      namespace: controlPlaneNamespace,
      data: { application },
    });
    return { ready: witness.metadata.name === `${application}-witness` };
  });
  Object.defineProperty(source, "__applik8sTypeKroDefinition", {
    value: definition,
    enumerable: false,
  });
  return source;
}

function lifecycleGraph(options: {
  readonly application: string;
  readonly namespace: string;
  readonly instance: string;
  readonly strategy: "direct" | "kro";
  readonly version: string;
  readonly configName?: string;
}): ApplicationDeploymentGraph {
  const configuration = {
    name: options.instance,
    version: options.version,
    configName: options.configName ?? `${options.application}-config`,
  };
  const sourceGraphDigest = digestApplicationDeploymentValue(configuration);
  return {
    apiVersion: "applik8s.deploymentGraph/v1alpha1",
    kind: "ApplicationDeploymentGraph",
    metadata: {
      identity: {
        connection: {
          provider: "kubernetes",
          cluster: process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack",
          digest: connectionDigest,
        },
        application: options.application,
        controlPlaneNamespace,
        instance: options.instance,
        profile: "qualification",
      },
      mode: "fresh",
      strategy: options.strategy,
      sourceGraphDigest,
      compilerVersion: "v0.7-lifecycle-qualification",
    },
    runtimeAccess: emptyRuntimeAccessPlan(options.application, sourceGraphDigest),
    nodes: [
      {
        id: "direct.namespace.workload",
        kind: "kubernetesDirect",
        contractVersion: 1,
        source: {},
        provider: {
          interface: "Namespace",
          implementation: "typekro-kubernetes",
          version: "1",
        },
        scope: { connectionDigest },
        capabilities: { strategies: ["direct"], alchemy: true },
        configurationDigest: digestApplicationDeploymentValue({
          name: options.namespace,
        }),
        inputs: {},
        outputs: [
          {
            name: "reference",
            type: "resourceReference",
            sensitivity: "public",
            persistence: "state",
          },
        ],
        lifecycle: {
          ownership: "application",
          deletion: "delete",
          adoption: "createOrAdoptExact",
        },
        spec: {
          compositionId: "applik8s-namespace",
          reason: "Own the isolated lifecycle qualification namespace.",
          configuration: { name: options.namespace },
        },
      },
      {
        id: "kubernetes.application",
        kind: "kubernetesComposition",
        contractVersion: 1,
        source: {},
        provider: {
          interface: "KubernetesApplication",
          implementation: "typekro",
          version: "1",
        },
        scope: {
          connectionDigest,
          namespace: controlPlaneNamespace,
        },
        capabilities: { strategies: ["direct", "kro"], alchemy: true },
        configurationDigest:
          digestApplicationDeploymentValue(configuration),
        inputs: {},
        outputs: [
          {
            name: "status",
            type: "json",
            sensitivity: "public",
            persistence: "state",
          },
        ],
        lifecycle: {
          ownership: "application",
          deletion: "delete",
          adoption: "createOrAdoptExact",
        },
        spec: {
          compositionId: options.application,
          fragmentIds: [],
          installationSpec: {
            name: options.instance,
            version: options.version,
          },
          materialized: {
            resources: [
              {
                id: "qualificationConfig",
                template: {
                  apiVersion: "v1",
                  kind: "ConfigMap",
                  metadata: {
                    name:
                      options.configName ??
                      `${options.application}-config`,
                    namespace: options.namespace,
                  },
                  data: { version: options.version },
                },
              },
            ],
            status: { ready: true },
          },
        },
      },
    ],
    edges: [
      {
        from: "direct.namespace.workload",
        to: "kubernetes.application",
        relationship: "requiresReady",
      },
    ],
  };
}

function secretLifecycleGraph(options: {
  readonly application: string;
  readonly nodeId: string;
  readonly name: string;
  readonly deletion: "delete" | "retain";
}): ApplicationDeploymentGraph {
  const rootConfiguration = {
    name: "qualification",
    version: "v1",
  };
  const sourceGraphDigest = digestApplicationDeploymentValue({
    ...rootConfiguration,
    nodeId: options.nodeId,
    name: options.name,
    deletion: options.deletion,
  });
  return {
    apiVersion: "applik8s.deploymentGraph/v1alpha1",
    kind: "ApplicationDeploymentGraph",
    metadata: {
      identity: {
        connection: {
          provider: "kubernetes",
          cluster: process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack",
          digest: connectionDigest,
        },
        application: options.application,
        controlPlaneNamespace,
        instance: "qualification",
        profile: "qualification",
      },
      mode: "fresh",
      strategy: "direct",
      sourceGraphDigest,
      compilerVersion: "v0.7-lifecycle-qualification",
    },
    runtimeAccess: emptyRuntimeAccessPlan(options.application, sourceGraphDigest),
    nodes: [
      {
        id: options.nodeId,
        kind: "externalProvider",
        contractVersion: 1,
        source: {},
        provider: {
          interface: "Secret",
          implementation: "alchemy-kubernetes-generated-secret",
          version: "1",
        },
        scope: {
          connectionDigest,
          namespace: controlPlaneNamespace,
        },
        capabilities: { strategies: ["direct"], alchemy: true },
        configurationDigest: digestApplicationDeploymentValue({
          namespace: controlPlaneNamespace,
          name: options.name,
          deletion: options.deletion,
        }),
        inputs: {},
        outputs: [
          {
            name: "reference",
            type: "secretReference",
            sensitivity: "public",
            persistence: "reference",
          },
          {
            name: "name",
            type: "string",
            sensitivity: "public",
            persistence: "reference",
          },
          {
            name: "namespace",
            type: "string",
            sensitivity: "public",
            persistence: "reference",
          },
        ],
        lifecycle: {
          ownership: "application",
          deletion: options.deletion,
          adoption: "createOrAdoptExact",
        },
        spec: {
          resourceType: "kubernetesGeneratedSecret",
          controller: "alchemy-kubernetes",
          configuration: {
            namespace: controlPlaneNamespace,
            name: options.name,
            values: {
              value: {
                kind: "random",
                bytes: 32,
                encoding: "base64url",
              },
            },
            consumers: ["v0.7-lifecycle-qualification"],
          },
        },
      },
      {
        id: "kubernetes.application",
        kind: "kubernetesComposition",
        contractVersion: 1,
        source: {},
        provider: {
          interface: "KubernetesApplication",
          implementation: "typekro",
          version: "1",
        },
        scope: {
          connectionDigest,
          namespace: controlPlaneNamespace,
        },
        capabilities: { strategies: ["direct"], alchemy: true },
        configurationDigest:
          digestApplicationDeploymentValue(rootConfiguration),
        inputs: {},
        outputs: [
          {
            name: "status",
            type: "json",
            sensitivity: "public",
            persistence: "state",
          },
        ],
        lifecycle: {
          ownership: "application",
          deletion: "delete",
          adoption: "createOrAdoptExact",
        },
        spec: {
          compositionId: options.application,
          fragmentIds: [],
          installationSpec: rootConfiguration,
          materialized: {
            resources: [
              {
                id: "lifecycleWitness",
                template: {
                  apiVersion: "v1",
                  kind: "ConfigMap",
                  metadata: {
                    name: `${options.name}-witness`,
                    namespace: controlPlaneNamespace,
                  },
                  data: {
                    application: options.application,
                    // The witness consumes the generated Secret reference so
                    // the portable requiresOutput edge is exercised.
                    secret: options.name,
                  },
                },
              },
            ],
            status: { ready: "${true}" },
          },
        },
      },
    ],
    edges: [
      {
        from: options.nodeId,
        to: "kubernetes.application",
        relationship: "requiresOutput",
        output: "name",
      },
    ],
  };
}

function emptyRuntimeAccessPlan(
  application: string,
  sourceGraphDigest: string,
): ApplicationDeploymentGraph['runtimeAccess'] {
  if (!/^sha256:[a-f0-9]{64}$/u.test(sourceGraphDigest)) {
    throw new Error('Lifecycle fixture source graph digest is invalid.');
  }
  const content = {
    apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
    application,
    target: 'kubernetes' as const,
    sourceGraphDigest: sourceGraphDigest as `sha256:${string}`,
    executions: [],
    workloads: [],
    diagnostics: [],
  };
  return { ...content, digest: applicationRuntimeAccessPlanDigest(content) };
}

async function expectConfig(namespace: string, version: string): Promise<void> {
  const result = await kubectl([
    "get",
    "configmap",
    "--namespace",
    namespace,
    "--selector",
    "",
    "--output",
    "json",
  ]);
  const body = JSON.parse(result.stdout) as {
    readonly items?: readonly {
      readonly metadata?: { readonly name?: string };
      readonly data?: { readonly version?: string };
    }[];
  };
  expect(body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ version }),
      }),
    ]),
  );
}

async function expectSecret(
  name: string,
  deploymentNodeId?: string,
  deploymentOwnerId?: string,
): Promise<void> {
  const args = [
    "get",
    `secret/${name}`,
    "--namespace",
    controlPlaneNamespace,
    "--output",
    "json",
  ];
  const result = await kubectl(args);
  const secret = JSON.parse(result.stdout) as {
    readonly metadata?: {
      readonly annotations?: Readonly<Record<string, string>>;
    };
  };
  if (deploymentNodeId) {
    expect(
      secret.metadata?.annotations?.["applik8s.dev/deployment-node"],
    ).toBe(deploymentNodeId);
  }
  if (deploymentOwnerId) {
    expect(
      secret.metadata?.annotations?.["applik8s.dev/deployment-owner"],
    ).toBe(deploymentOwnerId);
  }
}

function secretOwnerId(application: string): string {
  return applicationAlchemyStackIdentity(
    {
      connection: {
        provider: "kubernetes",
        cluster: process.env.APPLIK8S_E2E_CONTEXT ?? "orbstack",
        digest: connectionDigest,
      },
      application,
      controlPlaneNamespace,
      instance: "qualification",
      profile: "qualification",
    },
    "direct",
  ).digest;
}

async function waitForAbsent(
  kind: string,
  name: string,
  timeoutMs: number,
  namespace?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const result = await kubectl([
      "get",
      `${kind}/${name}`,
      ...(namespace ? ["--namespace", namespace] : []),
      "--ignore-not-found",
      "--output",
      "name",
    ]);
    last = result.stdout.trim();
    if (!last) return;
    await sleep(2_000);
  }
  throw new Error(
    `${kind}/${name} still exists after graph-backed destruction: ${last}`,
  );
}
