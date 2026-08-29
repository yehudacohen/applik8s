// typecast-file-boundary: Test fixtures preserve literal discriminants while exercising the public portable compiler and plan contracts.
import {
  type ApplicationGraph,
  type ApplicationScheduleNode,
  applicationCanonicalIdentity,
  applicationProviderIdentity,
  diffApplicationPlans,
  renderApplicationPlanGraph,
  renderApplicationPlanText,
  serializeApplicationPlan,
  serializeApplicationPlanContent,
  validateApplicationPlan,
} from "@applik8s/core";
import {
  type DeploymentJsonObject,
  digestApplicationDeploymentGraph,
  validateApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import { describe, expect, it } from "vitest";

import {
  type ApplicationDeploymentContributor,
  clickStackCredentialsSecretName,
  compileApplicationDeploymentGraph,
  compileApplicationPlan,
} from "../src/index.js";

const sourceGraphDigest = `sha256:${"a".repeat(64)}`;
const connectionDigest = `sha256:${"b".repeat(64)}`;

describe("Application deployment compiler", () => {
  it('omits unavailable target-selected lakehouse execution and its generated cursor Secret', () => {
    const providerId = 'provider.lakehouse-dataset.v1alpha1.history';
    const publicationId = 'lakehouse-publication.usage.v1.history';
    const graph = {
      ...applicationGraph(),
      nodes: [
        {
          id: providerId,
          kind: 'provider',
          name: 'LakehouseDataset',
          stability: 'stable',
          interface: 'LakehouseDataset',
          implementation: 'application-target-provider-selection',
          config: {
            qualification: { name: 'history', compatibilityRevision: 'v1alpha1' },
            targetSelection: { targets: {
              local: { implementation: 'duckdb-dataset', configuration: { kind: 'duckdb-dataset', root: '.applik8s/history' } },
              kubernetes: {
                implementation: 'qualified-lakehouse-provider-required',
                configuration: { kind: 'qualified-lakehouse-provider-required', reason: 'Install a qualified Kubernetes lakehouse.' },
              },
            } },
          },
        },
        {
          id: publicationId,
          kind: 'lakehousePublication',
          name: 'usage.v1:history',
          stability: 'experimental',
          sourceEventId: 'usage.v1',
          sourceContract: { name: 'usage', version: 'v1' },
          source: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
          row: { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object' } },
          transform: { source: '(event, output) => output.append(event)' },
          dataset: { nodeId: providerId, interface: 'LakehouseDataset' },
          eventLog: { nodeId: 'provider.event-log', interface: 'EventLog' },
          semantics: { frontier: 'sourceEvent', publication: 'atomicManifest', schemaEvolution: 'explicitRevision' },
        },
      ],
      edges: [{ from: { nodeId: publicationId }, to: { nodeId: providerId }, relationship: 'dependsOn' }],
      providerRequirements: [{
        id: `requirement.${publicationId}.dataset`,
        consumer: { nodeId: publicationId },
        interface: 'LakehouseDataset',
        purpose: 'lakehouseDataset',
        required: true,
        provider: { nodeId: providerId, interface: 'LakehouseDataset' },
        diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
      }],
      providerBindings: [],
    } as ApplicationGraph;
    const compiled = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      artifacts: [],
      generatedSecrets: [{
        id: 'lakehouse.cursor',
        namespace: 'guestbook',
        name: 'guestbook-lakehouse-cursor',
        values: { key: { kind: 'random', bytes: 48, encoding: 'base64url' } },
        consumers: [publicationId],
      }],
    });

    expect(compiled.runtimeAccess.executions).toEqual([]);
    expect(compiled.runtimeAccess.diagnostics).toEqual([]);
    expect(compiled.graph.nodes.some((node) => node.id === 'external.generated-secret.lakehouse.cursor')).toBe(false);
  });

  it('does not mistake a schedule-admission CronJob for the scheduled closure workload', () => {
    const scheduleId = 'schedule.source.poll.v1';
    const graph = scheduleManagingGraph();
    const withProcessor = runtimeWorkloadRequest(
      { ...request(), graph },
      'schedule-proof-processor',
      ['streamProcessor.reconcile-source-polling'],
    );
    const withScheduleControl = runtimeWorkloadRequest(
      withProcessor,
      'schedule-proof-schedule-control',
      [scheduleId],
    );
    const image = 'applik8s/schedule-proof-schedule-control:source';
    const compiled = compileApplicationDeploymentGraph({
      ...withScheduleControl,
      materializedComposition: {
        resources: [
          ...withProcessor.materializedComposition.resources,
          ...withScheduleControl.materializedComposition.resources,
          {
            apiVersion: 'batch/v1',
            kind: 'CronJob',
            metadata: {
              name: 'schedule-source-poll-v1',
              namespace: 'schedule-proof',
              labels: { 'app.kubernetes.io/component': 'schedule' },
            },
            spec: {
              jobTemplate: {
                spec: {
                  template: {
                    metadata: { labels: { 'app.kubernetes.io/component': 'schedule' } },
                    spec: { containers: [{ name: 'schedule-admission', image }] },
                  },
                },
              },
            },
          },
        ],
        status: {},
      },
    });

    const scheduleExecution = compiled.runtimeAccess.executions.find(({ nodeId }) => nodeId === scheduleId);
    expect(scheduleExecution).toBeDefined();
    expect(compiled.runtimeAccess.workloads.filter(({ executionIdentities }) =>
      executionIdentities.includes(scheduleExecution!.executionIdentity)))
      .toEqual([
        expect.objectContaining({
          workloadIdentity: 'apps/v1:Deployment:guestbook:schedule-proof-schedule-control',
        }),
      ]);
    expect(compiled.runtimeAccess.workloads.some(({ workloadIdentity }) =>
      workloadIdentity.includes(':CronJob:'))).toBe(false);
  });

  it('binds function-native schedule management to the generated private control Service', () => {
    const withProcessor = runtimeWorkloadRequest(
      request(),
      'schedule-proof-processor',
      ['streamProcessor.reconcile-source-polling'],
    );
    const withScheduleRunner = runtimeWorkloadRequest(
      withProcessor,
      'schedule-proof-schedule-runner',
      ['schedule.source.poll.v1'],
    );
    const compiled = compileApplicationDeploymentGraph({
      ...withScheduleRunner,
      graph: scheduleManagingGraph(),
      materializedComposition: {
        resources: [
          ...withProcessor.materializedComposition.resources,
          ...withScheduleRunner.materializedComposition.resources,
        ],
        status: {},
      },
    });
    const execution = compiled.runtimeAccess.executions.find(
      ({ nodeId }) => nodeId === 'streamProcessor.reconcile-source-polling',
    );
    expect(execution?.kubernetes?.privatePeers).toEqual([
      expect.objectContaining({
        capabilityId: 'framework.schedule-control.schedule-proof',
        protocol: 'TCP',
        port: 8080,
        endpoint: {
          target: 'kubernetes',
          namespace: 'schedule-proof',
          serviceName: 'schedule-proof-schedule-control',
          podSelector: {
            'app.kubernetes.io/name': 'schedule-proof-schedule-control',
            'app.kubernetes.io/component': 'schedule-control',
            'applik8s.dev/graph': 'schedule-proof',
          },
        },
      }),
    ]);
    expect(execution?.lowerings).toContainEqual(expect.objectContaining({
      operation: 'network.connect',
      capabilityId: 'framework.schedule-control.schedule-proof',
      fidelity: 'exact',
      mechanisms: ['kubernetes-network'],
    }));
  });

  it("lowers artifacts, providers, and the root composition deterministically", () => {
    const first = compileApplicationDeploymentGraph(request());
    const second = compileApplicationDeploymentGraph({
      ...request(),
      artifacts: [...request().artifacts].reverse(),
    });
    expect(validateApplicationDeploymentGraph(first.graph).valid).toBe(true);
    expect(digestApplicationDeploymentGraph(first.graph)).toBe(
      digestApplicationDeploymentGraph(second.graph),
    );
    expect(first.graph.nodes.map(({ id }) => id)).toEqual([
      "artifact.web",
      "direct.namespace.control-plane",
      "direct.namespace.workload",
      "kubernetes.application",
    ]);
    expect(first.graph.edges).toEqual(
      expect.arrayContaining([
        {
          from: "artifact.web",
          to: "kubernetes.application",
          relationship: "requiresOutput",
          output: "immutableReference",
        },
        {
          from: "direct.namespace.workload",
          to: "kubernetes.application",
          relationship: "requiresReady",
        },
        {
          from: "direct.namespace.control-plane",
          to: "kubernetes.application",
          relationship: "requiresReady",
        },
      ]),
    );
    expect(
      first.graph.nodes.find(
        (node) => node.id === "direct.namespace.control-plane",
      )?.lifecycle,
    ).toMatchObject({
      ownership: "application",
      deletion: "retain",
      adoption: "createOrAdoptExact",
    });
  });

  it("never creates Kubernetes protected control-plane or workload namespaces", () => {
    const result = compileApplicationDeploymentGraph({
      ...request(),
      identity: {
        ...request().identity,
        controlPlaneNamespace: "default",
      },
      graph: {
        ...request().graph,
        metadata: {
          ...request().graph.metadata,
          namespace: "default",
        },
      },
    });

    expect(
      result.graph.nodes.filter(
        (node) =>
          node.kind === "kubernetesDirect"
          && node.spec.compositionId === "applik8s-namespace",
      ),
    ).toEqual([]);
  });

  it("treats the External workload namespace as a pre-existing lifecycle boundary", () => {
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...request().graph,
        metadata: {
          ...request().graph.metadata,
          namespace: "external-workload",
        },
      },
      identity: {
        ...request().identity,
        instance: "external-guestbook",
        profile: "external",
      },
      installationSpec: {
        name: "external-guestbook",
        profile: "external",
      },
      generatedSecrets: [
        {
          id: "external-guestbook.runtime",
          namespace: "external-workload",
          name: "external-guestbook-runtime",
          values: {
            key: {
              kind: "random",
              bytes: 48,
              encoding: "base64url",
            },
          },
          consumers: ["external-guestbook"],
        },
      ],
    });

    expect(
      result.graph.nodes.filter(
        (node) =>
          node.kind === "kubernetesDirect"
          && node.spec.compositionId === "applik8s-namespace",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "direct.namespace.control-plane",
        lifecycle: expect.objectContaining({ deletion: "retain" }),
        spec: expect.objectContaining({
          configuration: { name: "applik8s-system" },
        }),
      }),
    ]);
    expect(
      result.graph.nodes.find(
        (node) =>
          node.id ===
          "external.generated-secret.external-guestbook.runtime",
      ),
    ).toMatchObject({
      scope: { namespace: "external-workload" },
      lifecycle: {
        ownership: "application",
        deletion: "delete",
      },
    });
    expect(
      result.graph.edges.some(
        (edge) => edge.from === "direct.namespace.workload",
      ),
    ).toBe(false);
  });

  it("keeps generated Hatchet credentials out of the artifact surface", () => {
    const base = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...runtimeWorkloadRequest(request(), 'schedule-control', ['schedule.source.poll.v1']),
      graph: {
        ...base,
        nodes: [
          ...base.nodes,
          {
            id: "provider.workflow-engine",
            kind: "provider",
            name: "WorkflowEngine",
            stability: "stable",
            interface: "WorkflowEngine",
            implementation: "hatchet",
            config: {
              kind: "hatchet",
              name: "guestbook-workflows",
              namespace: "guestbook",
              provision: true,
              apiUrl:
                "http://guestbook-workflows-api.guestbook.svc:8080",
            },
          },
        ],
      },
    });
    const secret = result.graph.nodes.find(
      (node) =>
        node.id === "external.provider.workflow-engine.admin-secret",
    );
    const databaseSecret = result.graph.nodes.find(
      (node) =>
        node.id === "external.provider.workflow-engine.database-secret",
    );

    expect(secret).toMatchObject({
      kind: "externalProvider",
      spec: {
        resourceType: "kubernetesGeneratedSecret",
        referenceMode: "staticIdentity",
      },
    });
    expect(result.graph.edges).toContainEqual({
      from: secret?.id,
      to: "direct.provider.workflow-engine.hatchet",
      relationship: "requiresReady",
    });
    expect(result.graph.edges).not.toContainEqual({
      from: secret?.id,
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "name",
    });
    expect(databaseSecret).toMatchObject({
      kind: "externalProvider",
      spec: {
        resourceType: "kubernetesGeneratedSecret",
        referenceMode: "staticIdentity",
        configuration: {
          name: "guestbook-workflows-database",
          secretType: "kubernetes.io/basic-auth",
          values: {
            username: {
              kind: "publicLiteral",
              value: "hatchet",
            },
            password: {
              kind: "random",
              encoding: "base64url",
            },
            DATABASE_URL: {
              kind: "template",
            },
          },
        },
      },
    });
    expect(result.graph.edges).toContainEqual({
      from: databaseSecret?.id,
      to: "direct.provider.workflow-engine.database",
      relationship: "requiresReady",
    });
    expect(result.graph.edges).not.toContainEqual({
      from: databaseSecret?.id,
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "name",
    });
    expect(
      result.graph.nodes.find(
        (node) => node.id === "direct.provider.workflow-engine.database",
      ),
    ).toMatchObject({
      kind: "kubernetesDirect",
      spec: {
        compositionId: "applik8s-postgres-cluster-provider",
        configuration: {
          name: "guestbook-workflows-db",
          namespace: "guestbook",
          spec: {
            bootstrap: {
              initdb: {
                database: "hatchet",
                owner: "hatchet",
                secret: { name: "guestbook-workflows-database" },
              },
            },
          },
        },
      },
    });
    expect(
      result.graph.nodes.find(
        (node) => node.id === "direct.provider.workflow-engine.hatchet",
      ),
    ).toMatchObject({
      kind: "kubernetesDirect",
      spec: {
        compositionId: "hatchet-installation",
        configuration: {
          name: "guestbook-workflows",
          namespace: "guestbook",
          namespaceOwnership: "external",
          repositoryNamespaceOwnership: "external",
          database: {
            connectionSecret: {
              name: "guestbook-workflows-database",
            },
          },
          adminCredentialsSecret: {
            name: "guestbook-workflows-admin",
          },
          values: {
            api: {
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "1", memory: "512Mi" },
              },
            },
            engine: {
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "1", memory: "512Mi" },
              },
            },
            frontend: {
              resources: {
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "500m", memory: "256Mi" },
              },
            },
          },
        },
      },
    });
  });

  it("lowers a qualified Hatchet Scheduler to one owned shared-provider installation", () => {
    const base = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...runtimeWorkloadRequest(request(), 'schedule-control', ['schedule.source.poll.v1']),
      graph: {
        ...base,
        nodes: [
          ...base.nodes,
          {
            id: "provider.scheduler.v1alpha1.source-polling",
            kind: "provider",
            name: "Scheduler",
            stability: "stable",
            interface: "Scheduler",
            implementation: "hatchet-scheduler",
            config: {
              qualification: {
                capability: "Scheduler",
                name: "source-polling",
                compatibilityRevision: "v1alpha1",
              },
              scheduler: {
                kind: "hatchet-scheduler",
                workflowEngine: {
                  kind: "hatchet",
                  name: "guestbook-scheduler",
                  namespace: "guestbook",
                  provision: true,
                },
              },
            },
          },
          scheduleNode("provider.scheduler.v1alpha1.source-polling"),
        ],
      },
    });
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "direct.provider.scheduler.v1alpha1.source-polling.hatchet",
        kind: "kubernetesDirect",
        spec: expect.objectContaining({
          compositionId: "hatchet-installation",
          configuration: expect.objectContaining({
            name: "guestbook-scheduler",
            namespace: "guestbook",
          }),
        }),
      }),
    ]));
  });

  it("reuses the shared Hatchet WorkflowEngine when a Scheduler has no private engine", () => {
    const base = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...runtimeWorkloadRequest(request(), 'schedule-control', ['schedule.source.poll.v1']),
      graph: {
        ...base,
        nodes: [
          ...base.nodes,
          {
            id: "provider.workflow-engine",
            kind: "provider",
            name: "WorkflowEngine",
            stability: "stable",
            interface: "WorkflowEngine",
            implementation: "hatchet",
            config: { kind: "hatchet", name: "shared-hatchet", namespace: "guestbook" },
          },
          {
            id: "provider.scheduler.v1alpha1.source-polling",
            kind: "provider",
            name: "Scheduler",
            stability: "stable",
            interface: "Scheduler",
            implementation: "hatchet-scheduler",
            config: {
              qualification: {
                capability: "Scheduler",
                name: "source-polling",
                compatibilityRevision: "v1alpha1",
              },
              scheduler: { kind: "hatchet-scheduler" },
            },
          },
          scheduleNode("provider.scheduler.v1alpha1.source-polling"),
        ],
      },
    });
    expect(result.graph.nodes.filter((node) =>
      node.kind === "kubernetesDirect"
      && node.spec.compositionId === "hatchet-installation"))
      .toHaveLength(1);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "direct.provider.workflow-engine.hatchet" }),
    ]));
  });

  it("lowers compiler-owned CRDs into retained API prerequisites before the application", () => {
    const manifest = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "entries.example.test" },
      spec: {
        group: "example.test",
        scope: "Namespaced",
        names: {
          plural: "entries",
          singular: "entry",
          kind: "Entry",
        },
        versions: [
          {
            name: "v1alpha1",
            served: true,
            storage: true,
            schema: {
              openAPIV3Schema: {
                type: "object",
              },
            },
          },
        ],
      },
    } as const;
    const result = compileApplicationDeploymentGraph({
      ...request(),
      clusterApiPrerequisites: [manifest],
    });
    const crd = result.graph.nodes.find(
      (node) =>
        node.kind === "kubernetesDirect" &&
        node.spec.compositionId === "applik8s-custom-resource-definition",
    );

    expect(crd).toMatchObject({
      provider: {
        interface: "CustomResourceDefinition",
        implementation: "typekro-kubernetes",
      },
      lifecycle: {
        ownership: "shared",
        deletion: "retain",
        adoption: "createOrAdoptExact",
      },
      spec: {
        configuration: {
          name: "entries.example.test",
          manifest,
        },
      },
    });
    expect(result.graph.edges).toContainEqual({
      from: crd?.id,
      to: "kubernetes.application",
      relationship: "installsApi",
    });
  });

  it("carries the reviewed profile transition into the portable plan identity", () => {
    const profileTransition = {
      apiVersion: "applik8s.profileTransitionPlan/v1alpha1",
      installation: { namespace: "applik8s-system", name: "guestbook" },
      mode: "transition",
      entries: [
        {
          qualification: "TransactionalDatabase@v1alpha1:primary",
          from: "starter",
          to: "dedicated",
          kind: "replicate-cutover",
        },
      ],
      acknowledgements: [],
    } as const;
    const result = compileApplicationDeploymentGraph({
      ...request(),
      profileTransition,
    });
    expect(result.graph.metadata.profileTransition).toEqual(
      profileTransition,
    );
    expect(validateApplicationDeploymentGraph(result.graph).valid).toBe(true);
  });

  it("uses one exact contributor registration without executing effects", () => {
    let invocations = 0;
    const contributor: ApplicationDeploymentContributor = {
      interface: "TransactionalDatabase",
      implementation: "postgres",
      version: 1,
      contribute(provider, context) {
        invocations += 1;
        return {
          nodes: [],
          edges: [],
          compositionFragments: [
            {
              id: "provider:transactional-database",
              sourceNodeId: provider.id,
              providerInterface: provider.interface,
              providerImplementation: provider.implementation,
              profile: context.profile,
            },
          ],
        };
      },
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      contributors: [contributor],
    });
    expect(invocations).toBe(1);
    expect(result.contributorKeys).toEqual(["TransactionalDatabase\u0000postgres@1"]);
    expect(
      result.graph.nodes.find(({ id }) => id === "kubernetes.application")?.spec,
    ).toMatchObject({
      fragments: [
        {
          id: "provider:transactional-database",
          sourceNodeId: "provider.transactional-database",
          profile: "local",
        },
      ],
    });
  });

  it("lowers generated credentials as public references consumed through an output edge", () => {
    const result = compileApplicationDeploymentGraph({
      ...request(),
      generatedSecrets: [
        {
          id: "gateway.guestbook.cursor",
          namespace: "guestbook",
          name: "guestbook-cursor",
          values: {
            key: {
              kind: "random",
              bytes: 48,
              encoding: "base64url",
            },
          },
          consumers: ["gateway.guestbook"],
        },
      ],
    });
    const secret = result.graph.nodes.find(
      ({ id }) =>
        id ===
        "external.generated-secret.gateway.guestbook.cursor",
    );
    expect(secret?.outputs.map(({ name }) => name)).toEqual([
      "reference",
      "name",
      "namespace",
    ]);
    expect(result.graph.edges).toContainEqual({
      from: "external.generated-secret.gateway.guestbook.cursor",
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "name",
    });
    expect(secret?.spec.configuration).toMatchObject({
      values: {
        key: { kind: "random", bytes: 48, encoding: "base64url" },
      },
    });
  });

  it("retains an explicit static-identity Secret without inventing runtime access", () => {
    const result = compileApplicationDeploymentGraph({
      ...request(),
      generatedSecrets: [{
        id: "runtime.probe",
        namespace: "guestbook",
        name: "guestbook-runtime-probe",
        values: {
          allowed: { kind: "random", bytes: 32, encoding: "base64url" },
          sibling: { kind: "random", bytes: 32, encoding: "base64url" },
        },
        consumers: [],
        referenceMode: "staticIdentity",
      }],
    });

    expect(result.graph.nodes).toContainEqual(expect.objectContaining({
      id: "external.generated-secret.runtime.probe",
      spec: expect.objectContaining({ referenceMode: "staticIdentity" }),
    }));
    expect(result.graph.edges).toContainEqual({
      from: "external.generated-secret.runtime.probe",
      to: "kubernetes.application",
      relationship: "requiresReady",
    });
    expect(result.runtimeAccess.executions.flatMap((execution) =>
      execution.kubernetes?.credentialProjections ?? []).some((projection) =>
      projection.resourceId === "v1/Secret/guestbook/guestbook-runtime-probe"))
      .toBe(false);
  });

  it("gives workflow model operations the application context authority instead of a gateway cursor", () => {
    const base = applicationGraph();
    const graph = {
      ...base,
      metadata: { ...base.metadata, namespace: "guestbook" },
      nodes: [
        ...base.nodes,
        {
          id: "task-handler.update-document",
          kind: "taskHandler",
          name: "update-document",
          stability: "stable",
          operations: [{ alias: "Document.update" }],
        },
        {
          id: "workflow-worker.guestbook-workflows",
          kind: "workflowWorker",
          name: "guestbook-workflows",
          stability: "stable",
          handlers: [{ nodeId: "task-handler.update-document" }],
        },
      ],
    } as unknown as ApplicationGraph;

    const result = compileApplicationDeploymentGraph({
      ...runtimeWorkloadRequest(request(), 'guestbook-workflows', [
        'workflow-worker.guestbook-workflows',
        'task-handler.update-document',
      ], [{
        name: "APPLIK8S_APPLICATION_CONTEXT_KEY",
        valueFrom: {
          secretKeyRef: { name: "guestbook-context", key: "key" },
        },
      }]),
      graph,
    });
    const context = result.graph.nodes.find(
      ({ id }) => id === "external.generated-secret.application.context",
    );
    expect(context).toMatchObject({
      scope: { namespace: "guestbook" },
      spec: {
        configuration: {
          name: "guestbook-context",
          values: {
            key: { kind: "random", bytes: 48, encoding: "base64url" },
          },
        },
      },
    });
    expect(result.graph.edges).toContainEqual({
      from: "external.generated-secret.application.context",
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "name",
    });
  });

  it("does not grant the forwarding application gateway HTTP context authority", () => {
    const base = applicationGraph();
    const graph = {
      ...base,
      metadata: { ...base.metadata, namespace: "guestbook" },
      nodes: [
        ...base.nodes,
        {
          id: "gateway.web",
          kind: "gateway",
          name: "web",
          stability: "stable",
          visibility: "public",
          materialization: "generatedDeployment",
          queries: [],
          commands: [],
          subscriptions: [],
        },
      ],
    } as unknown as ApplicationGraph;

    const result = compileApplicationDeploymentGraph({ ...request(), graph });
    expect(result.graph.nodes.find(
      ({ id }) => id === "external.generated-secret.application.context",
    )).toBeUndefined();
    expect(JSON.stringify(result.runtimeAccess)).not.toContain("guestbook-context");
  });

  it("rejects duplicate contributor identities", () => {
    const contributor: ApplicationDeploymentContributor = {
      interface: "TransactionalDatabase",
      implementation: "postgres",
      version: 1,
      contribute: () => ({
        nodes: [],
        edges: [],
        compositionFragments: [],
      }),
    };
    expect(() =>
      compileApplicationDeploymentGraph({
        ...request(),
        contributors: [contributor, contributor],
      }),
    ).toThrow("Duplicate application deployment contributor");
  });

  it('rejects one execution identity assigned to two provider-owned workloads', () => {
    const contributor: ApplicationDeploymentContributor = {
      interface: 'TransactionalDatabase',
      implementation: 'postgres',
      version: 1,
      contribute: () => ({
        nodes: [],
        edges: [],
        compositionFragments: [],
        runtimeAccessWorkloads: ['first', 'second'].map((name) => ({
          workloadIdentity: `apps/v1:StatefulSet:guestbook:${name}`,
          artifactIds: [],
          executionNodeIds: ['provider-runtime.shared'],
          kubernetes: {
            resource: {
              apiVersion: 'apps/v1',
              kind: 'StatefulSet' as const,
              namespace: 'guestbook',
              name,
            },
            materialization: {
              authority: 'provider-direct' as const,
              deploymentNodeId: 'direct.provider.runtime',
            },
            podSelector: { 'app.kubernetes.io/name': name },
            serviceAccountName: 'default',
          },
        })),
      }),
    };
    expect(() => compileApplicationDeploymentGraph({
      ...request(),
      contributors: [contributor],
    })).toThrow(/provider-runtime\.shared is assigned to both/u);
  });

  it('treats a provider-owned generated Secret key as canonical ClickStack runtime access', () => {
    const providerId = 'provider.observability';
    const graph = {
      ...applicationGraph(),
      metadata: { name: 'guestbook', namespace: 'guestbook' },
      nodes: [
        {
          id: providerId,
          kind: 'provider',
          name: 'Observability',
          stability: 'stable',
          interface: 'Observability',
          implementation: 'clickstack',
          config: { observability: { kind: 'clickstack', namespace: 'guestbook', policy: {}, retention: {} } },
        },
        { id: 'server.telemetry', kind: 'server', name: 'telemetry-http', routes: [] },
      ],
      edges: [{
        from: { nodeId: providerId },
        to: { nodeId: 'server.telemetry' },
        relationship: 'provides',
      }],
    } as unknown as ApplicationGraph;
    const base = {
      ...request(),
      graph,
      artifacts: [],
    };
    const credentialsName = clickStackCredentialsSecretName(graph.metadata.name);
    const compiled = compileApplicationDeploymentGraph(runtimeWorkloadRequest(
      base,
      'telemetry-http',
      ['server.telemetry'],
      [{
        name: 'APPLIK8S_OTLP_HEADER_VALUE',
        valueFrom: {
          secretKeyRef: {
            name: credentialsName,
            key: 'hyperdx-api-key',
          },
        },
      }, {
        name: 'APPLIK8S_CONTEXT_KEY',
        valueFrom: {
          secretKeyRef: {
            name: 'guestbook-context',
            key: 'key',
          },
        },
      }],
    ));
    expect(compiled.runtimeAccess.diagnostics).toEqual([]);
    expect(compiled.runtimeAccess.workloads[0]?.kubernetes?.credentialProjections)
      .toContainEqual({
        resourceId: `v1/Secret/guestbook/${credentialsName}`,
        keys: ['hyperdx-api-key'],
      });
    expect(JSON.stringify(compiled.runtimeAccess)).not.toContain('clickhouse-password');
    expect(JSON.stringify(compiled.runtimeAccess)).not.toContain('values.yaml');
  });

  it('treats compiler-artifact Secret projections as canonical co-located workload access', () => {
    const graph = {
      ...applicationGraph(),
      metadata: { name: 'guestbook', namespace: 'guestbook' },
      nodes: [
        ...applicationGraph().nodes,
        { id: 'server.web', kind: 'server', name: 'web', routes: [] },
        { id: 'server.api', kind: 'server', name: 'api', routes: [] },
      ],
    } as unknown as ApplicationGraph;
    const base = {
      ...request(),
      graph,
      artifacts: [],
    };
    const compiled = compileApplicationDeploymentGraph({
      ...runtimeWorkloadRequest(
        base,
        'web',
        ['server.web', 'server.api'],
        [{
          name: 'DATABASE_URL',
          valueFrom: {
            secretKeyRef: { name: 'guestbook-db-app', key: 'uri' },
          },
        }, {
          name: 'APPLIK8S_CONTEXT_KEY',
          valueFrom: {
            secretKeyRef: { name: 'guestbook-context', key: 'key' },
          },
        }],
      ),
      artifacts: [{
        id: 'artifact.web',
        artifactType: 'containerImage',
        name: 'web',
        sourceDigest: sourceGraphDigest,
        sourceDescriptor: { context: './web' },
        logicalReference: 'applik8s/web:source',
        executionNodeIds: ['server.web', 'server.api'],
        credentialProjections: [{
          target: 'kubernetes',
          namespace: 'guestbook',
          name: 'guestbook-db-app',
          keys: ['uri'],
        }, {
          target: 'kubernetes',
          namespace: 'guestbook',
          name: 'guestbook-context',
          keys: ['key'],
        }],
      }],
    });
    expect(compiled.runtimeAccess.diagnostics).toEqual([]);
    expect(compiled.runtimeAccess.workloads[0]?.kubernetes?.credentialProjections)
      .toEqual([
        { resourceId: 'v1/Secret/guestbook/guestbook-context', keys: ['key'] },
        { resourceId: 'v1/Secret/guestbook/guestbook-db-app', keys: ['uri'] },
      ]);
    const artifact = compiled.graph.nodes.find((node) => node.id === 'artifact.web');
    expect(artifact?.kind).toBe('artifact');
    if (artifact?.kind !== 'artifact') throw new Error('Expected web artifact.');
    expect(artifact.spec).toMatchObject({
      executionNodeIds: ['server.api', 'server.web'],
      credentialProjections: [
        {
          target: 'kubernetes',
          namespace: 'guestbook',
          name: 'guestbook-context',
          keys: ['key'],
        },
        {
          target: 'kubernetes',
          namespace: 'guestbook',
          name: 'guestbook-db-app',
          keys: ['uri'],
        },
      ],
    });
  });

  it('treats compiler-artifact Kubernetes grants as canonical co-located workload access', () => {
    const graph = {
      ...applicationGraph(),
      metadata: { name: 'guestbook', namespace: 'guestbook' },
      nodes: [
        ...applicationGraph().nodes,
        { id: 'server.web', kind: 'server', name: 'web', routes: [] },
      ],
    } as unknown as ApplicationGraph;
    const image = 'applik8s/web:source';
    const compiled = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      artifacts: [{
        id: 'artifact.web',
        artifactType: 'containerImage',
        name: 'web',
        sourceDigest: sourceGraphDigest,
        sourceDescriptor: { context: './web' },
        logicalReference: image,
        executionNodeIds: ['server.web'],
        credentialProjections: [{
          target: 'kubernetes',
          namespace: 'guestbook',
          name: 'guestbook-context',
          keys: ['key'],
        }],
        kubernetesPermissions: [{
          apiGroup: 'authentication.k8s.io',
          resource: 'tokenreviews',
          scope: 'Cluster',
          verbs: ['create'],
        }],
      }],
      materializedComposition: {
        resources: [{
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'web', namespace: 'guestbook' },
          spec: { template: { metadata: { labels: { app: 'web' } }, spec: {
            serviceAccountName: 'web',
            containers: [{ name: 'runtime', image, env: [{
              name: 'APPLIK8S_CONTEXT_KEY',
              valueFrom: { secretKeyRef: { name: 'guestbook-context', key: 'key' } },
            }] }],
          } } },
        }, {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'ClusterRole',
          metadata: { name: 'web' },
          rules: [{ apiGroups: ['authentication.k8s.io'], resources: ['tokenreviews'], verbs: ['create'] }],
        }, {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'ClusterRoleBinding',
          metadata: { name: 'web' },
          roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'web' },
          subjects: [{ kind: 'ServiceAccount', name: 'web', namespace: 'guestbook' }],
        }],
        status: {},
      },
    });
    expect(compiled.runtimeAccess.diagnostics).toEqual([]);
    expect(compiled.runtimeAccess.workloads[0]?.kubernetes?.bindings).toEqual([
      expect.objectContaining({
        kind: 'ClusterRole',
        rules: [{ apiGroups: ['authentication.k8s.io'], resources: ['tokenreviews'], verbs: ['create'] }],
      }),
    ]);
    const artifact = compiled.graph.nodes.find(({ id }) => id === 'artifact.web');
    expect(artifact?.kind).toBe('artifact');
    if (artifact?.kind !== 'artifact') throw new Error('Expected web artifact.');
    expect(artifact.spec.kubernetesPermissions).toEqual([{
      apiGroup: 'authentication.k8s.io',
      resource: 'tokenreviews',
      scope: 'Cluster',
      verbs: ['create'],
    }]);
  });

  it("fails closed when a provider has no exact deployment contributor", () => {
    const graph = applicationGraph();
    const provider = graph.nodes[0];
    if (!provider || provider.kind !== "provider") {
      throw new Error("Provider fixture is missing.");
    }
    expect(() =>
      compileApplicationDeploymentGraph({
        ...request(),
        graph: {
          ...graph,
          nodes: [
            {
              ...provider,
              implementation: "unregistered-postgres",
            },
          ],
        },
      }),
    ).toThrow(
      /no deployment contributor for TransactionalDatabase\/unregistered-postgres/,
    );
  });

  it("treats profile provider selection as framework deployment indirection for any interface", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "provider.ai.v1alpha1.inference",
            kind: "provider",
            name: "AI",
            stability: "stable",
            interface: "AI",
            implementation: "application-provider-selection",
            config: {
              profile: {
                selectedBy: "schema.spec.profile",
                branches: [
                  {
                    variant: "local",
                    implementation: "ai-deterministic",
                    config: { kind: "ai-deterministic", production: false },
                    resources: [],
                    credentialReferences: [],
                    provenance: "application",
                  },
                ],
              },
            },
          },
        ],
      },
    });

    expect(result.contributorKeys).toContain(
      "AI\u0000application-provider-selection@1",
    );
    expect(
      result.graph.nodes.find(
        (node) => node.kind === "kubernetesComposition",
      ),
    ).toMatchObject({
      spec: {
        fragments: expect.arrayContaining([
          expect.objectContaining({
            sourceNodeId: "provider.ai.v1alpha1.inference",
            providerInterface: "AI",
            providerImplementation: "ai-deterministic",
            execution: "runtime-only",
          }),
        ]),
      },
    });
  });

  it("materializes only the selected profile provider infrastructure", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "provider.search.v1alpha1.primary",
            kind: "provider",
            name: "Search",
            stability: "stable",
            interface: "Search",
            implementation: "application-provider-selection",
            config: {
              search: {
                kind: "application-provider-selection",
                selector: "schema.spec.profile",
                cases: {
                  local: {
                    kind: "postgres-search",
                    schema: "starter_search",
                  },
                  dedicated: {
                    kind: "opensearch",
                    name: "guestbook-search",
                    namespace: "guestbook",
                    provision: true,
                    profile: "production",
                    topology: { nodes: 3 },
                    storage: { size: "20Gi" },
                  },
                },
                default: {
                  kind: "postgres-search",
                  schema: "starter_search",
                },
              },
              profile: {
                selectedBy: "schema.spec.profile",
                branches: [
                  {
                    variant: "local",
                    implementation: "postgres-search",
                    config: { kind: "postgres-search" },
                    resources: [],
                    credentialReferences: [],
                    provenance: "application",
                  },
                  {
                    variant: "dedicated",
                    implementation: "opensearch/guestbook-search",
                    config: { kind: "opensearch" },
                    resources: ["OpenSearchCluster"],
                    credentialReferences: [],
                    provenance: "application",
                  },
                ],
              },
            },
          },
        ],
      },
    });

    expect(
      result.graph.nodes.filter(
        (node) =>
          node.kind === "kubernetesDirect"
          && node.source.semanticNodeId
            === "provider.search.v1alpha1.primary",
      ),
    ).toEqual([]);
    expect(
      result.graph.nodes.find(
        (node) => node.kind === "kubernetesComposition",
      ),
    ).toMatchObject({
      spec: {
        fragments: expect.arrayContaining([
          expect.objectContaining({
            sourceNodeId: "provider.search.v1alpha1.primary",
            providerImplementation: "postgres-search",
            execution: "runtime-only",
          }),
        ]),
      },
    });

    const dedicated = compileApplicationDeploymentGraph({
      ...request(),
      identity: { ...request().identity, profile: "dedicated" },
      installationSpec: {
        name: "guestbook",
        profile: "dedicated",
        providers: {
          search: {
            name: "guestbook-search",
            namespace: "guestbook",
          },
        },
      },
      graph: {
        ...graph,
        nodes: result.graph.metadata.sourceGraphDigest
          ? [
              ...graph.nodes,
              {
                id: "provider.search.v1alpha1.primary",
                kind: "provider",
                name: "Search",
                stability: "stable",
                interface: "Search",
                implementation: "application-provider-selection",
                config: {
                  search: {
                    kind: "application-provider-selection",
                    selector: "schema.spec.profile",
                    cases: {
                      local: { kind: "postgres-search", schema: "starter_search" },
                      dedicated: {
                        kind: "opensearch",
                        name: "alias-must-not-win",
                        namespace: "alias-must-not-win",
                        provision: true,
                        profile: "production",
                        topology: { nodes: 3 },
                        storage: { size: "20Gi" },
                      },
                    },
                    default: { kind: "postgres-search", schema: "starter_search" },
                  },
                  profile: {
                    selectedBy: "schema.spec.profile",
                    branches: [
                      { variant: "local", implementation: "postgres-search", config: {}, resources: [], credentialReferences: [], provenance: "application" },
                      {
                        variant: "dedicated",
                        implementation: "opensearch/guestbook-search",
                        config: {
                          kind: "opensearch",
                          name: "${schema.spec.providers.search.name}",
                          namespace: "${schema.spec.providers.search.namespace}",
                        },
                        resources: [],
                        credentialReferences: [],
                        provenance: "application",
                      },
                    ],
                  },
                },
              },
            ]
          : [],
      },
    });
    expect(
      dedicated.graph.nodes
        .filter((node) => node.kind === "kubernetesDirect")
        .map((node) => node.spec.compositionId),
    ).toEqual(expect.arrayContaining([
      "opensearch-operator-bootstrap",
      "opensearch-cluster",
    ]));
    expect(
      dedicated.graph.nodes.find(
        (node) =>
          node.kind === "kubernetesDirect"
          && node.spec.compositionId === "opensearch-cluster",
      ),
    ).toMatchObject({
      spec: {
        configuration: {
          name: "guestbook-search",
          namespace: "guestbook",
        },
      },
    });
  });

  it("makes managed Harbor a first-class prerequisite of every artifact", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          {
            id: "provider.container-registry",
            kind: "provider",
            name: "ContainerRegistry",
            stability: "stable",
            interface: "ContainerRegistry",
            implementation: "application-provider-selection",
            config: {
              containerRegistry: {
                kind: "harbor-container-registry",
                endpoint: {
                  kind: "kubernetes-node-port",
                  namespace: "harbor",
                  service: "harbor",
                  port: 32080,
                  protocol: "http",
                },
                project: "guestbook",
                pushCredentials: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "registry-push",
                  dockerConfigJsonKey: ".dockerconfigjson",
                },
                pullSecret: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "registry-pull",
                },
                management: {
                  adminCredentials: {
                    apiVersion: "v1",
                    kind: "Secret",
                    namespace: "harbor",
                    name: "harbor-admin",
                    username: "admin",
                    passwordKey: "password",
                  },
                  secretNamespace: "guestbook",
                  projectLifecycle: { deletionPolicy: "retain" },
                },
              },
            },
          },
        ],
      },
    });
    const harbor = result.graph.nodes.find(
      ({ id }) => id === "external.provider.container-registry.harbor-project",
    );
    expect(harbor).toMatchObject({
      kind: "externalProvider",
      provider: {
        interface: "ContainerRegistry",
        implementation: "typekro-harbor-project",
      },
      lifecycle: { deletion: "retain" },
    });
    expect(result.graph.edges).toContainEqual({
      from: "external.provider.container-registry.harbor-project",
      to: "artifact.web",
      relationship: "requiresReady",
    });
  });

  it("compiles direct registry and structured-generation provider implementations", () => {
    const graph = applicationGraph();
    const provider = graph.nodes[0];
    if (!provider || provider.kind !== "provider") {
      throw new Error("Provider fixture is missing.");
    }
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          {
            id: "provider.container-registry",
            kind: "provider",
            name: "ContainerRegistry",
            stability: "stable",
            interface: "ContainerRegistry",
            implementation: "harbor-container-registry",
            config: {
              containerRegistry: {
                kind: "harbor-container-registry",
                endpoint: {
                  kind: "kubernetes-node-port",
                  namespace: "harbor",
                  service: "harbor",
                  port: 32080,
                  protocol: "http",
                },
                project: "guestbook",
                management: {
                  adminCredentials: {
                    apiVersion: "v1",
                    kind: "Secret",
                    namespace: "harbor",
                    name: "harbor-admin",
                    username: "admin",
                    passwordKey: "password",
                  },
                  secretNamespace: "guestbook",
                },
              },
            },
          },
          {
            ...provider,
            id: "provider.structured-generation",
            name: "StructuredGeneration",
            interface: "StructuredGeneration",
            implementation: "structured-generation-deterministic",
            config: {
              bindingKind: "provided",
              provider: "structured-generation-deterministic",
            },
          },
        ],
      },
    });

    expect(result.contributorKeys).toEqual(
      expect.arrayContaining([
        "ContainerRegistry\u0000harbor-container-registry@1",
        "StructuredGeneration\u0000structured-generation-deterministic@1",
      ]),
    );
    expect(
      result.graph.nodes.find(
        ({ id }) =>
          id === "external.provider.container-registry.harbor-project",
      ),
    ).toBeDefined();
  });

  it("lowers direct provider lifecycle boundaries into graph-owned TypeKro nodes", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        metadata: { ...graph.metadata, namespace: "guestbook" },
        nodes: [
          {
            id: "provider.index",
            kind: "provider",
            name: "IndexStore",
            stability: "stable",
            interface: "IndexStore",
            implementation: "valkey",
            config: {
              indexStore: {
                kind: "valkey",
                provision: true,
                provisioner: "hyperspike",
                name: "guestbook-index",
                namespace: "guestbook",
                operator: {
                  provision: true,
                  name: "valkey-operator",
                  namespace: "valkey-system",
                },
                topology: { shards: 1, replicas: 0 },
                storage: { size: "1Gi" },
              },
            },
          },
          {
            id: "provider.models",
            kind: "provider",
            name: "TransactionalDatabase",
            stability: "stable",
            interface: "TransactionalDatabase",
            implementation: "postgres",
            config: {
              transactionalDatabase: {
                kind: "postgres",
                ownership: "direct-provisioned",
                name: "guestbook",
                namespace: "guestbook",
                database: "guestbook",
                lifecycle: { deletionPolicy: "retain" },
                instances: 1,
                storage: { size: "2Gi" },
              },
            },
          },
          {
            id: "provider.objects",
            kind: "provider",
            name: "ObjectStorage",
            stability: "stable",
            interface: "ObjectStorage",
            implementation: "s3",
            config: {
              objectStorage: {
                kind: "s3",
                enabled: true,
                ownership: "direct-provisioned",
                bucket: "guestbook-media",
                region: "us-east-1",
                credentialsSecret: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "guestbook-media",
                },
                provisioning: {
                  enabled: true,
                  claimName: "guestbook-media",
                  storageClassName: "rook-bucket",
                },
              },
            },
          },
          {
            id: "provider.search",
            kind: "provider",
            name: "Search",
            stability: "stable",
            interface: "Search",
            implementation: "opensearch",
            config: {
              search: {
                kind: "opensearch",
                provision: true,
                profile: "production",
                name: "guestbook-search",
                namespace: "guestbook",
                operator: {
                  namespace: "opensearch-operator-system",
                },
                topology: {
                  nodes: 3,
                  roles: ["clusterManager", "data", "ingest"],
                },
                networkPolicy: {
                  enabled: true,
                },
                storage: {
                  size: "4Gi",
                  deletionPolicy: "retain",
                },
                tls: { source: "generated" },
              },
            },
          },
        ],
      },
    });
    const direct = result.graph.nodes.filter(
      (node) => node.kind === "kubernetesDirect",
    );
    expect(direct.map((node) => node.spec.compositionId)).toEqual([
      "valkey-bootstrap",
      "applik8s-valkey-cluster-provider",
      "applik8s-postgres-cluster-provider",
      "rook-object-storage-claim",
      "opensearch-operator-bootstrap",
      "opensearch-cluster",
      "applik8s-namespace",
      "applik8s-namespace",
    ]);
    expect(
      direct
        .filter((node) => node.spec.compositionId === "applik8s-namespace")
        .map((node) => node.id),
    ).toEqual([
      "direct.namespace.control-plane",
      "direct.namespace.workload",
    ]);
    expect(direct.find((node) => node.id.endsWith(".operator"))?.lifecycle).toMatchObject({
      ownership: "shared",
      deletion: "retain",
    });
    expect(direct.find((node) => node.id === "direct.provider.models.cluster")?.lifecycle).toMatchObject({
      deletion: "retain",
    });
    expect(result.graph.edges).toContainEqual({
      from: "direct.provider.index.operator",
      to: "direct.provider.index.cluster",
      relationship: "installsApi",
    });
    expect(result.graph.edges).toContainEqual({
      from: "direct.provider.search.operator",
      to: "direct.provider.search.cluster",
      relationship: "installsApi",
    });
    expect(
      direct.find(
        (node) => node.id === "direct.provider.search.cluster",
      )?.spec.configuration,
    ).toMatchObject({
      build: {
        profile: "production",
        nodes: 3,
        roles: ["cluster_manager", "data", "ingest"],
        networkPolicy: {
          operatorNamespace: "opensearch-operator-system",
          ingressNamespaceLabels: {
            "kubernetes.io/metadata.name": "guestbook",
          },
        },
      },
      instance: {
        lifecycle: "external-retain",
        storage: { size: "4Gi" },
      },
    });
    for (const node of direct) {
      expect(result.graph.edges).toContainEqual({
        from: node.id,
        to: "kubernetes.application",
        relationship: "requiresReady",
      });
    }
  });

  it("lowers Starter local S3 into generated credentials plus one persistent TypeKro boundary", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        metadata: { ...graph.metadata, namespace: "guestbook" },
        nodes: [
          {
            id: "provider.objects",
            kind: "provider",
            name: "ObjectStorage",
            stability: "stable",
            interface: "ObjectStorage",
            implementation: "s3",
            config: {
              objectStorage: {
                kind: "s3",
                enabled: true,
                name: "objects",
                endpoint: "http://guestbook-objects.guestbook.svc:8333",
                ownership: "direct-provisioned",
                bucket: "guestbook-objects",
                region: "us-east-1",
                credentialsSecret: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "guestbook-objects-credentials",
                },
                provisioning: {
                  kind: "local-s3",
                  enabled: true,
                  name: "guestbook-objects",
                  storageSize: "2Gi",
                  storageClassName: "local-path",
                },
              },
            },
          },
        ],
      },
      identity: { ...request().identity, profile: "starter" },
      installationSpec: { name: "guestbook", profile: "starter" },
    });
    const credentials = result.graph.nodes.find(
      (node) =>
        node.id === "external.provider.objects.local-s3-credentials",
    );
    const localS3 = result.graph.nodes.find(
      (node) => node.id === "direct.provider.objects.local-s3",
    );

    expect(credentials).toMatchObject({
      kind: "externalProvider",
      lifecycle: { ownership: "application", deletion: "delete" },
      spec: {
        resourceType: "kubernetesGeneratedSecret",
        referenceMode: "staticIdentity",
        configuration: {
          namespace: "guestbook",
          name: "guestbook-objects-credentials",
          runtimeKeys: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
          values: {
            AWS_ACCESS_KEY_ID: {
              kind: "random",
              bytes: 32,
              encoding: "base64url",
            },
            AWS_SECRET_ACCESS_KEY: {
              kind: "random",
              bytes: 32,
              encoding: "base64url",
            },
          },
        },
      },
    });
    expect(localS3).toMatchObject({
      kind: "kubernetesDirect",
      spec: {
        compositionId: "applik8s-local-s3",
        configuration: {
          name: "guestbook-objects",
          namespace: "guestbook",
          bucket: "guestbook-objects",
          credentialsSecretName: "guestbook-objects-credentials",
          image:
            "docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d",
          storage: { size: "2Gi", storageClassName: "local-path" },
        },
      },
    });
    expect(result.graph.edges).toContainEqual({
      from: credentials?.id,
      to: localS3?.id,
      relationship: "requiresReady",
    });
    expect(result.graph.edges).not.toContainEqual({
      from: credentials?.id,
      to: "kubernetes.application",
      relationship: "requiresReady",
    });
    expect(result.graph.edges).toContainEqual({
      from: localS3?.id,
      to: "kubernetes.application",
      relationship: "requiresReady",
    });
    expect(JSON.stringify(result.graph)).not.toContain(
      '"AWS_SECRET_ACCESS_KEY":"',
    );
  });

  it("lowers managed JetStream into a direct provider lifecycle before the application", () => {
    const graph: ApplicationGraph = {
      ...applicationGraph(),
      metadata: { ...applicationGraph().metadata, namespace: "guestbook" },
      nodes: [
        {
          id: "provider.event-log",
          kind: "provider",
          name: "EventLog",
          stability: "stable",
          interface: "EventLog",
          implementation: "nats-jetstream",
          config: {
            name: "guestbook-events",
            namespace: "guestbook",
            provision: true,
            replicas: 3,
            storageSize: "20Gi",
            storageClassName: "ceph-block",
            pvcRetentionPolicy: "retain",
          },
        },
      ],
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "dedicated" },
      installationSpec: { name: "guestbook", profile: "dedicated" },
    });
    const nats = result.graph.nodes.find(
      (node) => node.id === "direct.provider.event-log.nats",
    );

    expect(nats).toMatchObject({
      kind: "kubernetesDirect",
      provider: {
        interface: "EventLog",
        implementation: "nats-bootstrap",
      },
      lifecycle: {
        ownership: "application",
        deletion: "delete",
      },
      spec: {
        compositionId: "nats-bootstrap",
        configuration: {
          name: "guestbook-events",
          namespace: "guestbook",
          namespaceOwnership: "external",
          replicas: 3,
          storageSize: "20Gi",
          pvcRetentionPolicy: "retain",
          values: {
            config: {
              jetstream: {
                fileStore: {
                  pvc: { storageClassName: "ceph-block" },
                },
              },
            },
          },
        },
      },
    });
    expect(result.graph.edges).toContainEqual({
      from: "direct.namespace.workload",
      to: nats?.id,
      relationship: "requiresReady",
    });
    expect(result.graph.edges).toContainEqual({
      from: nats?.id,
      to: "kubernetes.application",
      relationship: "requiresReady",
    });
    expect(
      result.graph.nodes.find(
        (node) => node.id === "kubernetes.application",
      )?.spec,
    ).toMatchObject({
      fragments: [
        expect.objectContaining({
          sourceNodeId: "provider.event-log",
          execution: "direct-provider",
        }),
      ],
    });

    const eventLogProvider = graph.nodes[0];
    if (eventLogProvider?.kind !== "provider") {
      throw new Error("Managed EventLog fixture is missing its provider node.");
    }
    const external = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          {
            ...eventLogProvider,
            config: {
              name: "external-events",
              provision: false,
              servers: ["nats://external.messaging.svc:4222"],
            },
          },
        ],
      },
    });
    expect(
      external.graph.nodes.some(
        (node) =>
          node.kind === "kubernetesDirect"
          && node.spec.compositionId === "nats-bootstrap",
      ),
    ).toBe(false);
  });

  it("deploys a qualified primary provider once without its derived unqualified alias", () => {
    const base = applicationGraph();
    const graph: ApplicationGraph = {
      ...base,
      metadata: { ...base.metadata, namespace: "identity-start-system" },
      nodes: [
        {
          id: "provider.event-log",
          kind: "provider",
          name: "EventLog",
          stability: "stable",
          interface: "EventLog",
          implementation: "nats-jetstream",
          config: {
            bindingKind: "commandTransport",
            aliasOf: "provider.event-log.v1alpha1.primary",
            name: "identity-start-events",
            namespace: "identity-start-system",
            provision: true,
            replicas: 1,
            storageSize: "2Gi",
          },
        },
        {
          id: "provider.event-log.v1alpha1.primary",
          kind: "provider",
          name: "EventLog",
          stability: "stable",
          interface: "EventLog",
          implementation: "application-provider-selection",
          config: {
            bindingKind: "provided",
            qualification: {
              apiVersion: "applik8s.providerQualification/v1alpha1",
              capability: "EventLog",
              compatibilityRevision: "v1alpha1",
              key: "EventLog@v1alpha1:primary",
              name: "primary",
            },
            profile: {
              selectedBy: "schema.spec.profile",
              branches: [
                {
                  variant: "starter",
                  implementation: "nats-jetstream/identity-start-events",
                  config: {
                    kind: "nats-jetstream",
                    name: "identity-start-events",
                    namespace: "identity-start-system",
                    provision: true,
                    replicas: 1,
                    storageSize: "2Gi",
                  },
                  resources: [],
                  credentialReferences: [],
                  provenance: "application",
                },
              ],
            },
          },
        },
      ],
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "starter" },
      installationSpec: { name: "identity-start", profile: "starter" },
    });
    const natsNodes = result.graph.nodes.filter(
      (node) =>
        node.kind === "kubernetesDirect"
        && node.spec.compositionId === "nats-bootstrap",
    );

    expect(natsNodes).toHaveLength(1);
    expect(natsNodes[0]).toMatchObject({
      id: "direct.provider.event-log.v1alpha1.primary.nats",
      source: {
        semanticNodeId: "provider.event-log.v1alpha1.primary",
      },
      spec: {
        configuration: {
          name: "identity-start-events",
          namespace: "identity-start-system",
          replicas: 1,
          storageSize: "2Gi",
        },
      },
    });
    expect(
      result.graph.nodes.find(
        (node) => node.id === "kubernetes.application",
      )?.spec,
    ).toMatchObject({
      fragments: [
        expect.objectContaining({
          sourceNodeId: "provider.event-log.v1alpha1.primary",
          providerImplementation: "nats-jetstream",
          execution: "direct-provider",
        }),
      ],
    });
  });

  it("deploys a role-named provider once when its explicit unqualified alias selects it as the application default", () => {
    const base = applicationGraph();
    const registry = {
      kind: "harbor-container-registry",
      endpoint: {
        kind: "kubernetes-node-port",
        namespace: "harbor-system",
        service: "harbor",
        port: 32080,
        protocol: "http",
      },
      project: "chirp",
      management: {
        adminCredentials: {
          apiVersion: "v1",
          kind: "Secret",
          name: "harbor-admin",
          namespace: "harbor-system",
          username: "admin",
          passwordKey: "password",
        },
        secretNamespace: "chirp",
        pushRobotName: "builder",
        pullRobotName: "chirp",
        pushSecretName: "registry-push",
        pullSecretName: "registry-pull",
      },
    };
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        {
          id: "provider.container-registry",
          kind: "provider",
          name: "ContainerRegistry",
          stability: "stable",
          interface: "ContainerRegistry",
          implementation: "application-provider-selection",
          config: {
            bindingKind: "provided",
            aliasOf: "provider.container-registry.v1alpha1.images",
            containerRegistry: registry,
          },
        },
        {
          id: "provider.container-registry.v1alpha1.images",
          kind: "provider",
          name: "ContainerRegistry",
          stability: "stable",
          interface: "ContainerRegistry",
          implementation: "application-provider-selection",
          config: {
            bindingKind: "provided",
            qualification: {
              apiVersion: "applik8s.providerQualification/v1alpha1",
              capability: "ContainerRegistry",
              compatibilityRevision: "v1alpha1",
              key: "ContainerRegistry@v1alpha1:images",
              name: "images",
            },
            containerRegistry: registry,
          },
        },
      ],
    };

    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "starter" },
      installationSpec: { name: "chirp", profile: "starter" },
    });
    const registries = result.graph.nodes.filter(
      (node) =>
        node.kind === "externalProvider"
        && node.provider.interface === "ContainerRegistry",
    );

    expect(registries).toHaveLength(1);
    expect(registries[0]).toMatchObject({
      id: "external.provider.container-registry.v1alpha1.images.harbor-project",
      source: {
        semanticNodeId: "provider.container-registry.v1alpha1.images",
      },
    });
  });

  it("uses retained profile branches after graph normalization names the concrete provider", () => {
    const base = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...base,
        metadata: { ...base.metadata, namespace: "chirp" },
        nodes: [
          {
            id: "provider.index-store.v1alpha1.online",
            kind: "provider",
            name: "IndexStore",
            stability: "stable",
            interface: "IndexStore",
            implementation: "valkey",
            config: {
              bindingKind: "provided",
              indexStore: {
                kind: "valkey",
                provisioner: "hyperspike",
                provision: true,
                name: "chirp-online-index",
                namespace: "chirp",
                storage:
                  '${schema.spec.profile == "starter" ? dyn({"size":"8Gi","storageClassName":"local-path"}) : omit()}',
              },
              profile: {
                selectedBy: "schema.spec.profile",
                branches: [
                  {
                    variant: "starter",
                    implementation: "valkey/chirp-online-index",
                    config: {
                      kind: "valkey",
                      provisioner: "hyperspike",
                      provision: true,
                      name: "chirp-online-index",
                      namespace: "chirp",
                      topology: { shards: 1, replicas: 0 },
                      authentication: { mode: "anonymous" },
                      storage: {
                        size: "8Gi",
                        storageClassName: "local-path",
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      identity: {
        ...request().identity,
        application: "chirp",
        instance: "chirp",
        profile: "starter",
      },
      installationSpec: { name: "chirp", profile: "starter" },
    });

    expect(
      result.graph.nodes.find(
        (node) =>
          node.id ===
          "direct.provider.index-store.v1alpha1.online.cluster",
      ),
    ).toMatchObject({
      kind: "kubernetesDirect",
      spec: {
        configuration: {
          spec: {
            storage: {
              spec: {
                resources: { requests: { storage: "8Gi" } },
                accessModes: ["ReadWriteOnce"],
                storageClassName: "local-path",
              },
            },
          },
        },
      },
    });
  });

  it("uses a qualified provider's default alias as deployment configuration authority", () => {
    const base = applicationGraph();
    const graph: ApplicationGraph = {
      ...base,
      metadata: { ...base.metadata, namespace: "identity-start-system" },
      nodes: [
        {
          id: "provider.object-storage",
          kind: "provider",
          name: "ObjectStorage",
          stability: "stable",
          interface: "ObjectStorage",
          implementation: "s3",
          config: {
            bindingKind: "default",
            objectStorage: {
              kind: "s3",
              name: "objects",
              endpoint:
                "http://identity-start-objects.identity-start-system.svc:8333",
              bucket: "identity-start-objects",
              region: "us-east-1",
              forcePathStyle: true,
              ownership: "direct-provisioned",
              credentialsSecret: {
                apiVersion: "v1",
                kind: "Secret",
                name: "identity-start-objects-credentials",
                namespace: "identity-start-system",
              },
              provisioning: {
                kind: "local-s3",
                enabled: true,
                name: "identity-start-objects",
                storageSize: "2Gi",
                storageClassName: "local-path",
              },
            },
          },
        },
        {
          id: "provider.object-storage.v1alpha1.primary",
          kind: "provider",
          name: "ObjectStorage",
          stability: "stable",
          interface: "ObjectStorage",
          implementation: "application-provider-selection",
          config: {
            bindingKind: "provided",
            qualification: {
              apiVersion: "applik8s.providerQualification/v1alpha1",
              capability: "ObjectStorage",
              compatibilityRevision: "v1alpha1",
              key: "ObjectStorage@v1alpha1:primary",
              name: "primary",
            },
            profile: {
              selectedBy: "schema.spec.profile",
              branches: [
                {
                  variant: "starter",
                  implementation: "s3/objects",
                  config: {
                    kind: "s3",
                    name: "objects",
                    bucket: "identity-start-objects",
                    region: "us-east-1",
                    ownership: "direct-provisioned",
                  },
                  resources: [],
                  credentialReferences: [],
                  provenance: "application",
                },
              ],
            },
          },
        },
      ],
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "starter" },
      installationSpec: { name: "identity-start", profile: "starter" },
    });

    expect(
      result.graph.nodes.filter(
        (node) =>
          node.kind === "kubernetesDirect"
          && node.spec.compositionId === "applik8s-local-s3",
      ),
    ).toHaveLength(1);
    expect(
      result.graph.nodes.find(
        (node) =>
          node.id
          === "external.provider.object-storage.v1alpha1.primary.local-s3-credentials",
      ),
    ).toMatchObject({
      kind: "externalProvider",
      spec: {
        configuration: {
          namespace: "identity-start-system",
          name: "identity-start-objects-credentials",
        },
      },
    });
    expect(
      result.graph.nodes.find(
        (node) =>
          node.id === "direct.provider.object-storage.v1alpha1.primary.local-s3",
      ),
    ).toMatchObject({
      kind: "kubernetesDirect",
      spec: {
        configuration: {
          name: "identity-start-objects",
          namespace: "identity-start-system",
          bucket: "identity-start-objects",
          credentialsSecretName: "identity-start-objects-credentials",
        },
      },
    });
  });

  it("deduplicates one managed Ory stack shared by identity and OAuth providers", () => {
    const identityInfrastructure = {
      kind: "ory",
      stack: "platform",
      provision: true,
      spec: { name: "identity", namespace: "identity-system" },
      deletionPolicy: "retain",
    } as const;
    const graph: ApplicationGraph = {
      ...applicationGraph(),
      nodes: [
      {
        id: "provider.identity",
        kind: "provider",
        name: "IdentityProvider",
        stability: "stable",
        interface: "IdentityProvider",
        implementation: "identity-provider",
        config: { identityInfrastructure },
      },
      {
        id: "provider.oauth",
        kind: "provider",
        name: "OAuthAuthorizationServer",
        stability: "stable",
        interface: "OAuthAuthorizationServer",
        implementation: "oauth-authorization-server",
        config: { identityInfrastructure },
      },
      ],
    };

    const result = compileApplicationDeploymentGraph({ ...request(), graph });
    const managedOry = result.graph.nodes.filter(
      (node) =>
        node.kind === "kubernetesDirect" &&
        node.spec.compositionId === "ory-platform-stack",
    );
    expect(managedOry).toHaveLength(1);
    expect(managedOry[0]?.source.semanticNodeId).toBe("provider.identity");
    const databases = result.graph.nodes.filter(
      (node) =>
        node.kind === "kubernetesDirect" &&
        node.spec.compositionId === "applik8s-postgres-cluster-provider",
    );
    expect(databases).toHaveLength(3);
    expect(
      databases
        .map((node) =>
          Reflect.get(node.spec.configuration as object, "name"),
        )
        .sort(),
    ).toEqual([
      "identity-hydra-db",
      "identity-keto-db",
      "identity-kratos-db",
    ]);
    const generatedSecrets = result.graph.nodes.filter(
      (node) =>
        node.kind === "externalProvider" &&
        node.provider.implementation
          === "alchemy-kubernetes-generated-secret" &&
        node.source.semanticNodeId === "provider.identity",
    );
    expect(generatedSecrets).toHaveLength(3);
    expect(
      generatedSecrets.find((node) => node.id.endsWith("ory-kratos-secrets"))
        ?.spec.configuration,
    ).toMatchObject({
      values: {
        cookie: {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
          characters: 32,
        },
        cipher: {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
          characters: 32,
        },
      },
    });
    expect(managedOry[0]?.spec.configuration).toMatchObject({
      namespaceOwnership: "external",
      managed: {
        databases: false,
        secrets: false,
      },
      dependencySources: {
        hydra: {
          database: {
            dsn: {
              mode: "external",
              value: {
                secretRef: {
                  name: "identity-hydra-db-app",
                  key: "uri",
                },
              },
            },
          },
          systemSecret: {
            mode: "external",
            value: {
              secretRef: {
                name: "identity-hydra-secrets",
                key: "system",
              },
            },
          },
        },
        kratos: {
          database: {
            dsn: {
              mode: "external",
              value: {
                secretRef: {
                  name: "identity-kratos-db-app",
                  key: "uri",
                },
              },
            },
          },
          secrets: {
            cookie: {
              mode: "external",
              value: {
                secretRef: {
                  name: "identity-kratos-secrets",
                  key: "cookie",
                },
              },
            },
            cipher: {
              mode: "external",
              value: {
                secretRef: {
                  name: "identity-kratos-secrets",
                  key: "cipher",
                },
              },
            },
          },
        },
        keto: {
          database: {
            dsn: {
              mode: "external",
              value: {
                secretRef: {
                  name: "identity-keto-db-app",
                  key: "uri",
                },
              },
            },
          },
        },
        oathkeeper: {
          mutatorIdTokenJwks: {
            mode: "external",
            value: {
              secretRef: {
                name: "identity-oathkeeper-secrets",
                key: "jwks",
              },
            },
          },
        },
      },
    });
    for (const dependency of [...databases, ...generatedSecrets]) {
      expect(result.graph.edges).toContainEqual({
        from: dependency.id,
        to: managedOry[0]?.id,
        relationship: "requiresReady",
      });
    }
    const identityNamespace = result.graph.nodes.find(
      (node) =>
        node.kind === "kubernetesDirect" &&
        node.id === "direct.provider.identity.ory-namespace",
    );
    expect(identityNamespace).toMatchObject({
      spec: {
        compositionId: "applik8s-namespace",
        configuration: { name: "identity-system" },
      },
      lifecycle: { deletion: "retain" },
    });
    expect(JSON.stringify(result.graph)).not.toMatch(
      /hydra-local-system-secret|typekro\.dev\/local-default|"stringData"|"data":\{"jwks"/,
    );
  });

  it("preserves explicit Ory dependency sources and only generates missing production capabilities", () => {
    const identityInfrastructure = {
      kind: "ory",
      stack: "platform",
      provision: true,
      spec: {
        name: "identity",
        namespace: "identity-system",
        managed: {
          databases: true,
          secrets: true,
          databaseStorageClass: "ceph-block",
        },
        dependencySources: {
          hydra: {
            database: {
              dsn: {
                mode: "external",
                value: {
                  secretRef: {
                    name: "platform-hydra-dsn",
                    key: "uri",
                  },
                },
              },
            },
            systemSecret: {
              mode: "external",
              value: {
                secretRef: {
                  name: "platform-hydra-secrets",
                  key: "system",
                },
              },
            },
          },
        },
      },
      deletionPolicy: "retain",
    } as const;
    const graph: ApplicationGraph = {
      ...applicationGraph(),
      nodes: [
        {
          id: "provider.identity",
          kind: "provider",
          name: "IdentityProvider",
          stability: "stable",
          interface: "IdentityProvider",
          implementation: "identity-provider",
          config: { identityInfrastructure },
        },
      ],
    };

    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "dedicated" },
      installationSpec: { name: "identity", profile: "dedicated" },
    });
    const ory = result.graph.nodes.find(
      (node) =>
        node.kind === "kubernetesDirect" &&
        node.spec.compositionId === "ory-platform-stack",
    );
    expect(ory?.spec.configuration).toMatchObject({
      managed: {
        databases: false,
        secrets: false,
        databaseStorageClass: "ceph-block",
      },
      dependencySources: {
        hydra: identityInfrastructure.spec.dependencySources.hydra,
      },
    });
    expect(
      result.graph.nodes.find(
        (node) =>
          node.id === "direct.provider.identity.ory-hydra-database",
      ),
    ).toBeUndefined();
    expect(
      result.graph.nodes.find(
        (node) =>
          node.id === "external.provider.identity.ory-hydra-secrets",
      ),
    ).toBeUndefined();
    const generatedDatabases = result.graph.nodes.filter(
      (node) =>
        node.kind === "kubernetesDirect" &&
        node.spec.compositionId === "applik8s-postgres-cluster-provider",
    );
    expect(generatedDatabases).toHaveLength(2);
    for (const database of generatedDatabases) {
      expect(database.spec.configuration).toMatchObject({
        spec: {
          storage: { storageClass: "ceph-block" },
        },
      });
    }
    expect(
      result.graph.nodes.filter(
        (node) =>
          node.kind === "externalProvider" &&
          node.provider.implementation
            === "alchemy-kubernetes-generated-secret",
      ),
    ).toHaveLength(2);
  });

  it("lowers production Envoy AI Gateway routing behind shared platform lifecycle", () => {
    const graph: ApplicationGraph = {
      ...applicationGraph(),
      nodes: [
        ...applicationGraph().nodes,
        {
          id: "provider.ai",
          kind: "provider",
          name: "AI",
          stability: "stable",
          interface: "AI",
          implementation: "envoy-ai-gateway",
          config: {
            ai: {
              kind: "envoy-ai-gateway",
              production: true,
              name: "guestbook-inference",
              namespace: "guestbook",
              provision: true,
              versions: {
                envoyGateway: "v1.6.0",
                aiGateway: "v0.6.0",
                gatewayApi: "v1.4.1",
              },
              models: {
                fast: {
                  fallback: "ordered",
                  backends: [
                    {
                      apiVersion: "applik8s.aiBackend/v1alpha1",
                      name: "primary",
                      providerClass: "openai-compatible",
                      model: "local-fast",
                      endpoint: "http://model-server.guestbook.svc:8080/v1",
                      capabilities: ["chat", "tools", "streaming"],
                    },
                  ],
                },
              },
              telemetry: {
                usage: true,
                cost: true,
                redactBodies: true,
              },
            },
          },
        },
      ],
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "dedicated" },
      installationSpec: { name: "guestbook", profile: "dedicated" },
    });
    expect(validateApplicationDeploymentGraph(result.graph).valid).toBe(true);
    const direct = result.graph.nodes.filter(
      (node) => node.kind === "kubernetesDirect",
    );
    expect(direct.map((node) => node.spec.compositionId)).toEqual(
      expect.arrayContaining([
        "applik8s-unowned-namespace",
        "envoy-ai-gateway",
      ]),
    );
    const gateway = direct.find(
      (node) => node.spec.compositionId === "envoy-ai-gateway",
    );
    expect(gateway?.spec.configuration).toMatchObject({
      build: {
        profile: "production",
        providers: [
          {
            name: "primary",
            kind: "openai-compatible",
            hostname: "model-server.guestbook.svc",
            port: 8080,
            tls: false,
            prefix: "/v1",
          },
        ],
        models: [
          {
            model: "fast",
            targets: [
              {
                provider: "primary",
                model: "local-fast",
                priority: 0,
              },
            ],
          },
        ],
        platform: {
          profile: "production",
          mcpSessionEncryptionSeedSecret: {
            name: "envoy-ai-gateway-mcp-seed",
            key: "seed",
          },
        },
      },
      instance: {
        name: "guestbook-inference",
        namespace: "guestbook",
        lifecycle: "external",
      },
    });
    const seed = result.graph.nodes.find(
      (node) => node.id === "external.provider.ai.mcp-seed",
    );
    expect(seed).toMatchObject({
      kind: "externalProvider",
      scope: { namespace: "envoy-ai-gateway-system" },
      lifecycle: { ownership: "shared", deletion: "retain" },
    });
    expect(result.graph.edges).toContainEqual({
      from: seed?.id,
      to: gateway?.id,
      relationship: "requiresReady",
    });
    expect(seed).toMatchObject({
      spec: { referenceMode: "staticIdentity" },
    });
    expect(
      result.runtimeAccess.workloads.flatMap((workload) =>
        workload.kubernetes?.credentialProjections ?? []),
    ).not.toContainEqual({
      resourceId:
        "v1/Secret/envoy-ai-gateway-system/envoy-ai-gateway-mcp-seed",
      keys: ["seed"],
    });
    expect(result.graph.edges).not.toContainEqual({
      from: seed?.id,
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "name",
    });
  });

  it("deploys explicitly shared logical AI roles through one physical Envoy authority", () => {
    const base = applicationGraph();
    const ai = {
      kind: "envoy-ai-gateway",
      name: "shared-inference",
      namespace: "guestbook",
      provision: true,
      versions: {
        envoyGateway: "v1.6.0",
        aiGateway: "v0.6.0",
        gatewayApi: "v1.4.1",
      },
      models: {
        fast: {
          fallback: "disabled",
          backends: [{
            apiVersion: "applik8s.aiBackend/v1alpha1",
            name: "primary",
            providerClass: "openai-compatible",
            model: "fast",
            endpoint: "http://model.guestbook.svc:8080",
            capabilities: ["chat", "tools", "streaming"],
          }],
        },
      },
    };
    const graph: ApplicationGraph = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "provider.ai.v1alpha1.inference",
          kind: "provider",
          name: "AI",
          stability: "stable",
          interface: "AI",
          implementation: "envoy-ai-gateway",
          config: {
            qualification: { name: "inference", compatibilityRevision: "v1alpha1" },
            ai,
          },
        },
        {
          id: "provider.ai.v1alpha1.research",
          kind: "provider",
          name: "AI",
          stability: "stable",
          interface: "AI",
          implementation: "envoy-ai-gateway",
          config: {
            qualification: { name: "research", compatibilityRevision: "v1alpha1" },
            aliasOf: "provider.ai.v1alpha1.inference",
            ai,
          },
        },
      ],
    };

    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "dedicated" },
      installationSpec: { name: "guestbook", profile: "dedicated" },
    });
    expect(
      result.graph.nodes.filter(
        (node) => node.kind === "kubernetesDirect"
          && node.spec.compositionId === "envoy-ai-gateway",
      ),
    ).toHaveLength(1);

    const forged: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind === "provider"
          && node.id === "provider.ai.v1alpha1.research"
          ? {
              ...node,
              config: {
                ...node.config,
                ai: { ...ai, name: "different-inference" },
              },
            }
          : node),
    };
    expect(() => compileApplicationDeploymentGraph({
      ...request(),
      graph: forged,
      identity: { ...request().identity, profile: "dedicated" },
      installationSpec: { name: "guestbook", profile: "dedicated" },
    })).toThrow(/physical provider plans differ/);
  });

  it("bounds Envoy AI Gateway's derived ext-proc volume identity", () => {
    const base = applicationGraph();
    const graph: ApplicationGraph = {
      ...base,
      metadata: { name: "agentic-product-evidence" },
      nodes: [
        ...base.nodes,
        {
          id: "provider.ai",
          kind: "provider",
          name: "AI",
          stability: "stable",
          interface: "AI",
          implementation: "envoy-ai-gateway",
          config: {
            ai: {
              kind: "envoy-ai-gateway",
              production: true,
              name: "agentic-product-evidence-inference",
              namespace: "agentic-product-evidence-system",
              provision: true,
              versions: {
                envoyGateway: "v1.6.0",
                aiGateway: "v0.6.0",
                gatewayApi: "v1.4.1",
              },
              models: {
                fast: {
                  fallback: "disabled",
                  backends: [{
                    apiVersion: "applik8s.aiBackend/v1alpha1",
                    name: "primary",
                    providerClass: "openai-compatible",
                    model: "inclusionai/ling-3.0-tiny:free",
                    endpoint: "https://openrouter.ai/api/v1",
                    capabilities: ["chat", "tools", "streaming"],
                  }],
                },
              },
            },
          },
        },
      ],
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph,
      identity: { ...request().identity, profile: "developer" },
      installationSpec: {
        name: "agentic-product-evidence",
        profile: "developer",
      },
    });
    const gateway = result.graph.nodes.find(
      (node) =>
        node.kind === "kubernetesDirect"
        && node.spec.compositionId === "envoy-ai-gateway",
    );
    if (gateway?.kind !== "kubernetesDirect") {
      throw new Error("Expected Envoy AI Gateway deployment node.");
    }
    const configuration = gateway.spec.configuration as {
      readonly name: string;
      readonly namespace: string;
      readonly instance: { readonly name: string };
    };
    expect(configuration.name).toMatch(/^aigw-[a-f0-9]{12}$/);
    expect(configuration.instance.name).toBe(configuration.name);
    expect(
      `ai-gateway-${configuration.name}-${configuration.namespace}`.length,
    ).toBeLessThanOrEqual(63);
  });
  it("derives a deterministic three-layer ApplicationPlan from the semantic and deployment graphs", () => {
    const base = request();
    const graph: ApplicationGraph = {
      ...base.graph,
      metadata: {
        ...base.graph.metadata,
        sourceLocation: { file: "src/app.ts", line: 1, column: 1 },
      },
      nodes: base.graph.nodes.map((node) => ({
        ...node,
        sourceLocation: { file: "src/app.ts", line: 12, column: 3 },
      })),
      providerRequirements: [{
        id: "requirement.database",
        interface: "TransactionalDatabase",
        consumer: { nodeId: "provider.transactional-database" },
        provider: { interface: "TransactionalDatabase", nodeId: "provider.transactional-database" },
        required: true,
        purpose: "transactionalDatabase",
        diagnostics: { missing: "Database provider is missing.", ambiguous: "Database provider is ambiguous." },
      }],
      providerBindings: [{
        requirement: "requirement.database",
        provider: { interface: "TransactionalDatabase", nodeId: "provider.transactional-database" },
        generatedResources: [],
        runtime: {},
      }],
    };
    const deployment = compileApplicationDeploymentGraph({ ...base, graph }).graph;
    const provider = applicationProviderIdentity({
      application: "guestbook",
      capabilityInterface: "TransactionalDatabase",
      nodeId: "provider.transactional-database",
    });
    const compile = (generatedAt: string) => compileApplicationPlan({
      graph,
      deployment,
      target: "kubernetes",
      lifecycleAuthority: "alchemy",
      generatedAt,
      providerGuarantees: [{
        apiVersion: "applik8s.providerGuarantees/v1alpha1",
        provider,
        capability: {
          interface: "TransactionalDatabase",
          implementation: "postgres",
          version: "unknown",
        },
        targets: ["kubernetes"],
        maturity: "stable",
        guarantees: [{
          id: "transaction-boundary",
          category: "transaction-outbox",
          statement: "One database transaction is authoritative.",
          disposition: "guaranteed",
          evidence: ["postgres-runtime-live"],
        }],
        limitations: [],
        evidenceLevel: "target-live",
      }],
    });
    const first = compile("2026-08-19T12:00:00.000Z");
    const second = compile("2026-08-19T12:05:00.000Z");

    expect(first.sourceGraphVersion).toBe("applik8s.appGraph/v1alpha1");
    expect(first.semantic.nodes).toHaveLength(graph.nodes.length);
    expect(first.semantic).toMatchObject({
      executions: [],
      authority: [],
      dataFlows: [],
      state: [],
      exposures: [],
      observability: [],
    });
    expect(first.resolution.capabilities).toEqual([
      expect.objectContaining({ disposition: "supported", maturity: "stable", guarantees: ["transaction-boundary"] }),
    ]);
    expect(first.physical.nativePlans.map(({ authority }) => authority).sort()).toEqual(["alchemy", "typekro"]);
    expect(validateApplicationPlan(first)).toEqual({ valid: true, diagnostics: [] });
    expect(serializeApplicationPlan(first)).not.toBe(serializeApplicationPlan(second));
    expect(serializeApplicationPlanContent(first)).toBe(serializeApplicationPlanContent(second));
    expect(renderApplicationPlanText(first)).toContain("Providers: 1 resolved, 0 unresolved/incompatible");
    expect(renderApplicationPlanGraph(first)).toContain('flowchart LR');
    expect(renderApplicationPlanGraph(first)).toContain('provider: postgres');
    expect(diffApplicationPlans(first, second)).toMatchObject({
      sourceGraphVersion: "applik8s.appGraph/v1alpha1",
      summary: {
        create: 0,
        update: 0,
        replace: 0,
        delete: 0,
        noOp: expect.any(Number),
      },
      entries: [],
    });
    expect(diffApplicationPlans(first, {
      ...first,
      resolution: {
        capabilities: first.resolution.capabilities.map((capability) => ({ ...capability, maturity: "beta" as const })),
      },
    }).entries).toEqual([
      expect.objectContaining({ category: "maturity", change: "changed" }),
    ]);
    const [firstSemanticNode] = first.semantic.nodes;
    if (!firstSemanticNode) throw new Error("ApplicationPlan fixture has no semantic node.");
    expect(diffApplicationPlans(first, {
      ...first,
      semantic: {
        ...first.semantic,
        nodes: first.semantic.nodes.map((node) => node.id === firstSemanticNode.id
          ? { ...node, provenance: [{ ...node.provenance[0]!, module: "src/moved.ts" }] }
          : node),
      },
    }).entries).toEqual([
      expect.objectContaining({ category: "provenance", change: "changed", severity: "info" }),
    ]);
    expect(diffApplicationPlans(first, {
      ...first,
      semantic: {
        ...first.semantic,
        runtimeAccess: [{
          apiVersion: "applik8s.runtimeAccess/v1alpha1",
          id: "runtime-access:new",
          consumer: { nodeId: firstSemanticNode.graphNodeId, executionIdentity: firstSemanticNode.id },
          target: { capabilityId: "ObjectStorage:exports", operation: "object.write", scope: { kind: "prefix", resourceId: "exports", prefix: "reports/" } },
          origin: "inferred",
          provenance: firstSemanticNode.provenance,
          sensitivity: "internal",
          enforcement: "required",
        }],
      },
    }).entries).toEqual([
      expect.objectContaining({ category: "runtime-access", change: "added", severity: "warning" }),
    ]);
    const unresolved = compileApplicationPlan({
      graph,
      deployment,
      target: "kubernetes",
      lifecycleAuthority: "alchemy",
      generatedAt: "2026-08-19T12:00:00.000Z",
    });
    expect(unresolved.diagnostics).toEqual([
      expect.objectContaining({ code: "PLAN_PROVIDER_GUARANTEES_UNRESOLVED", severity: "error" }),
    ]);
    expect(validateApplicationPlan(unresolved).valid).toBe(false);

    const [nativePlan, ...otherNativePlans] = first.physical.nativePlans;
    if (!nativePlan) throw new Error("ApplicationPlan fixture has no native plan record.");
    const leaked = {
      ...first,
      physical: {
        ...first.physical,
        nativePlans: [{ ...nativePlan, summary: { ...nativePlan.summary, apiKey: "sk-do-not-serialize" } }, ...otherNativePlans],
      },
    };
    expect(validateApplicationPlan(leaked).diagnostics).toEqual([
      expect.objectContaining({ code: "PLAN_SENSITIVE_DATA" }),
    ]);
    expect(() => serializeApplicationPlan(leaked)).toThrow(/PLAN_SENSITIVE_DATA/u);
    expect(() => serializeApplicationPlanContent(leaked)).toThrow(/PLAN_SENSITIVE_DATA/u);

    const nativePlanChanged = {
      ...first,
      physical: {
        ...first.physical,
        nativePlans: [{ ...nativePlan, actions: ["replace" as const] }, ...otherNativePlans],
      },
    };
    expect(diffApplicationPlans(first, nativePlanChanged)).toMatchObject({
      summary: { update: 1 },
      entries: [expect.objectContaining({
        category: "native-plan",
        change: "changed",
        action: "update",
      })],
    });

    const unsupportedCanonicalValue = {
      ...first,
      physical: {
        ...first.physical,
        nativePlans: [{
          ...nativePlan,
          // typecast: adversarial runtime input proves the public validator rejects non-JSON values.
          summary: { ...nativePlan.summary, calculate: (() => "not-json") as never },
        }, ...otherNativePlans],
      },
    };
    expect(validateApplicationPlan(unsupportedCanonicalValue).diagnostics).toEqual([
      expect.objectContaining({ code: "PLAN_CANONICAL_JSON_INVALID" }),
    ]);

    const pii = {
      ...first,
      physical: {
        ...first.physical,
        nativePlans: [{ ...nativePlan, summary: { ...nativePlan.summary, email: "private@example.test" } }, ...otherNativePlans],
      },
    };
    expect(validateApplicationPlan(pii).diagnostics).toEqual([
      expect.objectContaining({ code: "PLAN_SENSITIVE_DATA" }),
    ]);

    const repeatedDiagnosticCode = {
      ...first,
      diagnostics: [
        { severity: "warning" as const, code: "PLAN_PROVIDER_LIMIT", message: "first bounded limit", subjectId: "provider.primary", provenance: [] },
        { severity: "warning" as const, code: "PLAN_PROVIDER_LIMIT", message: "second bounded limit", subjectId: "provider.primary", provenance: [] },
      ],
    };
    expect(validateApplicationPlan(repeatedDiagnosticCode).diagnostics).toEqual([]);
    expect(diffApplicationPlans(first, repeatedDiagnosticCode).entries).toEqual([
      expect.objectContaining({ category: "diagnostic", action: "create" }),
      expect.objectContaining({ category: "diagnostic", action: "create" }),
    ]);

    expect(() => diffApplicationPlans(first, {
      ...first,
      // typecast: runtime readers can receive a newer graph schema despite the v1 compile-time literal.
      sourceGraphVersion: "applik8s.appGraph/v2" as never,
    })).toThrowError(expect.objectContaining({
      code: "PLAN_COMPARISON_GRAPH_VERSION_INCOMPATIBLE",
    }));
    expect(() => diffApplicationPlans(first, {
      ...first,
      application: { ...first.application, id: "applik8s://applications/other" },
    })).toThrowError(expect.objectContaining({
      code: "PLAN_COMPARISON_APPLICATION_MISMATCH",
    }));
  });
});

function request() {
  return {
    graph: applicationGraph(),
    sourceGraphDigest,
    compilerVersion: "0.6.0",
    identity: {
      connection: {
        provider: "kubernetes",
        cluster: "orbstack",
        digest: connectionDigest,
      },
      application: "guestbook",
      controlPlaneNamespace: "applik8s-system",
      instance: "guestbook",
      profile: "local",
    },
    strategy: "kro" as const,
    installationSpec: { name: "guestbook", profile: "local" },
    artifacts: [
      {
        id: "artifact.web",
        artifactType: "containerImage" as const,
        name: "guestbook-web",
        sourceDigest: sourceGraphDigest,
        sourceDescriptor: { context: "./web" },
        logicalReference: "applik8s/guestbook-web:source",
      },
    ],
  };
}

function runtimeWorkloadRequest<T extends ReturnType<typeof request>>(
  base: T,
  name: string,
  executionNodeIds: readonly string[],
  env: readonly DeploymentJsonObject[] = [],
) {
  const image = `applik8s/${name}:source`;
  return {
    ...base,
    artifacts: [
      ...base.artifacts,
      {
        id: `artifact.${name}`,
        artifactType: 'containerImage' as const,
        name,
        sourceDigest: sourceGraphDigest,
        sourceDescriptor: { context: `./${name}` },
        logicalReference: image,
        executionNodeIds,
      },
    ],
    materializedComposition: {
      resources: [{
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, namespace: 'guestbook' },
        spec: {
          template: {
            metadata: { labels: { 'app.kubernetes.io/name': name } },
            spec: { containers: [{ name: 'runtime', image, env }] },
          },
        },
      }],
      status: {},
    },
  };
}

function applicationGraph(): ApplicationGraph {
  return {
    apiVersion: "applik8s.appGraph/v1alpha1",
    kind: "ApplicationGraph",
    metadata: { name: "guestbook" },
    nodes: [
      {
        id: "provider.transactional-database",
        kind: "provider",
        name: "TransactionalDatabase",
        stability: "stable",
        interface: "TransactionalDatabase",
        implementation: "postgres",
        config: {},
      },
    ],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

function scheduleNode(providerId: string): ApplicationScheduleNode {
  return {
    id: "schedule.source.poll.v1",
    kind: "schedule",
    name: "source.poll.v1",
    stability: "stable",
    definition: {
      id: "source.poll.v1",
      configuration: "dynamic",
      input: {
        kind: "declared",
        runtime: "arktype",
        jsonSchema: { type: "object", properties: { sourceId: { type: "string" } }, required: ["sourceId"] },
      },
      timezone: "UTC",
      overlap: "skip",
      misfires: "latest",
      maximumLatenessSeconds: 300,
      retry: { maxAttempts: 4, maximumAgeSeconds: 21_600 },
      requirements: { configuration: "dynamic", cardinality: "bounded", precision: "minute" },
    },
    scheduler: { interface: "Scheduler", nodeId: providerId },
    state: { interface: "TransactionalDatabase", nodeId: "provider.transactional-database" },
    handler: { source: "async () => undefined" },
    functionNative: true,
  };
}

function scheduleManagingGraph(): ApplicationGraph {
  const database = {
    name: 'schedule-state',
    connectionEnvName: 'APPLIK8S_DATABASE_SCHEDULE_STATE_URL',
    secretName: 'schedule-state-app',
    secretKey: 'uri',
    secretNamespace: 'schedule-proof',
  };
  const schedulerId = 'provider.scheduler';
  const schedule = scheduleNode(schedulerId);
  return {
    ...applicationGraph(),
    metadata: { name: 'schedule-proof', namespace: 'schedule-proof' },
    nodes: [
      ...applicationGraph().nodes,
      {
        id: schedulerId,
        kind: 'provider',
        name: 'Scheduler',
        stability: 'stable',
        interface: 'Scheduler',
        implementation: 'kubernetes-cronjob-scheduler',
      },
      schedule,
      {
        id: 'stream.source-binding.changed.v1',
        kind: 'stream',
        name: 'source-binding.changed',
        version: 'v1',
        stability: 'stable',
        payload: {
          kind: 'declared',
          runtime: 'arktype',
          jsonSchema: { type: 'object', properties: {}, required: [] },
        },
        authority: 'postgres-outbox',
        delivery: 'at-least-once',
        replay: 'supported',
        retention: { maxAgeSeconds: 86_400 },
        partitioning: 'declared',
        compatibility: 'versioned-schema',
        authorization: 'application-defined',
        database,
        partitionSource: 'event => event.sourceBindingId',
        authorizationSource: '() => false',
      },
      {
        id: 'streamProcessor.reconcile-source-polling',
        kind: 'streamProcessor',
        name: 'reconcile-source-polling',
        stability: 'stable',
        source: { nodeId: 'stream.source-binding.changed.v1' },
        database,
        handlerSource: 'async () => undefined',
        applicationScheduleBindings: [{
          identifier: 'PollSource',
          schedule: { nodeId: schedule.id },
          scheduler: schedule.scheduler,
        }],
        delivery: 'at-least-once',
        invocation: 'event',
        idempotency: 'source-event-id',
        checkpoint: 'postgres',
        failure: 'pause',
        retry: { mode: 'boundedExponentialBackoff', maxAttempts: 8, initialDelayMs: 250, maxDelayMs: 30_000, factor: 2 },
        deployment: {
          replicas: 1,
          concurrency: 1,
          maxAckPending: 64,
          resources: {
            requests: { cpu: '100m', memory: '128Mi' },
            limits: { cpu: '500m', memory: '512Mi' },
          },
          disruption: { maxUnavailable: 1 },
        },
        budgets: { timeoutMs: 30_000, maxInputBytes: 256_000 },
      },
    ],
    edges: [
      { from: { nodeId: 'streamProcessor.reconcile-source-polling' }, to: { nodeId: schedule.id }, relationship: 'dependsOn' },
      { from: { nodeId: schedulerId }, to: { nodeId: 'streamProcessor.reconcile-source-polling' }, relationship: 'provides' },
      { from: { nodeId: schedule.id }, to: { nodeId: schedulerId }, relationship: 'dependsOn' },
    ],
    providerRequirements: [{
      id: `requirement.${schedule.id}.scheduler`,
      interface: 'Scheduler',
      consumer: { nodeId: schedule.id },
      provider: schedule.scheduler,
      required: true,
      purpose: 'scheduler',
      diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
    }],
    providerBindings: [{
      requirement: `requirement.${schedule.id}.scheduler`,
      provider: schedule.scheduler,
      generatedResources: [],
      runtime: {},
    }],
  };
}
