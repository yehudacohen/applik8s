// typecast-file-boundary: Kubernetes resources and authenticated Celld JSON responses are structurally checked at this controller boundary before they become typed reconciliation evidence.
import type { AnyKubernetesObject, HandlerProxyScope, ResourceObject } from '@applik8s/core';
import { sdk } from '@applik8s/sdk';
import { effectiveCelldRolloutStrategy } from './compatibility.js';
import {
  type CelldFleetCondition,
  type CelldFleetSpec,
  type CelldFleetStatus,
  celldFleetFinalizer,
  celldFleetLabel,
  celldFleetSpecOpenApiSchema,
  celldFleetStatusOpenApiSchema,
  celldFleetUidLabel,
  celldRuntimeSecretV1,
  gcsCredentialsSecretV1,
  s3CredentialsSecretV1,
} from './contracts.js';
import {
  celldDeploymentJobName,
  celldFleetImageDigest,
  renderCelldFleetChildren,
} from './manifests.js';
import {
  CelldJob,
  CelldNetworkPolicy,
  CelldPod,
  CelldPodDisruptionBudget,
  CelldSecret,
  CelldService,
  CelldServiceAccount,
  CelldStatefulSet,
  celldOperatorReads,
  type KubernetesPodStatus,
  type KubernetesStatefulSetStatus,
} from './resources.js';

type CelldFleetHandlerScope = HandlerProxyScope<CelldFleetSpec, CelldFleetStatus>;

export const CelldFleet = sdk.crd<CelldFleetSpec, CelldFleetStatus>({
  apiVersion: 'celld.applik8s.io/v1alpha1',
  kind: 'CelldFleet',
  plural: 'celldfleets',
  scope: 'Namespaced',
  spec: {
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName: 'CelldFleetSpec' },
    schema: celldFleetSpecOpenApiSchema,
  },
  status: {
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName: 'CelldFleetStatus' },
    schema: celldFleetStatusOpenApiSchema,
  },
  additionalPrinterColumns: [
    { name: 'Phase', type: 'string', jsonPath: '.status.phase' },
    { name: 'Ready', type: 'integer', jsonPath: '.status.readyReplicas' },
    { name: 'Worker', type: 'string', jsonPath: '.status.observedWorkerVersion' },
  ],
});

const reconcile = CelldFleet.on.reconcile(async function reconcileCelldFleet(fleet) {
  const namespace = requiredNamespace(fleet.object);
  const uid = requiredUid(fleet.object);
  const generation = fleet.metadata.generation ?? 0;
  fleet.finalizers.add(celldFleetFinalizer);

  if (!validCredentialSelection(fleet.spec)) {
    setDegradedStatus(fleet, generation, 'InvalidCredentialSelection', 'Object-store credentials must select exactly one Secret or workload identity source.');
    return;
  }

  const credentialFailure = await validateFleetSecrets(fleet, namespace);
  if (credentialFailure) {
    setDegradedStatus(fleet, generation, credentialFailure.reason, credentialFailure.message);
    fleet.events.warning(credentialFailure.reason, credentialFailure.message);
    fleet.requeue({ afterSeconds: 15 });
    return;
  }

  const statefulSet = await fleet.read.resource(CelldStatefulSet).get({ name: fleet.metadata.name, namespace });
  const pods = (await fleet.read.resource(CelldPod).list({
    namespace,
    labels: {
      [celldFleetLabel]: fleet.metadata.name,
      [celldFleetUidLabel]: uid,
      'app.kubernetes.io/component': 'actor-runtime',
    },
    limit: 200,
  })).items;
  const desiredImageDigest = celldFleetImageDigest(fleet.spec.artifact.image);
  if (!desiredImageDigest) {
    setDegradedStatus(fleet, generation, 'ArtifactImageNotImmutable', 'CelldFleet requires a digest-pinned OCI image.');
    return;
  }
  const rolloutStrategy = effectiveCelldRolloutStrategy(
    fleet.status.observedCelldVersion,
    fleet.spec.artifact.celldVersion,
    fleet.spec.rollout.strategy,
  );
  const rollout = await reconcileRolloutState(
    fleet.object,
    statefulSet,
    pods,
    namespace,
    desiredImageDigest,
    rolloutStrategy,
  );
  if (rollout.recreateStatefulSet) {
    fleet.resources.delete(
      { apiVersion: 'apps/v1', kind: 'StatefulSet', name: fleet.metadata.name, namespace },
      { owner: fleetRef(fleet.object) },
    );
    setProgressingStatus(fleet, generation, 'RecreatingFleet', 'Waiting for the previous StatefulSet identity to terminate before creating the replacement.');
    fleet.requeue({ afterSeconds: 2 });
    return;
  }
  const children = renderCelldFleetChildren({
    identity: { name: fleet.metadata.name, namespace, uid, generation },
    spec: fleet.spec,
    fingerprint: `${fleet.spec.artifact.manifestDigest}:${generation}`,
    rolloutPartition: rollout.partition,
  });
  const ownershipFailure = await validateChildOwnership(fleet, children.all, uid, namespace);
  if (ownershipFailure) {
    setDegradedStatus(fleet, generation, 'ChildOwnershipConflict', ownershipFailure);
    fleet.events.warning('ChildOwnershipConflict', ownershipFailure);
    fleet.requeue({ afterSeconds: 15 });
    return;
  }
  const deploymentJobName = celldDeploymentJobName(
    fleet.metadata.name,
    fleet.spec.artifact.manifestDigest,
  );
  const deployment = await fleet.read.resource(CelldJob).get({
    name: deploymentJobName,
    namespace,
  });
  const deploymentSucceeded = (deployment?.status?.succeeded ?? 0) > 0;
  const deploymentFailed = (deployment?.status?.failed ?? 0) > 0;
  const now = new Date().toISOString();
  const rolloutStartedAt = fleet.status.rollout?.startedAt ?? now;
  if (
    deployment &&
    await childNeedsApply(fleet, children.deploymentJob, namespace)
  ) {
    fleet.resources.delete(
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        name: deploymentJobName,
        namespace,
      },
      { owner: fleetRef(fleet.object) },
    );
    setProgressingStatus(
      fleet,
      generation,
      'ReplacingArtifactDeployment',
      'Waiting for the previous immutable artifact deployment Job to terminate.',
    );
    fleet.requeue({ afterSeconds: 2 });
    return;
  }
  const activationNeeded = fleet.status.observedArtifactManifestDigest !== undefined
    && fleet.status.observedArtifactManifestDigest !== fleet.spec.artifact.manifestDigest;
  if (deployment && deploymentSucceeded && activationNeeded) {
    const receipt = classifyArtifactDeploymentReceipt(
      deployment.metadata.creationTimestamp,
      rolloutStartedAt,
    );
    if (receipt === 'unverifiable') {
      setDegradedStatus(
        fleet,
        generation,
        'ArtifactDeploymentReceiptUnverifiable',
        `Completed Job ${deploymentJobName} has no valid creation timestamp, so the operator cannot prove whether it activated the desired artifact during this rollout.`,
      );
      return;
    }
    if (receipt === 'historical') {
      fleet.resources.delete(
        {
          apiVersion: 'batch/v1',
          kind: 'Job',
          name: deploymentJobName,
          namespace,
        },
        { owner: fleetRef(fleet.object) },
      );
      setProgressingStatus(
        fleet,
        generation,
        'ReactivatingArtifactDeployment',
        'The matching Job is a historical completion receipt; replaying it because a later artifact superseded its deployment.',
      );
      fleet.status.rollout = {
        partition: rollout.partition,
        waitingOn: 'runtime artifact reactivation',
        startedAt: rolloutStartedAt,
      };
      fleet.requeue({ afterSeconds: 2 });
      return;
    }
  }
  for (const child of children.all) {
    // A runtime pod must never start against an object-store deployment that
    // has not completed for this artifact activation. This also makes rollback
    // restart-safe: replay the historical receipt first, then roll the fleet.
    if (child.kind === 'StatefulSet' && !deploymentSucceeded) continue;
    if (await childNeedsApply(fleet, child, namespace)) {
      fleet.resources.apply(child, { force: false });
    }
  }

  const replicas = statefulSet?.status?.replicas ?? pods.length;
  const readyReplicas = statefulSet?.status?.readyReplicas ?? readyPodCount(pods);
  const updatedReplicas = statefulSet?.status?.updatedReplicas ?? desiredPodCount(pods, desiredImageDigest);
  const runtimeSecret = await fleet.read.resource(CelldSecret).get({ name: fleet.spec.runtimeSecretRef.name, namespace });
  const operatorAuthorization = secretValue(runtimeSecret, celldRuntimeSecretV1.keys.operatorAuthorization);
  const runtimeProofs = operatorAuthorization ? await Promise.all(pods
    .filter(pod => podUsesImageDigest(pod, desiredImageDigest))
    .map(pod => observeRuntimeManifest(pod, fleet.spec, namespace, operatorAuthorization))) : [];
  const observed = runtimeProofs.length === fleet.spec.replicas
    && runtimeProofs.every(proof => proof.ok)
    ? runtimeProofs[0]
    : undefined;
  const rolloutComplete = rollout.partition === 0
    && replicas === fleet.spec.replicas
    && readyReplicas === fleet.spec.replicas
    && updatedReplicas === fleet.spec.replicas
    && observed?.ok === true;
  const elapsedSeconds = Math.max(0, (Date.parse(now) - Date.parse(rolloutStartedAt)) / 1_000);
  const restoreDeadlineExceeded = rollout.restoreBlocked
    && elapsedSeconds > fleet.spec.rollout.restoreDeadlineSeconds;
  const progressDeadlineExceeded = !rolloutComplete
    && elapsedSeconds > fleet.spec.rollout.progressDeadlineSeconds;

  fleet.status.observedGeneration = generation;
  fleet.status.replicas = replicas;
  fleet.status.readyReplicas = readyReplicas;
  fleet.status.updatedReplicas = updatedReplicas;
  fleet.status.endpoint = `http://${fleet.metadata.name}.${namespace}.svc.cluster.local:8080`;
  fleet.status.phase = deploymentFailed || restoreDeadlineExceeded || progressDeadlineExceeded
    ? 'Degraded'
    : rolloutComplete && deploymentSucceeded ? 'Ready' : 'Progressing';
  if (rolloutComplete) delete fleet.status.rollout;
  else fleet.status.rollout = {
      partition: rollout.partition,
      waitingOn: rollout.waitingOn ?? (deploymentSucceeded ? 'fleet readiness' : 'runtime artifact deployment'),
      startedAt: rolloutStartedAt,
    };
  if (observed?.ok) {
    fleet.status.observedImageDigest = observed.imageDigest;
    fleet.status.observedArtifactManifestDigest = observed.manifestDigest;
    fleet.status.observedWorkerVersion = observed.workerVersion;
    fleet.status.observedCelldVersion = observed.celldVersion;
  }
  fleet.status.conditions = deploymentFailed
    ? conditions(generation, now, 'Degraded', 'WorkerDeploymentFailed', 'The Celld Worker deployment Job failed.', fleet.status.conditions)
    : restoreDeadlineExceeded
      ? conditions(generation, now, 'RestoreBlocked', 'RestoreDeadlineExceeded', `Celld restore exceeded ${fleet.spec.rollout.restoreDeadlineSeconds} seconds at ${rollout.waitingOn ?? 'the restore gate'}.`, fleet.status.conditions)
      : progressDeadlineExceeded
        ? conditions(generation, now, 'Degraded', 'ProgressDeadlineExceeded', `Fleet convergence exceeded ${fleet.spec.rollout.progressDeadlineSeconds} seconds and remains blocked on ${rollout.waitingOn ?? 'readiness'}.`, fleet.status.conditions)
    : rolloutComplete && deploymentSucceeded
      ? conditions(generation, now, 'Ready', 'FleetReady', 'Every desired Celld runtime has proven its image, runtime manifest, and restore state.', fleet.status.conditions)
      : conditions(generation, now, rollout.restoreBlocked ? 'RestoreBlocked' : 'Progressing', rollout.restoreBlocked ? 'RuntimeRestoreBlocked' : 'FleetConverging', rollout.waitingOn ?? 'Celld fleet is converging.', fleet.status.conditions);
  // Secondary watches provide prompt convergence, while this bounded resync is
  // the recovery authority for missed watch events, operator restarts, and
  // control-plane watch compaction. A Ready fleet must therefore never become
  // permanently inert.
  fleet.requeue({ afterSeconds: rolloutComplete && deploymentSucceeded ? 30 : 3 });
});

const finalize = CelldFleet.on.finalize(async function finalizeCelldFleet(fleet) {
  const namespace = requiredNamespace(fleet.object);
  const generation = fleet.metadata.generation ?? 0;
  const uid = requiredUid(fleet.object);
  const now = new Date().toISOString();
  const statefulSet = await fleet.read.resource(CelldStatefulSet).get({ name: fleet.metadata.name, namespace });
  const deletionStartedAt = fleet.metadata.deletionTimestamp ?? now;
  const drainElapsedSeconds = Math.max(0, (Date.parse(now) - Date.parse(deletionStartedAt)) / 1_000);
  fleet.status.observedGeneration = generation;
  fleet.status.phase = 'Draining';
  if (statefulSet) {
    const pods = (await fleet.read.resource(CelldPod).list({
      namespace,
      labels: {
        [celldFleetLabel]: fleet.metadata.name,
        [celldFleetUidLabel]: uid,
        'app.kubernetes.io/component': 'actor-runtime',
      },
      limit: 200,
    })).items;
    if (statefulSetDesiredReplicas(statefulSet) === 0) {
      if (pods.length > 0) {
        fleet.status.conditions = conditions(
          generation,
          now,
          'Draining',
          'RuntimePodsTerminating',
          `Admission and durability are confirmed; waiting for ${pods.map(pod => pod.metadata.name).join(', ')} to terminate.`,
          fleet.status.conditions,
        );
        fleet.requeue({ afterSeconds: 2 });
        return;
      }
      fleet.resources.delete(
        { apiVersion: 'apps/v1', kind: 'StatefulSet', name: fleet.metadata.name, namespace },
        { owner: fleetRef(fleet.object) },
      );
      fleet.requeue({ afterSeconds: 2 });
      return;
    }
    const token = await runtimeOperatorAuthorization(fleet, namespace);
    if (!token) {
      setDegradedStatus(fleet, generation, 'RuntimeSecretUnavailable', 'Fleet deletion is blocked because the operator authorization Secret is unavailable.');
      fleet.requeue({ afterSeconds: 15 });
      return;
    }
    const quiesce = await requestFleetOperation(fleet.metadata.name, namespace, token, 'quiesce');
    fleet.status.conditions = conditions(generation, now, 'Draining', drainElapsedSeconds > fleet.spec.rollout.drainDeadlineSeconds
      ? 'DrainDeadlineExceeded'
      : 'AdmissionQuiesced', drainElapsedSeconds > fleet.spec.rollout.drainDeadlineSeconds
      ? `Deletion remains blocked after the ${fleet.spec.rollout.drainDeadlineSeconds}-second drain deadline; policy is Block and requires an explicit administrative recovery.`
      : quiesce.ok
        ? `Admission is quiesced at high-watermark ${quiesce.highWatermark}; ${quiesce.inflight} operation(s) remain.`
        : `Waiting for the runtime quiesce receipt: ${quiesce.message}`, fleet.status.conditions);
    if (!quiesce.ok || quiesce.inflight > 0 || drainElapsedSeconds > fleet.spec.rollout.drainDeadlineSeconds) {
      fleet.requeue({ afterSeconds: 2 });
      return;
    }
    const nodeStates = await Promise.all(pods.map(async pod => ({
      pod: pod.metadata.name,
      state: await observeCelldNodeState(pod.metadata.name, namespace),
    })));
    const evidence = blockingNodeStateEvidence(nodeStates);
    if (evidence.length > 0) {
      fleet.status.conditions = conditions(
        generation,
        now,
        'Draining',
        'DurabilityConfirmationPending',
        `Admission is quiesced, but durable handoff is not yet proven for ${evidence.join(', ')}.`,
        fleet.status.conditions,
      );
      fleet.requeue({ afterSeconds: 2 });
      return;
    }
    fleet.resources.patch(
      { apiVersion: 'apps/v1', kind: 'StatefulSet', name: fleet.metadata.name, namespace },
      [{ op: 'replace', path: '/spec/replicas', value: 0 }],
    );
    fleet.status.conditions = conditions(
      generation,
      now,
      'Draining',
      'RuntimeDrainStarted',
      'Admission and durable handoff are confirmed; the fleet is scaling to zero before workload removal.',
      fleet.status.conditions,
    );
    fleet.requeue({ afterSeconds: 2 });
    return;
  }
  const refs = ownedFleetChildRefs(fleet, namespace)
    .filter(ref => ref.kind !== 'StatefulSet');
  for (const ref of refs) fleet.resources.delete(ref, { owner: fleetRef(fleet.object) });
  const jobs = await fleet.read.resource(CelldJob).list({ namespace, labels: { [celldFleetLabel]: fleet.metadata.name, [celldFleetUidLabel]: uid }, limit: 200 });
  for (const job of jobs.items) {
    fleet.resources.delete({ apiVersion: 'batch/v1', kind: 'Job', name: job.metadata.name, namespace }, { owner: fleetRef(fleet.object) });
  }
  const remaining = await remainingChildren(fleet, namespace, uid);
  if (remaining.length > 0) {
    fleet.status.conditions = conditions(generation, now, 'Draining', 'ChildrenTerminating', `Waiting for ${remaining.join(', ')} to terminate.`, fleet.status.conditions);
    fleet.requeue({ afterSeconds: 2 });
    return;
  }
  fleet.events.normal('CelldFleetFinalized', 'Celld workloads were drained and removed; durable object data remains retained in the external object store.');
  fleet.finalizers.remove(celldFleetFinalizer);
}, { finalizer: celldFleetFinalizer });

const childWatches = [
  CelldStatefulSet, CelldPod, CelldJob, CelldService, CelldNetworkPolicy, CelldPodDisruptionBudget, CelldServiceAccount,
].map(source => sdk.watch(source).enqueue(CelldFleet, {
  map: { mode: 'targetNameFromSourceField', source: { kind: 'label', key: celldFleetLabel } },
  namespace: 'source',
}));

export const celldOperator = sdk.operator({
  name: 'applik8s-celld-operator',
  resources: { CelldFleet },
  reads: celldOperatorReads,
  handlers: [reconcile, finalize],
  secondaryWatches: childWatches,
  permissions: [
    { apiGroups: [''], resources: ['services', 'serviceaccounts'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: [''], resources: ['pods'], verbs: ['get', 'list', 'watch', 'delete'] },
    { apiGroups: [''], resources: ['pods/proxy'], verbs: ['get'] },
    { apiGroups: [''], resources: ['services/proxy'], verbs: ['get', 'create'] },
    { apiGroups: [''], resources: ['secrets'], verbs: ['get'] },
    { apiGroups: ['apps'], resources: ['statefulsets'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: ['networking.k8s.io'], resources: ['networkpolicies'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: ['policy'], resources: ['poddisruptionbudgets'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
  ],
  runtime: {
    leaderElection: {
      enabled: true,
      leaseName: 'applik8s-celld-operator',
      leaseDurationSeconds: 30,
      renewDeadlineSeconds: 20,
      retryPeriodSeconds: 5,
    },
    concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
    rateLimit: { baseDelayMs: 1_000, maxDelayMs: 60_000 },
    health: { enabled: true, path: '/healthz', port: 8081 },
    metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
  },
  deployment: { namespace: 'applik8s-celld-system', scope: 'Cluster', replicas: 2, terminationGracePeriodSeconds: 30 },
});

interface RuntimeManifestProof {
  readonly ok: true;
  readonly imageDigest: string;
  readonly manifestDigest: string;
  readonly workerVersion: string;
  readonly celldVersion: string;
}

async function reconcileRolloutState(
  fleet: ResourceObject<CelldFleetSpec, CelldFleetStatus>,
  statefulSet: ResourceObject<object, KubernetesStatefulSetStatus> | undefined,
  pods: readonly ResourceObject<object, KubernetesPodStatus>[],
  namespace: string,
  desiredImageDigest: string,
  rolloutStrategy: 'Rolling' | 'Recreate',
): Promise<{ readonly partition: number; readonly waitingOn?: string; readonly restoreBlocked: boolean; readonly recreateStatefulSet?: boolean }> {
  if (!statefulSet) return { partition: 0, restoreBlocked: false };
  if (desiredPodCount(pods, desiredImageDigest) === fleet.spec.replicas) return { partition: 0, restoreBlocked: false };
  if (rolloutStrategy === 'Recreate') {
    return statefulSetUsesImageDigest(statefulSet, desiredImageDigest)
      ? { partition: 0, waitingOn: `${fleet.metadata.name}-0`, restoreBlocked: false }
      : { partition: 0, waitingOn: 'recreate rollout', restoreBlocked: false, recreateStatefulSet: true };
  }
  const partition = Math.min(fleet.spec.replicas - 1, fleet.status?.rollout?.partition ?? fleet.spec.replicas - 1);
  const podName = `${fleet.metadata.name}-${partition}`;
  const pod = pods.find(candidate => candidate.metadata.name === podName);
  if (!pod || !podReady(pod) || !podUsesImageDigest(pod, desiredImageDigest)) {
    return { partition, waitingOn: podName, restoreBlocked: false };
  }
  const state = await observeCelldNodeState(podName, namespace);
  if (!state.ok || state.restoring > 0 || state.evicting > 0) {
    return { partition, waitingOn: `${podName} restore gate`, restoreBlocked: true };
  }
  return { partition: Math.max(0, partition - 1), ...(partition > 0 ? { waitingOn: `${fleet.metadata.name}-${partition - 1}` } : {}), restoreBlocked: false };
}

async function observeCelldNodeState(pod: string, namespace: string): Promise<{ readonly ok: boolean; readonly occupied: number; readonly evicting: number; readonly restoring: number }> {
  try {
    const response = await fetch(kubernetesPodProxyUrl(namespace, pod, 8081, '/state'), { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { ok: false, occupied: 0, evicting: 0, restoring: 0 };
    const value = await response.json() as Record<string, unknown>;
    return { ok: true, occupied: finiteNumber(value.occupied), evicting: finiteNumber(value.evicting), restoring: finiteNumber(value.restoring) };
  } catch {
    return { ok: false, occupied: 0, evicting: 0, restoring: 0 };
  }
}

async function observeRuntimeManifest(
  pod: ResourceObject<object, KubernetesPodStatus>,
  spec: CelldFleetSpec,
  namespace: string,
  token: string,
): Promise<RuntimeManifestProof | { readonly ok: false }> {
  try {
    const response = await fetch(kubernetesPodProxyUrl(namespace, pod.metadata.name, 8080, '/__applik8s/v1/operator/manifest'), {
      headers: { 'x-applik8s-operator-authorization': token }, signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { ok: false };
    const value = await response.json() as Record<string, unknown>;
    const imageDigest = celldFleetImageDigest(spec.artifact.image);
    if (!imageDigest
      || value.manifestDigest !== spec.artifact.manifestDigest
      || value.workerVersion !== spec.artifact.workerVersion
      || value.celldVersion !== spec.artifact.celldVersion) return { ok: false };
    return { ok: true, imageDigest, manifestDigest: String(value.manifestDigest), workerVersion: String(value.workerVersion), celldVersion: String(value.celldVersion) };
  } catch {
    return { ok: false };
  }
}

async function validateFleetSecrets(fleet: CelldFleetHandlerScope, namespace: string): Promise<{ readonly reason: string; readonly message: string } | undefined> {
  const runtime = await fleet.read.resource(CelldSecret).get({ name: fleet.spec.runtimeSecretRef.name, namespace });
  const runtimeMissing = missingSecretKeys(runtime, Object.values(celldRuntimeSecretV1.keys));
  if (runtimeMissing.length > 0) return { reason: 'RuntimeSecretInvalid', message: `Secret ${fleet.spec.runtimeSecretRef.name} does not satisfy ${celldRuntimeSecretV1.contract}; missing ${runtimeMissing.join(', ')}.` };
  if (fleet.spec.objectStore.credentials.type === 'workloadIdentity') return undefined;
  const reference = fleet.spec.objectStore.credentials.secretRef;
  if (!reference) return { reason: 'ObjectStoreSecretInvalid', message: 'Secret credentials require secretRef.' };
  if (fleet.spec.objectStore.dialect === 's3' && reference.contract !== s3CredentialsSecretV1.contract) return { reason: 'ObjectStoreSecretContractMismatch', message: `S3 requires ${s3CredentialsSecretV1.contract}.` };
  if (fleet.spec.objectStore.dialect === 'gcs' && reference.contract !== gcsCredentialsSecretV1.contract) return { reason: 'ObjectStoreSecretContractMismatch', message: `GCS requires ${gcsCredentialsSecretV1.contract}.` };
  const secret = await fleet.read.resource(CelldSecret).get({ name: reference.name, namespace });
  const keys = fleet.spec.objectStore.dialect === 's3'
    ? [s3CredentialsSecretV1.keys.accessKeyId, s3CredentialsSecretV1.keys.secretAccessKey]
    : [gcsCredentialsSecretV1.keys.serviceAccountJson];
  const missing = missingSecretKeys(secret, keys);
  return missing.length > 0 ? { reason: 'ObjectStoreSecretInvalid', message: `Secret ${reference.name} does not satisfy ${reference.contract}; missing ${missing.join(', ')}.` } : undefined;
}

async function runtimeOperatorAuthorization(fleet: CelldFleetHandlerScope, namespace: string): Promise<string | undefined> {
  const secret = await fleet.read.resource(CelldSecret).get({ name: fleet.spec.runtimeSecretRef.name, namespace });
  return secretValue(secret, celldRuntimeSecretV1.keys.operatorAuthorization);
}

async function requestFleetOperation(name: string, namespace: string, token: string, operation: 'quiesce'): Promise<{ readonly ok: boolean; readonly highWatermark: number; readonly inflight: number; readonly message: string }> {
  try {
    const response = await fetch(kubernetesServiceProxyUrl(namespace, name, 8080, `/__applik8s/v1/operator/${operation}`), {
      method: 'POST', headers: { 'x-applik8s-operator-authorization': token }, signal: AbortSignal.timeout(3_000),
    });
    const value = await response.json() as Record<string, unknown>;
    return { ok: response.ok, highWatermark: finiteNumber(value.highWatermark), inflight: finiteNumber(value.inflight), message: typeof value.message === 'string' ? value.message : response.statusText };
  } catch (cause) {
    return { ok: false, highWatermark: 0, inflight: 0, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

function kubernetesPodProxyUrl(namespace: string, pod: string, port: number, path: string): string {
  return `https://kubernetes.default.svc/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/http:${encodeURIComponent(pod)}:${port}/proxy${path}`;
}

function kubernetesServiceProxyUrl(namespace: string, service: string, port: number, path: string): string {
  return `https://kubernetes.default.svc/api/v1/namespaces/${encodeURIComponent(namespace)}/services/http:${encodeURIComponent(service)}:${port}/proxy${path}`;
}

async function remainingChildren(fleet: CelldFleetHandlerScope, namespace: string, uid: string): Promise<readonly string[]> {
  const refs = ownedFleetChildRefs(fleet, namespace).filter(ref => ref.kind !== 'StatefulSet');
  const definitions = { Job: CelldJob, Service: CelldService, NetworkPolicy: CelldNetworkPolicy, PodDisruptionBudget: CelldPodDisruptionBudget, ServiceAccount: CelldServiceAccount } as const;
  const remaining: string[] = [];
  for (const ref of refs) {
    const definition = definitions[ref.kind as keyof typeof definitions];
    if (definition && await fleet.read.resource(definition).get({ name: ref.name, namespace })) remaining.push(`${ref.kind}/${ref.name}`);
  }
  const jobs = await fleet.read.resource(CelldJob).list({
    namespace,
    labels: { [celldFleetLabel]: fleet.metadata.name, [celldFleetUidLabel]: uid },
    limit: 200,
  });
  for (const job of jobs.items) remaining.push(`Job/${job.metadata.name}`);
  return remaining;
}

function ownedFleetChildRefs(fleet: CelldFleetHandlerScope, namespace: string) {
  const name = fleet.metadata.name;
  const ownsServiceAccount = fleet.spec.objectStore.credentials.type !== 'workloadIdentity';
  return [
    ['apps/v1', 'StatefulSet', name],
    ['v1', 'Service', name],
    ['v1', 'Service', `${name}-peers`],
    ['networking.k8s.io/v1', 'NetworkPolicy', `${name}-private`],
    ['policy/v1', 'PodDisruptionBudget', name],
    ...(ownsServiceAccount ? [['v1', 'ServiceAccount', `${name}-celld`]] : []),
  ].map(([apiVersion, kind, childName]) => ({
    apiVersion: apiVersion ?? '',
    kind: kind ?? '',
    name: childName ?? '',
    namespace,
  }));
}

async function validateChildOwnership(
  fleet: CelldFleetHandlerScope,
  children: readonly AnyKubernetesObject[],
  uid: string,
  namespace: string,
): Promise<string | undefined> {
  const definitions = {
    StatefulSet: CelldStatefulSet,
    Job: CelldJob,
    Service: CelldService,
    NetworkPolicy: CelldNetworkPolicy,
    PodDisruptionBudget: CelldPodDisruptionBudget,
    ServiceAccount: CelldServiceAccount,
  } as const;
  for (const child of children) {
    const definition = definitions[child.kind as keyof typeof definitions];
    if (!definition) continue;
    const existing = await fleet.read.resource(definition).get({ name: child.metadata.name, namespace });
    if (!existing) continue;
    const controller = existing.metadata.ownerReferences?.find(reference => reference.controller === true);
    if (controller?.uid !== uid) {
      return `${child.kind}/${namespace}/${child.metadata.name} already exists without the live CelldFleet UID ${uid}; refusing to adopt or overwrite it.`;
    }
  }
  return undefined;
}

async function childNeedsApply(
  fleet: CelldFleetHandlerScope,
  desired: AnyKubernetesObject,
  namespace: string,
): Promise<boolean> {
  const definitions = {
    StatefulSet: CelldStatefulSet,
    Job: CelldJob,
    Service: CelldService,
    NetworkPolicy: CelldNetworkPolicy,
    PodDisruptionBudget: CelldPodDisruptionBudget,
    ServiceAccount: CelldServiceAccount,
  } as const;
  const definition = definitions[desired.kind as keyof typeof definitions];
  if (!definition) return true;
  const existing = await fleet.read.resource(definition).get({ name: desired.metadata.name, namespace });
  return existing === undefined || !containsDesiredValue(existing, desired);
}

function containsDesiredValue(actual: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) {
    return Array.isArray(actual)
      && actual.length === desired.length
      && desired.every((entry, index) => containsDesiredValue(actual[index], entry));
  }
  if (desired && typeof desired === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(desired).every(([key, value]) => containsDesiredValue(
      Reflect.get(actual, key), value,
    ));
  }
  return Object.is(actual, desired);
}

function classifyArtifactDeploymentReceipt(
  createdAt: string | undefined,
  rolloutStartedAt: string,
): 'current' | 'historical' | 'unverifiable' {
  if (!createdAt) return 'unverifiable';
  const created = Date.parse(createdAt);
  const rollout = Date.parse(rolloutStartedAt);
  if (!Number.isFinite(created) || !Number.isFinite(rollout)) return 'unverifiable';
  return created < rollout ? 'historical' : 'current';
}

function requiredNamespace(object: ResourceObject<CelldFleetSpec, CelldFleetStatus>): string {
  if (!object.metadata.namespace) throw new Error('CelldFleet must be namespaced.');
  return object.metadata.namespace;
}

function statefulSetDesiredReplicas(
  statefulSet: ResourceObject<object, KubernetesStatefulSetStatus>,
): number | undefined {
  const spec = statefulSet.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return undefined;
  const replicas = Reflect.get(spec, 'replicas');
  return typeof replicas === 'number' ? replicas : undefined;
}

function statefulSetUsesImageDigest(
  statefulSet: ResourceObject<object, KubernetesStatefulSetStatus>,
  digest: string,
): boolean {
  const spec = statefulSet.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
  const template = Reflect.get(spec, 'template');
  const podSpec = template && typeof template === 'object' && !Array.isArray(template)
    ? Reflect.get(template, 'spec')
    : undefined;
  const containers = podSpec && typeof podSpec === 'object' && !Array.isArray(podSpec)
    ? Reflect.get(podSpec, 'containers')
    : undefined;
  if (!Array.isArray(containers)) return false;
  return containers.some(container =>
    container
    && typeof container === 'object'
    && Reflect.get(container, 'name') === 'celld'
    && typeof Reflect.get(container, 'image') === 'string'
    && String(Reflect.get(container, 'image')).includes(digest),
  );
}

function requiredUid(object: ResourceObject<CelldFleetSpec, CelldFleetStatus>): string {
  if (!object.metadata.uid) throw new Error('CelldFleet reconciliation requires metadata.uid before creating owned children.');
  return object.metadata.uid;
}

function fleetRef(object: ResourceObject<CelldFleetSpec, CelldFleetStatus>) {
  return { apiVersion: object.apiVersion, kind: object.kind, name: object.metadata.name, ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}) };
}

function missingSecretKeys(secret: unknown, keys: readonly string[]): readonly string[] {
  const data = secret && typeof secret === 'object' ? Reflect.get(secret, 'data') : undefined;
  return keys.filter(key => !data || typeof data !== 'object' || typeof Reflect.get(data, key) !== 'string' || String(Reflect.get(data, key)).length === 0);
}

function validCredentialSelection(spec: CelldFleetSpec): boolean {
  const credentials = spec.objectStore.credentials;
  return credentials.type === 'secret'
    ? credentials.secretRef !== undefined && credentials.serviceAccountRef === undefined
    : credentials.serviceAccountRef !== undefined && credentials.secretRef === undefined;
}

function secretValue(secret: unknown, key: string): string | undefined {
  const data = secret && typeof secret === 'object' ? Reflect.get(secret, 'data') : undefined;
  const encoded = data && typeof data === 'object' ? Reflect.get(data, key) : undefined;
  if (typeof encoded !== 'string' || encoded.length === 0) return undefined;
  try { return globalThis.atob(encoded); } catch { return undefined; }
}

function readyPodCount(pods: readonly ResourceObject<object, KubernetesPodStatus>[]): number {
  return pods.filter(podReady).length;
}

function desiredPodCount(pods: readonly ResourceObject<object, KubernetesPodStatus>[], digest: string): number {
  return pods.filter(pod => podUsesImageDigest(pod, digest)).length;
}

function podReady(pod: ResourceObject<object, KubernetesPodStatus>): boolean {
  return pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True') === true;
}

function podUsesImageDigest(pod: ResourceObject<object, KubernetesPodStatus>, digest: string): boolean {
  const status = pod.status?.containerStatuses?.find(container => container.name === 'celld');
  return Boolean(status?.ready && status.imageID?.includes(digest));
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function blockingNodeStateEvidence(
  nodes: readonly {
    readonly pod: string;
    readonly state: {
      readonly ok: boolean;
      readonly evicting: number;
      readonly restoring: number;
    };
  }[],
): readonly string[] {
  return nodes
    .filter(({ state }) => !state.ok || state.evicting > 0 || state.restoring > 0)
    .map(({ pod, state }) =>
      `${pod} (${state.ok ? `${state.evicting} evicting, ${state.restoring} restoring` : 'state unavailable'})`,
    );
}

function conditions(
  generation: number,
  now: string,
  active: CelldFleetCondition['type'],
  reason: string,
  message: string,
  previous: readonly CelldFleetCondition[] = [],
): CelldFleetCondition[] {
  const types: CelldFleetCondition['type'][] = ['Ready', 'Progressing', 'Degraded', 'Draining', 'RestoreBlocked'];
  return types.map(type => {
    const status = type === active ? 'True' : 'False';
    const prior = previous.find(condition => condition.type === type);
    return {
      type,
      status,
      observedGeneration: generation,
      reason,
      message: type === active ? message : '',
      lastTransitionTime: prior?.status === status ? prior.lastTransitionTime : now,
    };
  });
}

function setDegradedStatus(fleet: CelldFleetHandlerScope, generation: number, reason: string, message: string): void {
  const now = new Date().toISOString();
  fleet.status.observedGeneration = generation;
  fleet.status.phase = 'Degraded';
  fleet.status.conditions = conditions(generation, now, 'Degraded', reason, message, fleet.status.conditions);
}

function setProgressingStatus(fleet: CelldFleetHandlerScope, generation: number, reason: string, message: string): void {
  const now = new Date().toISOString();
  fleet.status.observedGeneration = generation;
  fleet.status.phase = 'Progressing';
  fleet.status.conditions = conditions(generation, now, 'Progressing', reason, message, fleet.status.conditions);
}

export const celldOperatorInternals = Object.freeze({
  reconcile,
  finalize,
  reconcileRolloutState,
  observeCelldNodeState,
  blockingNodeStateEvidence,
  statefulSetDesiredReplicas,
  statefulSetUsesImageDigest,
  containsDesiredValue,
  classifyArtifactDeploymentReceipt,
  conditions,
});
