// typecast-file-boundary: live Kubernetes observations are narrowed only after
// exact namespace, kind, readiness, and actor-protocol assertions.
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  actor,
  app,
  installApplicationActorRuntimeResolver,
  type,
  withApplicationActorTurnAuthority,
} from '@applik8s/applik8s';
import { celldRuntimeSecretV1 } from '@applik8s/celld-operator';
import { celldFleetSchemaRevision } from '@applik8s/celld-operator/typekro';
import { createCompilerPipeline, emitApplicationDeploymentGraph } from '@applik8s/compiler';
import type { ApplicationGraph } from '@applik8s/core';
import {
  type ApplicationAlchemyDeployment,
  createApplicationAlchemyGraphDeployment,
} from '@applik8s/deployment-alchemy';
import {
  type ApplicationCelldRuntimeRelease,
  applicationCelldRuntimeRelease,
} from '@applik8s/deployment-compiler';
import type { ApplicationTypeKroCompositionSource } from '@applik8s/deployment-typekro';
import { createCelldApplicationActorRuntime } from '@applik8s/runtime-celld';
import { kubernetesComposition } from 'typekro';
import { expect, it } from 'vitest';
import { createActorLiveAuthority } from './actor-live-authority.js';
import {
  assertExpectedKubectlContext,
  describeLive,
  docker,
  kubectl,
  sleep,
} from './live-e2e-helpers.js';

const historicalCelldRuntimeRelease = {
  image: 'ghcr.io/denoland/celld@sha256:f47d97c2980aa98aef1d9c42205a313442f48acb606c5987dbb9b32983a23aaf',
  version: 'v0.3.0',
} as const satisfies ApplicationCelldRuntimeRelease;

describeLive('v0.8 AC-2b operator-owned Celld Kubernetes lifecycle on OrbStack', () => {
  it('qualifies TypeKro bootstrap, CelldFleet reconciliation, failure repair, rollout, and finalization', async () => {
    await assertExpectedKubectlContext();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const application = `v08-celld-k8s-${suffix}`;
    const namespace = application;
    const instance = 'qualification';
    const projectRoot = await mkdtemp(join(tmpdir(), 'applik8s-v08-celld-k8s-'));
    const stateRoot = join(projectRoot, '.alchemy-state');
    const source = actorLifecycleSource(application);
    let deployment: ApplicationAlchemyDeployment | undefined;
    let portForward: PortForward | undefined;
    let uninstallRuntime: (() => void) | undefined;
    const builtImages = new Set<string>();
    let destroyed = false;
    let secondaryNamespace: string | undefined;
    let secondaryFleetName: string | undefined;
    let testFailure: unknown;
    const cleanupErrors: string[] = [];

    try {
      await preflightActorKubernetesLifecycle(namespace);
      const initialGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 2,
        sourceGraphDigest: `sha256:${'b'.repeat(64)}`,
        celldRuntimeRelease: historicalCelldRuntimeRelease,
        operatorBuildRevision: 'qualification-prior',
      });
      const initialRuntimeManifest = requiredCelldRuntimeManifest(initialGraph);
      expect(initialGraph.edges).toContainEqual({
        from: 'direct.provider.ObjectStorage.local-s3',
        to: 'direct.provider.ActorRuntime.celld',
        relationship: 'requiresReady',
      });
      expect(initialGraph.edges).toContainEqual({
        from: 'artifact.operator.applik8s-celld-operator',
        to: 'direct.provider.ActorRuntime.celld-operator',
        relationship: 'requiresOutput',
        output: 'immutableReference',
      });
      deployment = await actorLifecycleDeployment({
        graph: initialGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const applied = await deployment.apply();
      const initialCelldArtifact = requiredDeploymentArtifact(
        applied.artifacts,
        'artifact.celld-runtime',
      );
      const initialOperatorArtifact = requiredDeploymentArtifact(
        applied.artifacts,
        'artifact.operator.applik8s-celld-operator',
      );
      for (const artifact of applied.artifacts) {
        builtImages.add(artifact.taggedReference);
      }

      await waitForJson(
        ['get', `deployment/${application}-objects`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 1,
        180_000,
        'local S3 Deployment readiness',
      );
      await waitForJson(
        [
          'get', 'jobs', '--namespace', namespace,
          '--selector', `celld.applik8s.io/fleet=${application}-actors`,
          '--output=json',
        ],
        value => resourceList(value).some(item => nestedNumber(item, 'status', 'succeeded') === 1),
        240_000,
        'operator-owned digest deployment Job completion',
      );
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 2,
        240_000,
        'two-node Celld StatefulSet readiness',
      );
      await expectKubernetesResource(namespace, 'service', `${application}-actors`);
      await expectKubernetesResource(namespace, 'service', `${application}-actors-peers`);
      await expectKubernetesResource(namespace, 'networkpolicy', `${application}-actors-private`);
      const fleet = await waitForJson(
        ['get', `celldfleet/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedString(value, 'status', 'phase') === 'Ready'
          && nestedString(value, 'status', 'observedArtifactManifestDigest') === initialRuntimeManifest.manifestDigest
          && nestedString(value, 'status', 'observedWorkerVersion') === initialRuntimeManifest.workerVersion
          && nestedString(value, 'status', 'observedCelldVersion') === initialRuntimeManifest.celldVersion,
        240_000,
        'CelldFleet Ready status with digest-bound runtime evidence',
      );
      const fleetUid = nestedString(fleet, 'metadata', 'uid');
      if (!fleetUid) throw new Error('CelldFleet did not expose metadata.uid.');
      await assertFleetChildOwnership(namespace, `${application}-actors`, fleetUid);

      // The operator bootstrap is cluster-shared, while every fleet and its
      // children are application-owned. Exercise two namespaces concurrently
      // so deleting one application cannot be mistaken for authority to remove
      // the singleton controller or the other fleet.
      secondaryNamespace = `${application}-peer`;
      secondaryFleetName = `${application}-peer-actors`;
      await installSecondaryFleet({
        primaryFleet: fleet,
        primaryNamespace: namespace,
        secondaryNamespace,
        secondaryFleetName,
        projectRoot,
      });
      const secondaryFleet = await waitForJson(
        ['get', `celldfleet/${secondaryFleetName}`, '--namespace', secondaryNamespace, '--output=json'],
        value => nestedString(value, 'status', 'phase') === 'Ready',
        240_000,
        'second application CelldFleet Ready status',
      );
      const secondaryFleetUid = nestedString(secondaryFleet, 'metadata', 'uid');
      if (!secondaryFleetUid) throw new Error('Second CelldFleet did not expose metadata.uid.');
      await assertFleetChildOwnership(secondaryNamespace, secondaryFleetName, secondaryFleetUid);

      const authorization = await secretValue(
        namespace,
        `${application}-actors-authorization`,
        celldRuntimeSecretV1.keys.actorAuthorization,
      );
      portForward = await startPortForward(
        namespace,
        `pod/${application}-actors-0`,
        8080,
      );
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);

      const Counter = app(application).actor(`${application}-counter.v1`, {
        key: type('string'),
        state: type({ count: 'number.integer >= 0' }),
        protocol: {
          increment: actor.command({
            input: type({ by: 'number.integer > 0' }),
            output: type({ count: 'number.integer >= 0' }),
          }),
          read: actor.command({
            input: type({}),
            output: type({ count: 'number.integer >= 0' }),
          }),
        },
      });
      Counter.on.initialize(() => ({ count: 0 }));
      Counter.on.increment(async (turn, input) => {
        const current = await turn.state();
        const count = current.count + input.by;
        await turn.setState({ count });
        return { count };
      });
      Counter.on.read(turn => turn.state());
      const admitted = <T>(
        member: string,
        input: object,
        callback: () => Promise<T>,
      ) => withApplicationActorTurnAuthority(
        createActorLiveAuthority(
          application,
          Counter.id,
          member,
          'workspace-a',
          input,
        ),
        callback,
      );
      uninstallRuntime = installApplicationActorRuntimeResolver(() =>
        createCelldApplicationActorRuntime({
          endpoint: portForward?.endpoint ?? 'http://127.0.0.1:1',
          authorization,
          leaseDuration: '10s',
          heartbeatInterval: '2s',
          admissionTimeout: '60s',
          retryDelay: '250ms',
        }));

      await expect(admitted('increment', { by: 2 }, () =>
        Counter.increment('workspace-a', { by: 2 }, {
          idempotencyKey: 'initial-increment',
        }))).resolves.toEqual({ count: 2 });
      await expect(admitted('increment', { by: 2 }, () =>
        Counter.increment('workspace-a', { by: 2 }, {
          idempotencyKey: 'initial-increment',
        }))).resolves.toEqual({ count: 2 });

      await kubectl([
        'delete', 'pod', `${application}-actors-0`, '--namespace', namespace,
        '--wait=true', '--timeout=120s',
      ]);
      await portForward.close();
      portForward = await startPortForward(
        namespace,
        `pod/${application}-actors-1`,
        8080,
      );
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);
      await expectEventually(
        () => admitted('increment', { by: 3 }, () =>
          Counter.increment('workspace-a', { by: 3 }, {
            idempotencyKey: 'after-pod-loss',
          })),
        { count: 5 },
        120_000,
      );
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 2,
        180_000,
        'Celld StatefulSet recovery after pod loss',
      );

      const updatedGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 1,
        sourceGraphDigest: `sha256:${'c'.repeat(64)}`,
        celldRuntimeRelease: historicalCelldRuntimeRelease,
        operatorBuildRevision: 'qualification-prior',
      });
      const updatedRuntimeManifest = requiredCelldRuntimeManifest(updatedGraph);
      expect(updatedRuntimeManifest.manifestDigest).not.toBe(initialRuntimeManifest.manifestDigest);
      deployment = await actorLifecycleDeployment({
        graph: updatedGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const updatePlan = await deployment.plan();
      expect(updatePlan.changes.some(({ action }) =>
        action === 'update' || action === 'replace')).toBe(true);
      const update = deployment.apply();
      await waitForJson(
        ['get', `celldfleet/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'spec', 'replicas') === 1,
        120_000,
        'CelldFleet update admission before operator restart',
      );
      await kubectl([
        'delete', 'pod', '--namespace', 'applik8s-celld-system',
        '--selector', 'app.kubernetes.io/name=applik8s-celld-operator',
        '--wait=true', '--timeout=120s',
      ]);
      const updated = await update;
      const updatedCelldArtifact = requiredDeploymentArtifact(
        updated.artifacts,
        'artifact.celld-runtime',
      );
      expect(updatedCelldArtifact.sourceDigest).not.toBe(initialCelldArtifact.sourceDigest);
      expect(updatedCelldArtifact.immutableReference).not.toBe(initialCelldArtifact.immutableReference);
      for (const artifact of updated.artifacts) {
        builtImages.add(artifact.taggedReference);
      }
      await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedNumber(value, 'spec', 'replicas') === 1
          && nestedNumber(value, 'status', 'readyReplicas') === 1,
        240_000,
        'one-node Celld rolling update',
      );
      await waitForJson(
        ['get', `celldfleet/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedString(value, 'status', 'phase') === 'Ready'
          && nestedString(value, 'status', 'observedArtifactManifestDigest') === updatedRuntimeManifest.manifestDigest,
        240_000,
        'updated digest-bound runtime manifest observation',
      );
      await portForward.close();
      portForward = await startPortForward(
        namespace,
        `pod/${application}-actors-0`,
        8080,
      );
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);
      await expectEventually(
        () => admitted('read', {}, () =>
          Counter.read('workspace-a', {}, {
            idempotencyKey: `read-after-rollout-${randomUUID()}`,
          })),
        { count: 5 },
        120_000,
      );

      const rollingStatefulSet = await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        () => true,
        30_000,
        'pre-Celld-upgrade StatefulSet identity',
      );
      const rollingStatefulSetUid = requiredString(
        requiredObject(rollingStatefulSet, 'metadata'),
        'uid',
      );
      const celldUpgradeGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 1,
        sourceGraphDigest: `sha256:${'c'.repeat(64)}`,
        operatorBuildRevision: 'qualification-prior',
      });
      const celldUpgradeManifest = requiredCelldRuntimeManifest(celldUpgradeGraph);
      expect(celldUpgradeManifest.applicationGraphDigest).toBe(updatedRuntimeManifest.applicationGraphDigest);
      expect(celldUpgradeManifest.celldVersion).toBe(applicationCelldRuntimeRelease.version);
      expect(celldUpgradeManifest.celldVersion).not.toBe(updatedRuntimeManifest.celldVersion);
      deployment = await actorLifecycleDeployment({
        graph: celldUpgradeGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const celldUpgradePlan = await deployment.plan();
      expect(celldUpgradePlan.changes.some(({ action }) =>
        action === 'update' || action === 'replace')).toBe(true);
      const celldUpgrade = await deployment.apply();
      const celldUpgradeArtifact = requiredDeploymentArtifact(
        celldUpgrade.artifacts,
        'artifact.celld-runtime',
      );
      expect(celldUpgradeArtifact.immutableReference).not.toBe(updatedCelldArtifact.immutableReference);
      for (const artifact of celldUpgrade.artifacts) builtImages.add(artifact.taggedReference);
      const recreatedStatefulSet = await waitForJson(
        ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedString(value, 'metadata', 'uid') !== rollingStatefulSetUid
          && nestedNumber(value, 'status', 'readyReplicas') === 1,
        300_000,
        'Celld v0.3.0 to v0.4.0 stop-before-start Recreate rollout',
      );
      const recreatedStatefulSetUid = requiredString(
        requiredObject(recreatedStatefulSet, 'metadata'),
        'uid',
      );
      await waitForJson(
        ['get', `celldfleet/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedString(value, 'status', 'phase') === 'Ready'
          && nestedString(value, 'status', 'observedArtifactManifestDigest') === celldUpgradeManifest.manifestDigest
          && nestedString(value, 'status', 'observedCelldVersion') === applicationCelldRuntimeRelease.version,
        300_000,
        'Celld v0.4.0 digest-bound runtime observation',
      );
      await portForward.close();
      portForward = await startPortForward(namespace, `pod/${application}-actors-0`, 8080);
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);
      await expectEventually(
        () => admitted('read', {}, () =>
          Counter.read('workspace-a', {}, {
            idempotencyKey: `read-after-celld-upgrade-${randomUUID()}`,
          })),
        { count: 5 },
        120_000,
      );

      // Roll back to the previous immutable runtime artifact after the new
      // artifact has served real actor traffic. This exercises Alchemy's
      // persisted artifact identity, the operator's replacement Job, the
      // StatefulSet rollout, and Celld state continuity in the reverse
      // direction rather than treating rollback as a render-only promise.
      const rollbackGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 1,
        sourceGraphDigest: `sha256:${'b'.repeat(64)}`,
        celldRuntimeRelease: historicalCelldRuntimeRelease,
        operatorBuildRevision: 'qualification-prior',
      });
      deployment = await actorLifecycleDeployment({
        graph: rollbackGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const rollbackPlan = await deployment.plan();
      expect(rollbackPlan.changes.some(({ action }) =>
        action === 'update' || action === 'replace')).toBe(true);
      const rollback = await deployment.apply();
      const rolledBackCelldArtifact = requiredDeploymentArtifact(
        rollback.artifacts,
        'artifact.celld-runtime',
      );
      expect(rolledBackCelldArtifact.sourceDigest).toBe(initialCelldArtifact.sourceDigest);
      expect(rolledBackCelldArtifact.immutableReference).toBe(initialCelldArtifact.immutableReference);
      for (const artifact of rollback.artifacts) {
        builtImages.add(artifact.taggedReference);
      }
      try {
        const rolledBackFleet = await waitForJson(
          ['get', `celldfleet/${application}-actors`, '--namespace', namespace, '--output=json'],
          value =>
            nestedString(value, 'status', 'phase') === 'Ready'
            && nestedString(value, 'status', 'observedArtifactManifestDigest') === initialRuntimeManifest.manifestDigest
            && nestedString(value, 'status', 'observedCelldVersion') === historicalCelldRuntimeRelease.version,
          240_000,
          'rolled-back digest-bound runtime manifest observation',
        );
        expect(nestedString(rolledBackFleet, 'status', 'observedCelldVersion'))
          .toBe(historicalCelldRuntimeRelease.version);
        const rollbackStatefulSet = await waitForJson(
          ['get', `statefulset/${application}-actors`, '--namespace', namespace, '--output=json'],
          value =>
            nestedString(value, 'metadata', 'uid') !== recreatedStatefulSetUid
            && nestedNumber(value, 'status', 'readyReplicas') === 1,
          300_000,
          'Celld v0.4.0 to v0.3.0 stop-before-start Recreate rollback',
        );
        expect(nestedString(rollbackStatefulSet, 'metadata', 'uid')).not.toBe(recreatedStatefulSetUid);
      } catch (cause) {
        throw new Error(
          `${errorMessage(cause)}\nRollback diagnostics:\n${await celldRollbackDiagnostics(namespace, `${application}-actors`)}`,
          { cause },
        );
      }
      await portForward.close();
      portForward = await startPortForward(
        namespace,
        `pod/${application}-actors-0`,
        8080,
      );
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);
      await expectEventually(
        () => admitted('read', {}, () =>
          Counter.read('workspace-a', {}, {
            idempotencyKey: `read-after-rollback-${randomUUID()}`,
          })),
        { count: 5 },
        120_000,
      );

      const priorOperatorDeployment = await waitForJson(
        ['get', 'deployment/applik8s-celld-operator', '--namespace', 'applik8s-celld-system', '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 2,
        60_000,
        'prior Celld operator Deployment',
      );
      const priorOperatorImage = kubernetesContainerImage(priorOperatorDeployment, 'operator');
      const priorCrd = await installPriorCelldFleetCrdFixture(new Set([fleetUid, secondaryFleetUid]));
      const priorCrdResourceVersion = nestedString(priorCrd, 'metadata', 'resourceVersion');
      expect(priorCrdResourceVersion).toBeDefined();
      const operatorUpgradeGraph = await emitActorLifecycleGraph({
        application,
        namespace,
        projectRoot,
        replicas: 1,
        sourceGraphDigest: `sha256:${'b'.repeat(64)}`,
        celldRuntimeRelease: historicalCelldRuntimeRelease,
        operatorBuildRevision: 'qualification-current',
      });
      deployment = await actorLifecycleDeployment({
        graph: operatorUpgradeGraph,
        source,
        stateRoot,
        instance,
        namespace,
      });
      const operatorUpgradePlan = await deployment.plan();
      expect(operatorUpgradePlan.changes.some(({ id, action }) =>
        (id === 'artifact.operator.applik8s-celld-operator' || id === 'deploymentApplik8sCelldOperator')
        && (action === 'update' || action === 'replace'))).toBe(true);
      expect(operatorUpgradePlan.changes).toContainEqual(expect.objectContaining({
        id: 'customresourcedefinitionCelldfleets.celld.applik8s.io',
        action: 'update',
      }));
      const operatorUpgradePromise = deployment.apply();
      await waitForJson(
        ['get', 'deployment/applik8s-celld-operator', '--namespace', 'applik8s-celld-system', '--output=json'],
        value => kubernetesContainerImage(value, 'operator') !== priorOperatorImage,
        120_000,
        'Celld operator image update admission',
      );
      await kubectl([
        'delete', 'pod', '--namespace', 'applik8s-celld-system',
        '--selector', 'app.kubernetes.io/name=applik8s-celld-operator',
        '--wait=true', '--timeout=120s',
      ]);
      const operatorUpgrade = await operatorUpgradePromise;
      await waitForJson(
        ['get', 'customresourcedefinition/celldfleets.celld.applik8s.io', '--output=json'],
        value =>
          celldFleetCrdRevision(value) === celldFleetSchemaRevision
          && celldFleetCrdHasSpecProperty(value, 'placement')
          && nestedString(value, 'metadata', 'resourceVersion') !== priorCrdResourceVersion,
        120_000,
        'CelldFleet CRD schema migration',
      );
      const upgradedOperatorArtifact = requiredDeploymentArtifact(
        operatorUpgrade.artifacts,
        'artifact.operator.applik8s-celld-operator',
      );
      expect(upgradedOperatorArtifact.immutableReference).not.toBe(initialOperatorArtifact.immutableReference);
      for (const artifact of operatorUpgrade.artifacts) builtImages.add(artifact.taggedReference);
      await waitForJson(
        ['get', 'deployment/applik8s-celld-operator', '--namespace', 'applik8s-celld-system', '--output=json'],
        value =>
          nestedNumber(value, 'status', 'readyReplicas') === 2
          && kubernetesContainerImage(value, 'operator') !== priorOperatorImage,
        240_000,
        'interrupted Celld operator upgrade recovery',
      );
      await waitForJson(
        ['get', `celldfleet/${application}-actors`, '--namespace', namespace, '--output=json'],
        value =>
          nestedString(value, 'status', 'phase') === 'Ready'
          && nestedString(value, 'status', 'observedArtifactManifestDigest') === initialRuntimeManifest.manifestDigest,
        120_000,
        'fleet readiness after interrupted operator upgrade',
      );
      await portForward.close();
      portForward = await startPortForward(namespace, `pod/${application}-actors-0`, 8080);
      await waitForHttp(`${portForward.endpoint}/healthz`, 60_000);
      await expectEventually(
        () => admitted('read', {}, () =>
          Counter.read('workspace-a', {}, {
            idempotencyKey: `read-after-operator-upgrade-${randomUUID()}`,
          })),
        { count: 5 },
        120_000,
      );

      // The mutation is intentionally out-of-band. Repair must be continuous
      // operator reconciliation; no deployment plan/apply is allowed here.
      await kubectl([
        'delete', `networkpolicy/${application}-actors-private`, '--namespace', namespace,
        '--wait=true', '--timeout=120s',
      ]);
      await waitForJson(
        ['get', `networkpolicy/${application}-actors-private`, '--namespace', namespace, '--output=json'],
        value => nestedString(value, 'metadata', 'uid') !== undefined,
        60_000,
        'operator repair of deleted NetworkPolicy',
      );
      await kubectl([
        'delete', `poddisruptionbudget/${application}-actors`, '--namespace', namespace,
        '--wait=true', '--timeout=120s',
      ]);
      await waitForJson(
        ['get', `poddisruptionbudget/${application}-actors`, '--namespace', namespace, '--output=json'],
        value => nestedString(value, 'metadata', 'uid') !== undefined,
        90_000,
        'operator repair of deleted PodDisruptionBudget',
      );

      // Fleet deletion is an operator lifecycle boundary, not an object-store
      // lifecycle shortcut. Prove the finalizer removes only fleet-owned
      // children while the separately declared durable substrate remains.
      await kubectl([
        'delete', `celldfleet/${application}-actors`, '--namespace', namespace,
        '--wait=true', '--timeout=180s',
      ]);
      await waitForAbsent('celldfleet', `${application}-actors`, 180_000, namespace);
      await waitForJson(
        ['get', `deployment/${application}-objects`, '--namespace', namespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 1,
        60_000,
        'retained actor object-store Deployment after fleet finalization',
      );
      await waitForJson(
        ['get', `persistentvolumeclaim/${application}-objects-data`, '--namespace', namespace, '--output=json'],
        value => nestedString(value, 'status', 'phase') === 'Bound',
        60_000,
        'retained actor object-store PVC after fleet finalization',
      );
      expect((await kubectl([
        'get', 'statefulset,job,networkpolicy', '--namespace', namespace,
        '--selector', `celld.applik8s.io/fleet=${application}-actors`,
        '--ignore-not-found=true', '--output=name',
      ])).stdout.trim()).toBe('');
      await waitForJson(
        ['get', `celldfleet/${secondaryFleetName}`, '--namespace', secondaryNamespace, '--output=json'],
        value => nestedString(value, 'status', 'phase') === 'Ready',
        60_000,
        'second application remains Ready after first fleet finalization',
      );
      await waitForJson(
        ['get', `statefulset/${secondaryFleetName}`, '--namespace', secondaryNamespace, '--output=json'],
        value => nestedNumber(value, 'status', 'readyReplicas') === 2,
        60_000,
        'second application StatefulSet remains Ready',
      );
      await expectKubernetesResource('applik8s-celld-system', 'deployment', 'applik8s-celld-operator');
      expect((await kubectl([
        'get', 'customresourcedefinition/celldfleets.celld.applik8s.io', '--output=name',
      ])).stdout.trim()).toBe('customresourcedefinition.apiextensions.k8s.io/celldfleets.celld.applik8s.io');

      await kubectl([
        'delete', `celldfleet/${secondaryFleetName}`, '--namespace', secondaryNamespace,
        '--wait=true', '--timeout=180s',
      ]);
      await waitForAbsent('celldfleet', secondaryFleetName, 180_000, secondaryNamespace);
      await kubectl([
        'delete', `namespace/${secondaryNamespace}`, '--wait=true', '--timeout=180s',
      ]);
      await waitForAbsent('namespace', secondaryNamespace, 180_000);
      secondaryNamespace = undefined;
      secondaryFleetName = undefined;

      await deployment.destroy();
      await waitForAbsent('namespace', namespace, 300_000);
      destroyed = true;
      expect((await kubectl([
        'get', 'statefulset,job,service,networkpolicy,pvc,secret',
        '--namespace', namespace, '--ignore-not-found=true', '--output=name',
      ])).stdout.trim()).toBe('');
    } catch (cause) {
      testFailure = cause;
    } finally {
      uninstallRuntime?.();
      if (portForward) {
        try { await portForward.close(); } catch (cause) {
          cleanupErrors.push(`port-forward: ${errorMessage(cause)}`);
        }
      }
      if (secondaryFleetName && secondaryNamespace) {
        try {
          await kubectl([
            'delete', `celldfleet/${secondaryFleetName}`, '--namespace', secondaryNamespace,
            '--ignore-not-found=true', '--wait=true', '--timeout=180s',
          ]);
        } catch (cause) {
          cleanupErrors.push(`secondary fleet: ${errorMessage(cause)}`);
        }
      }
      if (secondaryNamespace) {
        try {
          await kubectl([
            'delete', `namespace/${secondaryNamespace}`,
            '--ignore-not-found=true', '--wait=true', '--timeout=180s',
          ]);
        } catch (cause) {
          cleanupErrors.push(`secondary namespace: ${errorMessage(cause)}`);
        }
      }
      if (deployment && !destroyed) {
        try {
          await kubectl([
            'delete', `celldfleet/${application}-actors`, '--namespace', namespace,
            '--ignore-not-found=true', '--wait=true', '--timeout=180s',
          ]);
        } catch (cause) {
          cleanupErrors.push(`primary fleet: ${errorMessage(cause)}`);
        }
      }
      if (deployment && !destroyed) {
        try {
          await deployment.destroy();
          await waitForAbsent('namespace', namespace, 300_000);
          destroyed = true;
        } catch (cause) {
          cleanupErrors.push(`deployment destroy: ${errorMessage(cause)}`);
        }
      }
      for (const image of builtImages) {
        try { await removeDockerImage(image); } catch (cause) {
          cleanupErrors.push(`image ${image}: ${errorMessage(cause)}`);
        }
      }
      try { await rm(projectRoot, { recursive: true, force: true }); } catch (cause) {
        cleanupErrors.push(`temporary directory: ${errorMessage(cause)}`);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [
          ...(testFailure === undefined ? [] : [testFailure]),
          ...cleanupErrors.map((message) => new Error(message)),
        ],
        `Celld Kubernetes cleanup failed:\n${cleanupErrors.join('\n')}`,
      );
    }
    if (testFailure !== undefined) throw testFailure;
  }, 1_200_000);
});

async function emitActorLifecycleGraph(options: {
  readonly application: string;
  readonly namespace: string;
  readonly projectRoot: string;
  readonly replicas: number;
  readonly sourceGraphDigest: `sha256:${string}`;
  readonly celldRuntimeRelease?: ApplicationCelldRuntimeRelease;
  readonly operatorBuildRevision?: string;
}) {
  const bundlePath = join(options.projectRoot, 'typekro-bundle.json');
  const operatorOutDir = join(options.projectRoot, 'operators', 'applik8s-celld-operator');
  const operator = await createCompilerPipeline().run({
    entrypoint: join(process.cwd(), 'packages/celld-operator/src/operator.ts'),
    operatorName: 'applik8s-celld-operator',
    outDir: operatorOutDir,
    runtimeVersionRange: '^0.1.0',
    handlerAbiVersion: 'applik8s.handler/v1alpha1',
    adapter: 'wasmComponent',
    dispatcherMode: 'staticSerializable',
    portability: {
      deterministicBuild: true,
      allowEnvironmentAccess: false,
      allowFilesystemAccess: false,
      allowNetworkAccess: true,
      allowedHostImports: [],
      sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
    },
  });
  if (!operator.ok) throw new Error(operator.error.message);
  if (options.operatorBuildRevision) {
    await stampOperatorQualificationRevision({
      manifestPath: operator.value.artifacts.manifestJsonPath,
      outputDirectory: operatorOutDir,
      revision: options.operatorBuildRevision,
    });
  }
  await writeFile(bundlePath, JSON.stringify({ spec: {
    operators: [{
      name: 'applik8s-celld-operator',
      manifest: operator.value.artifacts.manifestJsonPath,
    }],
  } }));
  await writeFile(join(options.projectRoot, 'resources.json'), JSON.stringify([{
    apiVersion: 'kro.run/v1alpha1',
    kind: 'ResourceGraphDefinition',
    metadata: { name: options.application },
    spec: {
      schema: {
        apiVersion: 'v1alpha1',
        kind: actorLifecycleKind(options.application),
        spec: { name: 'string', namespace: 'string' },
        status: { ready: true },
      },
      resources: [{
        id: 'qualificationHttp',
        template: {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: `${options.application}-api`,
            namespace: options.namespace,
            labels: { 'app.kubernetes.io/component': 'typed-http' },
          },
          spec: {
            selector: { 'app.kubernetes.io/component': 'typed-http' },
            ports: [{ name: 'http', port: 8080, targetPort: 8080 }],
          },
        },
      }],
    },
  }]));
  const emitted = await emitApplicationDeploymentGraph({
    bundlePath,
    // The temporary bundle remains the authored artifact boundary, while the
    // workspace root contributes the locally built operator-host base artifact.
    projectRoot: process.cwd(),
    graph: actorLifecycleGraph(options),
    sourceGraphDigest: options.sourceGraphDigest,
    compilerVersion: '0.8.0',
    context: process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack',
    controlPlaneNamespace: 'default',
    instance: 'qualification',
    profile: 'starter',
    strategy: 'direct',
    installationSpec: { name: 'qualification', namespace: options.namespace },
    ...(options.celldRuntimeRelease ? { celldRuntimeRelease: options.celldRuntimeRelease } : {}),
  });
  const artifact = emitted.graph.nodes.find(({ id }) => id === 'artifact.celld-runtime');
  if (artifact?.kind !== 'artifact') {
    throw new Error('Celld lifecycle compilation did not emit artifact.celld-runtime.');
  }
  expect(artifact.spec.sourceDescriptor).toMatchObject({
    baseImage: (options.celldRuntimeRelease ?? applicationCelldRuntimeRelease).image,
  });
  const operatorArtifact = emitted.graph.nodes.find(({ id }) => id === 'artifact.operator.applik8s-celld-operator');
  if (operatorArtifact?.kind !== 'artifact') {
    throw new Error('Celld lifecycle compilation did not emit the standalone operator artifact.');
  }
  return emitted.graph;
}

async function stampOperatorQualificationRevision(options: {
  readonly manifestPath: string;
  readonly outputDirectory: string;
  readonly revision: string;
}): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(options.revision)) {
    throw new Error(`Invalid operator qualification revision ${JSON.stringify(options.revision)}.`);
  }
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as Record<string, unknown>;
  const spec = requiredObject(manifest, 'spec');
  const bundle = requiredObject(spec, 'bundle');
  const container = requiredObject(spec, 'container');
  const image = requiredObject(container, 'image');
  const build = requiredObject(container, 'build');
  const labels = requiredObject(build, 'labels');
  const priorDigest = requiredString(bundle, 'buildIdentityDigest');
  const digest = `sha256:${createHash('sha256')
    .update(priorDigest)
    .update('\0')
    .update(options.revision)
    .digest('hex')}`;
  bundle.buildIdentityDigest = digest;
  image.tag = digest.slice('sha256:'.length, 'sha256:'.length + 12);
  labels['applik8s.dev/build-identity-digest'] = digest;
  labels['applik8s.dev/qualification-revision'] = options.revision;
  const dockerfilePath = join(options.outputDirectory, requiredString(build, 'dockerfile'));
  const dockerfile = await readFile(dockerfilePath, 'utf8');
  await writeFile(join(options.outputDirectory, 'qualification-revision.txt'), `${options.revision}\n`);
  await writeFile(
    dockerfilePath,
    `${dockerfile.trimEnd()}\nCOPY --chmod=0444 qualification-revision.txt /etc/applik8s/qualification-revision\n`,
  );
  await writeFile(options.manifestPath, JSON.stringify(manifest));
}

function requiredCelldRuntimeManifest(
  graph: Awaited<ReturnType<typeof emitApplicationDeploymentGraph>>['graph'],
): {
  readonly manifestDigest: string;
  readonly workerVersion: string;
  readonly celldVersion: string;
  readonly applicationGraphDigest: string;
} {
  const artifact = graph.nodes.find(({ id }) => id === 'artifact.celld-runtime');
  if (artifact?.kind !== 'artifact') {
    throw new Error('Celld lifecycle graph does not contain artifact.celld-runtime.');
  }
  const descriptor = requiredObject(artifact.spec, 'sourceDescriptor');
  const manifest = requiredObject(descriptor, 'runtimeManifest');
  return {
    manifestDigest: requiredString(manifest, 'manifestDigest'),
    workerVersion: requiredString(manifest, 'workerVersion'),
    celldVersion: requiredString(manifest, 'celldVersion'),
    applicationGraphDigest: requiredString(manifest, 'applicationGraphDigest'),
  };
}

function requiredDeploymentArtifact(
  artifacts: readonly {
    readonly deploymentNodeId: string;
    readonly sourceDigest: string;
    readonly immutableReference: string;
  }[],
  deploymentNodeId: string,
) {
  const artifact = artifacts.find(candidate => candidate.deploymentNodeId === deploymentNodeId);
  if (!artifact) throw new Error(`Deployment did not return artifact ${deploymentNodeId}.`);
  return artifact;
}

async function celldRollbackDiagnostics(namespace: string, fleet: string): Promise<string> {
  const observations: string[] = [];
  for (const resource of [
    `celldfleet/${fleet}`,
    `statefulset/${fleet}`,
    `pod/${fleet}-0`,
  ]) {
    try {
      observations.push(`${resource}: ${(await kubectl([
        'get', resource, '--namespace', namespace, '--output=json',
      ])).stdout}`);
    } catch (cause) {
      observations.push(`${resource}: ${errorMessage(cause)}`);
    }
  }
  try {
    observations.push(`jobs: ${(await kubectl([
      'get', 'jobs', '--namespace', namespace,
      '--selector', `celld.applik8s.io/fleet=${fleet}`,
      '--output=json',
    ])).stdout}`);
  } catch (cause) {
    observations.push(`jobs: ${errorMessage(cause)}`);
  }
  return observations.join('\n');
}

function actorLifecycleGraph(options: {
  readonly application: string;
  readonly namespace: string;
  readonly replicas: number;
}): ApplicationGraph {
  const credentials = {
    apiVersion: 'v1',
    kind: 'Secret',
    name: `${options.application}-objects-credentials`,
    namespace: options.namespace,
  } as const;
  const stateStore = {
    kind: 's3',
    enabled: true,
    name: `${options.application}-objects`,
    endpoint: `http://${options.application}-objects.${options.namespace}.svc.cluster.local:8333`,
    ownership: 'direct-provisioned',
    bucket: `${options.application}-actors`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentialsSecret: credentials,
    provisioning: {
      kind: 'local-s3',
      enabled: true,
      name: `${options.application}-objects`,
      storageSize: '1Gi',
    },
  } as const;
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: options.application, namespace: options.namespace },
    nodes: [
      {
        id: 'provider.ObjectStorage',
        kind: 'provider',
        name: 'ObjectStorage',
        stability: 'stable',
        interface: 'ObjectStorage',
        implementation: 's3',
        config: { objectStorage: stateStore },
      },
      {
        id: 'provider.ActorRuntime',
        kind: 'provider',
        name: 'ActorRuntime',
        stability: 'stable',
        interface: 'ActorRuntime',
        implementation: 'celld-actors',
        config: {
          actorRuntime: {
            kind: 'celld-actors',
            replicas: options.replicas,
            stateStore,
          },
        },
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

function actorLifecycleSource(application: string): ApplicationTypeKroCompositionSource<
  { readonly name: string; readonly namespace: string },
  { readonly ready: boolean }
> {
  const definition = {
    name: application,
    apiVersion: 'qualification.applik8s.dev/v1alpha1',
    kind: actorLifecycleKind(application),
    spec: type({ name: 'string', namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  };
  const source = kubernetesComposition(definition, () => ({ ready: true }));
  Object.defineProperty(source, '__applik8sTypeKroDefinition', {
    value: definition,
    enumerable: false,
  });
  return source;
}

async function actorLifecycleDeployment(options: {
  readonly graph: Awaited<ReturnType<typeof emitActorLifecycleGraph>>;
  readonly source: ReturnType<typeof actorLifecycleSource>;
  readonly stateRoot: string;
  readonly instance: string;
  readonly namespace: string;
}): Promise<ApplicationAlchemyDeployment> {
  return createApplicationAlchemyGraphDeployment({
    graph: options.graph,
    source: options.source,
    spec: {
      name: options.instance,
      namespace: options.namespace,
    },
    stateRoot: options.stateRoot,
    stage: 'qualification',
    owner: `v08-celld-kubernetes-${process.pid}`,
    artifactRegistry: { type: 'orbstack' },
    factory: {
      namespace: 'default',
      waitForReady: true,
      timeout: 300_000,
    },
  });
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

async function startPortForward(
  namespace: string,
  resource: string,
  remotePort: number,
): Promise<PortForward> {
  const child = spawn('kubectl', [
    'port-forward', '--namespace', namespace, resource, `0:${remotePort}`,
  ], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  const port = await waitForForwardingPort(child, () => output, 30_000);
  return {
    endpoint: `http://127.0.0.1:${port}`,
    close: () => closeChild(child),
  };
}

async function waitForForwardingPort(
  child: ChildProcess,
  output: () => string,
  timeout: number,
): Promise<number> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = /Forwarding from (?:127\.0\.0\.1|\[::1\]):(\d+)/u.exec(output());
    if (match?.[1]) return Number(match[1]);
    if (child.exitCode !== null) {
      throw new Error(`kubectl port-forward exited with code ${child.exitCode}: ${output()}`);
    }
    await sleep(100);
  }
  throw new Error(`Timed out starting kubectl port-forward: ${output()}`);
}

async function closeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function secretValue(
  namespace: string,
  name: string,
  key: string,
): Promise<string> {
  const value = (await kubectl([
    'get', `secret/${name}`, '--namespace', namespace,
    '--output', `jsonpath={.data.${key}}`,
  ])).stdout.trim();
  if (!value) throw new Error(`Secret ${namespace}/${name} has no ${key}.`);
  return Buffer.from(value, 'base64').toString('utf8');
}

async function expectKubernetesResource(
  namespace: string,
  kind: string,
  name: string,
): Promise<void> {
  const observed = (await kubectl([
    'get', `${kind}/${name}`, '--namespace', namespace, '--output=name',
  ])).stdout.trim();
  expect(observed.endsWith(`/${name}`)).toBe(true);
}

async function installSecondaryFleet(options: {
  readonly primaryFleet: Readonly<Record<string, unknown>>;
  readonly primaryNamespace: string;
  readonly secondaryNamespace: string;
  readonly secondaryFleetName: string;
  readonly projectRoot: string;
}): Promise<void> {
  const spec = structuredClone(requiredObject(options.primaryFleet, 'spec'));
  const runtimeSecretRef = requiredObject(spec, 'runtimeSecretRef');
  const objectStore = requiredObject(spec, 'objectStore');
  const credentials = requiredObject(objectStore, 'credentials');
  const credentialsSecretRef = requiredObject(credentials, 'secretRef');
  const sourceRuntimeSecret = requiredString(runtimeSecretRef, 'name');
  const sourceCredentialsSecret = requiredString(credentialsSecretRef, 'name');
  const secondaryRuntimeSecret = `${options.secondaryFleetName}-authorization`;
  const secondaryCredentialsSecret = `${options.secondaryFleetName}-objects-credentials`;
  runtimeSecretRef.name = secondaryRuntimeSecret;
  credentialsSecretRef.name = secondaryCredentialsSecret;
  // Both fleets may share one durable object-store provider while retaining
  // distinct keyspaces. The bucket is provisioned by the primary application;
  // changing it here would claim an unprovisioned dependency.
  objectStore.prefix = options.secondaryFleetName;

  await kubectl(['create', 'namespace', options.secondaryNamespace]);
  const resources = {
    apiVersion: 'v1',
    kind: 'List',
    items: [
      await clonedSecret({
        sourceNamespace: options.primaryNamespace,
        sourceName: sourceRuntimeSecret,
        targetNamespace: options.secondaryNamespace,
        targetName: secondaryRuntimeSecret,
      }),
      await clonedSecret({
        sourceNamespace: options.primaryNamespace,
        sourceName: sourceCredentialsSecret,
        targetNamespace: options.secondaryNamespace,
        targetName: secondaryCredentialsSecret,
      }),
      {
        apiVersion: 'celld.applik8s.io/v1alpha1',
        kind: 'CelldFleet',
        metadata: {
          name: options.secondaryFleetName,
          namespace: options.secondaryNamespace,
        },
        spec,
      },
    ],
  };
  const path = join(options.projectRoot, 'secondary-fleet.json');
  await writeFile(path, JSON.stringify(resources));
  await kubectl(['apply', '--filename', path]);
}

async function clonedSecret(options: {
  readonly sourceNamespace: string;
  readonly sourceName: string;
  readonly targetNamespace: string;
  readonly targetName: string;
}): Promise<Readonly<Record<string, unknown>>> {
  const source = JSON.parse((await kubectl([
    'get', `secret/${options.sourceName}`, '--namespace', options.sourceNamespace, '--output=json',
  ])).stdout) as Readonly<Record<string, unknown>>;
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: options.targetName, namespace: options.targetNamespace },
    type: typeof source.type === 'string' ? source.type : 'Opaque',
    data: requiredObject(source, 'data'),
  };
}

function requiredObject(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  const candidate = value[field];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`Expected ${field} to be an object.`);
  }
  return candidate as Record<string, unknown>;
}

function requiredString(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error(`Expected ${field} to be a non-empty string.`);
  }
  return candidate;
}

async function waitForJson(
  args: readonly string[],
  accepted: (value: Readonly<Record<string, unknown>>) => boolean,
  timeout: number,
  label: string,
): Promise<Readonly<Record<string, unknown>>> {
  const deadline = Date.now() + timeout;
  let latest = 'not observed';
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse((await kubectl(args)).stdout) as Readonly<Record<string, unknown>>;
      latest = JSON.stringify(value.status ?? value.spec ?? value);
      if (accepted(value)) return value;
    } catch (cause) {
      latest = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${label}: ${latest}`);
}

async function assertFleetChildOwnership(
  namespace: string,
  name: string,
  fleetUid: string,
): Promise<void> {
  const observed = JSON.parse((await kubectl([
    'get', 'statefulset,service,networkpolicy,poddisruptionbudget,serviceaccount,job',
    '--namespace', namespace,
    '--selector', `celld.applik8s.io/fleet=${name}`,
    '--output=json',
  ])).stdout) as {
    readonly items?: readonly {
      readonly kind?: string;
      readonly metadata?: {
        readonly name?: string;
        readonly ownerReferences?: readonly { readonly uid?: string; readonly controller?: boolean }[];
      };
    }[];
  };
  const items = observed.items ?? [];
  expect(items.length).toBeGreaterThanOrEqual(6);
  for (const item of items) {
    expect(item.metadata?.ownerReferences).toContainEqual(expect.objectContaining({
      uid: fleetUid,
      controller: true,
    }));
  }
}

async function waitForAbsent(
  kind: string,
  name: string,
  timeout: number,
  namespace?: string,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest = '';
  while (Date.now() < deadline) {
    latest = (await kubectl([
      'get', `${kind}/${name}`,
      ...(namespace ? ['--namespace', namespace] : []),
      '--ignore-not-found=true', '--output=name',
    ])).stdout.trim();
    if (!latest) return;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${kind}/${name} deletion: ${latest}`);
}

async function waitForHttp(url: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      latest = `HTTP ${response.status}`;
      if (response.ok) return;
    } catch (cause) {
      latest = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${latest}`);
}

async function expectEventually<T>(
  operation: () => Promise<T>,
  expected: T,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let latest: unknown;
  while (Date.now() < deadline) {
    try {
      latest = await operation();
      expect(latest).toEqual(expected);
      return;
    } catch (cause) {
      latest = cause;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for actor convergence: ${latest instanceof Error ? latest.message : String(latest)}`);
}

function nestedNumber(
  value: Readonly<Record<string, unknown>>,
  parent: string,
  field: string,
): number | undefined {
  const object = value[parent];
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const candidate = Reflect.get(object, field);
  return typeof candidate === 'number' ? candidate : undefined;
}

function nestedString(
  value: Readonly<Record<string, unknown>>,
  parent: string,
  field: string,
): string | undefined {
  const object = value[parent];
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const candidate = Reflect.get(object, field);
  return typeof candidate === 'string' ? candidate : undefined;
}

function kubernetesContainerImage(
  resource: Readonly<Record<string, unknown>>,
  containerName: string,
): string {
  const spec = requiredObject(resource, 'spec');
  const template = requiredObject(spec, 'template');
  const podSpec = requiredObject(template, 'spec');
  const containers = podSpec.containers;
  if (!Array.isArray(containers)) throw new Error('Kubernetes workload has no containers.');
  const container = containers.find(candidate =>
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && Reflect.get(candidate, 'name') === containerName,
  );
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    throw new Error(`Kubernetes workload has no ${containerName} container.`);
  }
  const image = Reflect.get(container, 'image');
  if (typeof image !== 'string' || image.length === 0) {
    throw new Error(`Kubernetes ${containerName} container has no image.`);
  }
  return image;
}

async function installPriorCelldFleetCrdFixture(
  ownedFleetUids: ReadonlySet<string>,
): Promise<Readonly<Record<string, unknown>>> {
  const fleets = JSON.parse((await kubectl([
    'get', 'celldfleets.celld.applik8s.io', '--all-namespaces', '--output=json',
  ])).stdout) as Readonly<Record<string, unknown>>;
  const observedUids = new Set(resourceList(fleets).map(fleet => nestedString(fleet, 'metadata', 'uid')));
  if (observedUids.has(undefined) || observedUids.size !== ownedFleetUids.size
    || [...observedUids].some(uid => uid === undefined || !ownedFleetUids.has(uid))) {
    throw new Error(
      `Refusing to install the prior CelldFleet CRD fixture while non-test fleets exist: ${JSON.stringify([...observedUids])}.`,
    );
  }
  for (const fleet of resourceList(fleets)) {
    const spec = fleet.spec;
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && 'placement' in spec) {
      throw new Error('The prior CelldFleet CRD fixture cannot admit a live fleet using spec.placement.');
    }
  }
  const current = await waitForJson(
    ['get', 'customresourcedefinition/celldfleets.celld.applik8s.io', '--output=json'],
    value =>
      celldFleetCrdRevision(value) === celldFleetSchemaRevision
      && celldFleetCrdHasSpecProperty(value, 'placement'),
    60_000,
    'current CelldFleet CRD before migration fixture',
  );
  if (!nestedString(current, 'metadata', 'resourceVersion')) {
    throw new Error('Current CelldFleet CRD has no resourceVersion.');
  }
  await kubectl([
    'patch', 'customresourcedefinition/celldfleets.celld.applik8s.io',
    '--type=json',
    '--patch', JSON.stringify([
      {
        op: 'replace',
        path: '/metadata/annotations/celld.applik8s.io~1schema-revision',
        value: 'v1alpha1-0',
      },
      {
        op: 'remove',
        path: '/spec/versions/0/schema/openAPIV3Schema/properties/spec/properties/placement',
      },
    ]),
  ]);
  return waitForJson(
    ['get', 'customresourcedefinition/celldfleets.celld.applik8s.io', '--output=json'],
    value =>
      celldFleetCrdRevision(value) === 'v1alpha1-0'
      && !celldFleetCrdHasSpecProperty(value, 'placement'),
    60_000,
    'prior CelldFleet CRD fixture',
  );
}

function celldFleetCrdRevision(value: Readonly<Record<string, unknown>>): string | undefined {
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const annotations = Reflect.get(metadata, 'annotations');
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) return undefined;
  const revision = Reflect.get(annotations, 'celld.applik8s.io/schema-revision');
  return typeof revision === 'string' ? revision : undefined;
}

function celldFleetCrdHasSpecProperty(
  value: Readonly<Record<string, unknown>>,
  property: string,
): boolean {
  try {
    const spec = requiredObject(value, 'spec');
    const versions = spec.versions;
    if (!Array.isArray(versions) || versions.length !== 1) return false;
    const version = versions[0];
    if (!version || typeof version !== 'object' || Array.isArray(version)) return false;
    const schema = requiredObject(version as Readonly<Record<string, unknown>>, 'schema');
    const openApi = requiredObject(schema, 'openAPIV3Schema');
    const rootProperties = requiredObject(openApi, 'properties');
    const fleetSpec = requiredObject(rootProperties, 'spec');
    const fleetProperties = requiredObject(fleetSpec, 'properties');
    return property in fleetProperties;
  } catch {
    return false;
  }
}

function resourceList(value: Readonly<Record<string, unknown>>): readonly Readonly<Record<string, unknown>>[] {
  const items = value.items;
  return Array.isArray(items)
    ? items.filter((item): item is Readonly<Record<string, unknown>> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

async function removeDockerImage(reference: string): Promise<void> {
  if (await dockerImageExists(reference)) {
    await docker(['image', 'rm', '--force', reference], process.cwd());
  }
  if (await dockerImageExists(reference)) {
    throw new Error(`Docker retained generated image ${reference}.`);
  }
}

async function preflightActorKubernetesLifecycle(namespace: string): Promise<void> {
  await docker(['version', '--format', '{{.Server.Version}}'], process.cwd());
  const existingNamespace = (await kubectl([
    'get', `namespace/${namespace}`, '--ignore-not-found=true', '--output=name',
  ])).stdout.trim();
  if (existingNamespace) {
    throw new Error(`Celld Kubernetes preflight found conflicting ${existingNamespace}.`);
  }
  const installedCrd = (await kubectl([
    'get', 'customresourcedefinition/celldfleets.celld.applik8s.io',
    '--ignore-not-found=true', '--output=name',
  ])).stdout.trim();
  if (installedCrd) {
    const fleets = JSON.parse((await kubectl([
      'get', 'celldfleets.celld.applik8s.io', '--all-namespaces', '--output=json',
    ])).stdout) as Readonly<Record<string, unknown>>;
    const identities = resourceList(fleets).map(fleet => ({
      namespace: nestedString(fleet, 'metadata', 'namespace'),
      name: nestedString(fleet, 'metadata', 'name'),
      uid: nestedString(fleet, 'metadata', 'uid'),
    }));
    if (identities.length > 0) {
      throw new Error(
        `Celld Kubernetes preflight requires an idle singleton control plane; found existing fleets ${JSON.stringify(identities)}.`,
      );
    }
  }
  const nodes = JSON.parse((await kubectl(['get', 'nodes', '--output=json'])).stdout) as {
    readonly items?: readonly {
      readonly status?: {
        readonly conditions?: readonly {
          readonly type?: string;
          readonly status?: string;
        }[];
      };
    }[];
  };
  if (!nodes.items?.some((node) =>
    node.status?.conditions?.some((condition) =>
      condition.type === 'Ready' && condition.status === 'True'))) {
    throw new Error('Celld Kubernetes preflight found no Ready node.');
  }
  const storageClasses = JSON.parse((await kubectl([
    'get', 'storageclass', '--output=json',
  ])).stdout) as {
    readonly items?: readonly {
      readonly metadata?: {
        readonly annotations?: Readonly<Record<string, string>>;
      };
    }[];
  };
  if (!storageClasses.items?.some(({ metadata }) =>
    metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true'
    || metadata?.annotations?.['storageclass.beta.kubernetes.io/is-default-class'] === 'true')) {
    throw new Error('Celld Kubernetes preflight requires one default StorageClass.');
  }
  for (const resource of [
    'namespaces',
    'deployments.apps',
    'statefulsets.apps',
    'jobs.batch',
    'persistentvolumeclaims',
    'services',
    'secrets',
    'networkpolicies.networking.k8s.io',
  ]) {
    const allowed = (await kubectl(['auth', 'can-i', 'create', resource])).stdout.trim();
    if (allowed !== 'yes') {
      throw new Error(`Celld Kubernetes preflight cannot create ${resource}.`);
    }
  }
}

async function dockerImageExists(reference: string): Promise<boolean> {
  try {
    await docker(['image', 'inspect', reference], process.cwd());
    return true;
  } catch (cause) {
    if (/No such image|not found/iu.test(errorMessage(cause))) return false;
    throw cause;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function actorLifecycleKind(application: string): string {
  return `V08Celld${application.replace(/[^a-z0-9]/giu, '').slice(-16)}`;
}
