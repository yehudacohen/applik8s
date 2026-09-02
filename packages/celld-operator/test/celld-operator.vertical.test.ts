// typecast-file-boundary: Fixtures deliberately reconstruct partial Kubernetes and schema values to exercise the operator's public validation and fail-closed boundaries.
import { describe, expect, it } from 'vitest';
import {
  type CelldFleetSpec,
  CelldFleetSpecSchema,
  celldFleetFingerprintAnnotation,
  celldFleetSpecOpenApiSchema,
  celldFleetUidLabel,
  celldOperator,
  celldOperatorInternals,
  classifyCelldVersionTransition,
  effectiveCelldRolloutStrategy,
  renderCelldFleetChildren,
} from '../src/index.js';
import {
  celldFleetCustomResourceDefinitionManifest,
  celldFleetSchemaRevision,
  makeCelldFleetInstallation,
  makeCelldOperatorBootstrap,
} from '../src/typekro.js';

const digest = `sha256:${'a'.repeat(64)}`;
const manifestDigest = `sha256:${'b'.repeat(64)}`;

function fleetSpec(overrides: Partial<CelldFleetSpec> = {}): CelldFleetSpec {
  return {
    artifact: { image: `registry.example.test/celld@${digest}`, manifestDigest, workerVersion: '0.8.0', celldVersion: 'v0.4.0' },
    replicas: 3,
    objectStore: {
      dialect: 's3', bucket: 'actors', prefix: 'tenant-a', region: 'us-east-1',
      credentials: { type: 'secret', secretRef: { name: 'actor-store', contract: 'applik8s.object-store.s3-credentials/v1' } },
    },
    runtimeSecretRef: { name: 'actor-runtime', contract: 'applik8s.celld-runtime/v1' },
    applicationEndpoint: 'http://application.default.svc.cluster.local:8080',
    ingressNamespaces: ['ingress-system'],
    rollout: { strategy: 'Rolling', progressDeadlineSeconds: 900, drainDeadlineSeconds: 300, restoreDeadlineSeconds: 600 },
    deletion: { dataPolicy: 'Retain', drainTimeoutPolicy: 'Block' },
    ...overrides,
  };
}

describe('@applik8s/celld-operator', () => {
  it('renders one UID-leased, digest-bound fleet without owning external durable data', () => {
    const children = renderCelldFleetChildren({
      identity: { name: 'actors', namespace: 'tenant-a', uid: 'fleet-uid', generation: 7 },
      spec: fleetSpec(), fingerprint: `${manifestDigest}:7`, rolloutPartition: 2,
    });
    expect(children.all.map(resource => resource.kind)).toEqual([
      'ServiceAccount', 'Service', 'Service', 'Job', 'StatefulSet', 'NetworkPolicy', 'PodDisruptionBudget',
    ]);
    for (const child of children.all) {
      expect(child.metadata.ownerReferences).toContainEqual(expect.objectContaining({ uid: 'fleet-uid', controller: true }));
      expect(child.metadata.labels?.[celldFleetUidLabel]).toBe('fleet-uid');
      expect(child.metadata.annotations?.[celldFleetFingerprintAnnotation]).toBe(
        child.kind === 'Job' ? manifestDigest : `${manifestDigest}:7`,
      );
    }
    expect(children.deploymentJob.metadata.name).toBe('actors-deploy-bbbbbbbbbbbb');
    expect(children.deploymentJob.metadata.labels?.['app.kubernetes.io/component']).toBe('actor-deployer');
    expect(children.statefulSet.metadata.labels?.['app.kubernetes.io/component']).toBe('actor-runtime');
    expect(children.podDisruptionBudget).toMatchObject({
      spec: { selector: { matchLabels: { 'app.kubernetes.io/component': 'actor-runtime' } } },
    });
    expect(children.statefulSet).toMatchObject({
      spec: {
        replicas: 3,
        updateStrategy: { type: 'RollingUpdate', rollingUpdate: { partition: 2 } },
        template: { spec: { containers: [{ image: `registry.example.test/celld@${digest}` }] } },
      },
    });
    const serialized = JSON.stringify(children.all);
    expect(serialized).toContain('/.well-known/celld/health');
    expect(serialized).toContain('operator-authorization');
    expect(serialized).toContain('actor-deployer');
    expect(serialized).toContain('applik8s-celld-operator');
    expect(serialized).not.toContain('APPLIK8S_CELLD_RUNTIME_MANIFEST_DIGEST');
    expect(serialized).not.toContain('PersistentVolumeClaim');
  });

  it('keeps artifact deployment Jobs stable across replica-only generations', () => {
    const first = renderCelldFleetChildren({
      identity: { name: 'actors', namespace: 'tenant-a', uid: 'fleet-uid', generation: 7 },
      spec: fleetSpec({ replicas: 3 }), fingerprint: `${manifestDigest}:7`, rolloutPartition: 2,
    });
    const scaled = renderCelldFleetChildren({
      identity: { name: 'actors', namespace: 'tenant-a', uid: 'fleet-uid', generation: 8 },
      spec: fleetSpec({ replicas: 1 }), fingerprint: `${manifestDigest}:8`, rolloutPartition: 0,
    });

    expect(scaled.deploymentJob).toEqual(first.deploymentJob);
    expect(scaled.statefulSet).not.toEqual(first.statefulSet);
  });

  it('projects bounded worker configuration and Secret references into both Celld phases', () => {
    const spec = fleetSpec({
      runtime: {
        environment: [{ name: 'APPLIK8S_CODE_AGENT_MODEL_ID', value: 'coding-model' }],
        secretEnvironment: [{
          name: 'APPLIK8S_CODE_AGENT_MODEL_API_KEY',
          secretRef: { name: 'code-agent-model', key: 'api-key' },
        }],
      },
    });
    expect(() => CelldFleetSpecSchema.assert(spec)).not.toThrow();
    const children = renderCelldFleetChildren({
      identity: { name: 'code-agents', namespace: 'tenant-a', uid: 'fleet-uid', generation: 1 },
      spec,
      fingerprint: `${manifestDigest}:1`,
      rolloutPartition: 0,
    });
    for (const resource of [children.deploymentJob, children.statefulSet]) {
      const serialized = JSON.stringify(resource);
      expect(serialized).toContain('CELLD_VAR_APPLIK8S_CODE_AGENT_MODEL_ID');
      expect(serialized).toContain('coding-model');
      expect(serialized).toContain('CELLD_VAR_APPLIK8S_CODE_AGENT_MODEL_API_KEY');
      expect(serialized).toContain('code-agent-model');
      expect(serialized).toContain('api-key');
    }
    expect(JSON.stringify(children.all)).not.toContain('model-secret-value');
    expect(() => renderCelldFleetChildren({
      identity: { name: 'code-agents', namespace: 'tenant-a', uid: 'fleet-uid', generation: 1 },
      spec: fleetSpec({
        runtime: {
          environment: [{ name: 'DUPLICATE', value: 'public' }],
          secretEnvironment: [{ name: 'DUPLICATE', secretRef: { name: 'runtime', key: 'value' } }],
        },
      }),
      fingerprint: `${manifestDigest}:1`,
      rolloutPartition: 0,
    })).toThrow(/DUPLICATE has more than one source/u);
  });

  it('renders the release-specific readiness endpoint across the v0.3 to v0.4 boundary', () => {
    const historical = renderCelldFleetChildren({
      identity: { name: 'actors', namespace: 'tenant-a', uid: 'fleet-uid', generation: 1 },
      spec: fleetSpec({ artifact: { ...fleetSpec().artifact, celldVersion: 'v0.3.0' } }),
      fingerprint: `${manifestDigest}:1`,
      rolloutPartition: 0,
    });
    expect(JSON.stringify(historical.statefulSet)).toContain('/__celld/health');
    expect(JSON.stringify(historical.statefulSet)).not.toContain('/.well-known/celld/health');
  });

  it('distinguishes a historical artifact receipt from the receipt created for the active rollout', () => {
    expect(celldOperatorInternals.classifyArtifactDeploymentReceipt(
      '2026-08-26T11:59:59.000Z',
      '2026-08-26T12:00:00.000Z',
    )).toBe('historical');
    expect(celldOperatorInternals.classifyArtifactDeploymentReceipt(
      '2026-08-26T12:00:01.000Z',
      '2026-08-26T12:00:00.000Z',
    )).toBe('current');
    expect(celldOperatorInternals.classifyArtifactDeploymentReceipt(
      undefined,
      '2026-08-26T12:00:00.000Z',
    )).toBe('unverifiable');
    expect(celldOperatorInternals.classifyArtifactDeploymentReceipt(
      'not-a-time',
      '2026-08-26T12:00:00.000Z',
    )).toBe('unverifiable');
  });

  it('automatically prevents unqualified mixed-version Celld rollouts', () => {
    expect(classifyCelldVersionTransition(undefined, '0.2.1')).toBe('unchanged');
    expect(classifyCelldVersionTransition('0.2.1', '0.2.1')).toBe('unchanged');
    expect(classifyCelldVersionTransition('0.2.1', '0.3.0')).toBe('requiresRecreate');
    expect(effectiveCelldRolloutStrategy('0.2.1', '0.3.0', 'Rolling')).toBe('Recreate');
    expect(effectiveCelldRolloutStrategy('0.3.0', '0.4.0', 'Rolling')).toBe('Recreate');
    expect(effectiveCelldRolloutStrategy('0.3.0', '0.3.0', 'Rolling')).toBe('Rolling');
    expect(effectiveCelldRolloutStrategy('0.3.0', '0.3.0', 'Recreate')).toBe('Recreate');
  });

  it('does not repeatedly delete the replacement StatefulSet before its first pod is ready', () => {
    const replacement = {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: { name: 'actors', namespace: 'tenant-a' },
      spec: {
        template: {
          spec: { containers: [{ name: 'celld', image: `registry.example.test/celld@${digest}` }] },
        },
      },
    };
    expect(celldOperatorInternals.statefulSetUsesImageDigest(replacement, digest)).toBe(true);
    expect(celldOperatorInternals.statefulSetUsesImageDigest(replacement, `sha256:${'b'.repeat(64)}`)).toBe(false);
  });

  it('proves a zero-pod boundary before recreating an incompatible Celld fleet', async () => {
    const oldPod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'actors-0', namespace: 'tenant-a' },
      spec: { containers: [{ name: 'celld', image: `registry.example.test/celld@sha256:${'c'.repeat(64)}` }] },
      status: { phase: 'Terminating' },
    };
    const fleet = {
      apiVersion: 'celld.applik8s.io/v1alpha1',
      kind: 'CelldFleet',
      metadata: { name: 'actors', namespace: 'tenant-a' },
      spec: fleetSpec({ replicas: 1 }),
      status: {},
    };

    await expect(celldOperatorInternals.reconcileRolloutState(
      fleet as never,
      undefined,
      [oldPod] as never,
      'tenant-a',
      digest,
      'Recreate',
    )).resolves.toMatchObject({ waitForFleetStop: true, waitingOn: 'previous fleet termination' });
    await expect(celldOperatorInternals.reconcileRolloutState(
      fleet as never,
      undefined,
      [],
      'tenant-a',
      digest,
      'Recreate',
    )).resolves.toEqual({ partition: 0, restoreBlocked: false });
  });

  it('does not create or own a caller-supplied workload-identity ServiceAccount', () => {
    const children = renderCelldFleetChildren({
      identity: { name: 'actors', namespace: 'tenant-a', uid: 'fleet-uid', generation: 1 },
      spec: fleetSpec({
        objectStore: {
          dialect: 's3', bucket: 'actors', prefix: '', region: 'us-east-1',
          credentials: { type: 'workloadIdentity', serviceAccountRef: { name: 'externally-owned' } },
        },
      }),
      fingerprint: `${manifestDigest}:1`, rolloutPartition: 0,
    });
    expect(children.all.some(resource => resource.kind === 'ServiceAccount')).toBe(false);
    expect(JSON.stringify(children.statefulSet)).toContain('externally-owned');
  });

  it('exposes an ordinary Applik8s reconcile/finalize operator contract', () => {
    expect(celldOperator.definition).toMatchObject({ name: 'applik8s-celld-operator' });
    expect(celldOperator.definition.handlers).toHaveLength(2);
    expect(celldOperator.definition.secondaryWatches).toHaveLength(7);
    expect(celldOperator.definition.resources.CelldFleet.plural).toBe('celldfleets');
  });

  it('keeps the singleton control plane separate from each fleet installation', () => {
    const owned = makeCelldOperatorBootstrap().factory('direct').toYaml({
      image: `ghcr.io/applik8s/celld-operator@${digest}`, replicas: 2,
    });
    const external = makeCelldOperatorBootstrap({ namespace: 'platform-system' }).factory('direct').toYaml({
      image: `ghcr.io/applik8s/celld-operator@${digest}`, replicas: 2,
    });
    expect(owned).toContain('kind: Namespace');
    expect(owned).toContain('name: applik8s-celld-system');
    expect(external).not.toContain('kind: Namespace');
    expect(external).toContain('namespace: platform-system');
    expect(external).toContain('kind: CustomResourceDefinition');
    expect(external).toContain('kind: PodDisruptionBudget');
    expect(external).toContain('maxSurge: 100%');
    expect(external).toContain('maxUnavailable: 0');
    expect(external).toContain('APPLIK8S_HEALTH_ADDR');
    expect(external).toContain('0.0.0.0:8081');
    expect(external).toContain('pods/proxy');
    expect(external).toContain('services/proxy');

    const fleet = makeCelldFleetInstallation('tenant-a').factory('direct').toYaml({ name: 'actors', fleet: fleetSpec() });
    expect(fleet).toContain('kind: CelldFleet');
    expect(fleet).not.toContain('kind: StatefulSet');
    expect(fleet).not.toContain('kind: Namespace');
  });

  it('waits for current-generation fleet readiness before publishing status outputs', () => {
    const composition = makeCelldFleetInstallation('tenant-a');
    if (!composition.plan) throw new Error('CelldFleet installation must expose semantic planning.');
    const plan = composition.plan({
      name: 'actors',
      fleet: fleetSpec(),
    });
    expect(plan.nodes).toContainEqual(expect.objectContaining({
      id: 'celldFleet',
      readinessStrategy: {
        kind: 'registered',
        id: 'applik8s.readiness.celld-fleet',
        revision: '1',
      },
    }));
    expect(plan.outputs.endpoint).toMatchObject({
      kind: 'reference',
      source: 'resource',
      resourceId: 'celldFleet',
      fieldPath: 'status.endpoint',
    });
  });

  it('publishes structural admission for immutable artifacts and exact credential selection', () => {
    const crd = celldFleetCustomResourceDefinitionManifest();
    const serialized = JSON.stringify(crd);
    expect(serialized).toContain('sha256:');
    expect(serialized).toContain('applik8s.celld-runtime/v1');
    expect(serialized).toContain('applik8s.object-store.s3-credentials/v1');
    expect(serialized).toContain('credentials must select exactly one Secret or workload identity source');
    expect(serialized).toContain('observedWorkerVersion');
    expect(crd.metadata.annotations['celld.applik8s.io/schema-revision']).toBe(celldFleetSchemaRevision);
    expect(celldFleetSpecOpenApiSchema.properties.artifact.properties.image.pattern).toContain('sha256:');
    expect(() => CelldFleetSpecSchema.assert({ ...fleetSpec(), artifact: { ...fleetSpec().artifact, image: digest } })).not.toThrow();
    expect(() => CelldFleetSpecSchema.assert({ ...fleetSpec(), artifact: { ...fleetSpec().artifact, image: 'registry.example.test/celld:mutable' } })).toThrow();
    const objectStoreSecretName = celldFleetSpecOpenApiSchema.properties.objectStore.properties.credentials.properties.secretRef.properties.name;
    const runtimeSecretName = celldFleetSpecOpenApiSchema.properties.runtimeSecretRef.properties.name;
    expect(objectStoreSecretName.maxLength).toBe(253);
    expect(objectStoreSecretName.pattern).toContain('[a-z0-9]');
    expect(runtimeSecretName).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 253,
      pattern: objectStoreSecretName.pattern,
    });
  });

  it('preserves condition transition timestamps until the condition status changes', () => {
    const first = celldOperatorInternals.conditions(7, '2026-08-26T12:00:00.000Z', 'Progressing', 'Converging', 'Waiting.');
    const unchanged = celldOperatorInternals.conditions(7, '2026-08-26T12:01:00.000Z', 'Progressing', 'StillConverging', 'Still waiting.', first);
    expect(unchanged.find(condition => condition.type === 'Progressing')?.lastTransitionTime)
      .toBe('2026-08-26T12:00:00.000Z');
    const ready = celldOperatorInternals.conditions(7, '2026-08-26T12:02:00.000Z', 'Ready', 'FleetReady', 'Ready.', unchanged);
    expect(ready.find(condition => condition.type === 'Ready')?.lastTransitionTime)
      .toBe('2026-08-26T12:02:00.000Z');
    expect(ready.find(condition => condition.type === 'Progressing')?.lastTransitionTime)
      .toBe('2026-08-26T12:02:00.000Z');
  });

  it('suppresses self-triggering applies when every operator-owned field already converged', () => {
    expect(celldOperatorInternals.containsDesiredValue({
      metadata: { name: 'actors', resourceVersion: '42', labels: { managed: 'true', foreign: 'retained' } },
      spec: { replicas: 2, clusterIP: '10.0.0.1' },
      status: { readyReplicas: 2 },
    }, {
      metadata: { name: 'actors', labels: { managed: 'true' } },
      spec: { replicas: 2 },
    })).toBe(true);
    expect(celldOperatorInternals.containsDesiredValue(
      { spec: { replicas: 1 } },
      { spec: { replicas: 2 } },
    )).toBe(false);
  });

  it('blocks finalization until every live Celld node clears restore and eviction work', () => {
    expect(celldOperatorInternals.blockingNodeStateEvidence([
      { pod: 'actors-0', state: { ok: true, evicting: 0, restoring: 0 } },
      { pod: 'actors-1', state: { ok: true, evicting: 1, restoring: 0 } },
      { pod: 'actors-2', state: { ok: false, evicting: 0, restoring: 0 } },
    ])).toEqual([
      'actors-1 (1 evicting, 0 restoring)',
      'actors-2 (state unavailable)',
    ]);
  });

  it('recognizes the restart-safe scale-to-zero finalization checkpoint', () => {
    expect(celldOperatorInternals.statefulSetDesiredReplicas({ spec: { replicas: 0 } } as never)).toBe(0);
    expect(celldOperatorInternals.statefulSetDesiredReplicas({ spec: { replicas: 2 } } as never)).toBe(2);
  });
});
