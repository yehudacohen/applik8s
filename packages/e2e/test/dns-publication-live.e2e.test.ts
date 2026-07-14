import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, formatSettledOutput, generatedManifestPaths, kubectl } from './live-e2e-helpers';

const suffix = `${process.pid}`;
const operatorNamespace = `applik8s-dns-operator-${suffix}`;
const destinationNamespace = `applik8s-dns-destination-${suffix}`;
const group = `dnsproof${suffix}.applik8s.dev`;
const operatorName = 'dns-publication-proof';
const remoteServiceAccount = 'dns-connection-client';
const connectionSecret = 'destination-kubeconfig';
const externalDnsServiceAccount = `external-dns-${suffix}`;
const externalDnsClusterRole = `external-dns-${suffix}`;
const localOwner = 'local-publication';
const remoteOwner = 'remote-publication';
const execFileAsync = promisify(execFile);

let tempDir: string | undefined;
let artifactDir: string | undefined;
let externalDnsManifestPath: string | undefined;
let installedDnsEndpointCrd = false;

describeLive('v0.5 reusable DNS publication proof', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-dns-live-'));
    await kubectl(['create', 'namespace', operatorNamespace]);
    await kubectl(['create', 'namespace', destinationNamespace]);
    await installDnsEndpointCrd();
    await installExternalDns();
    await installDestinationIdentity();
    await installConnectionSecret();

    const entrypoint = join(requiredTempDir(), 'dns-publication-proof.ts');
    await writeFile(entrypoint, operatorSource());
    const compiled = await createCompilerPipeline().run({
      entrypoint,
      outDir: join(requiredTempDir(), 'dist'),
      runtimeVersionRange: '^0.1.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      kubernetesConnectionBindings: {
        destination: {
          kubeconfigSecretRef: { name: connectionSecret, namespace: operatorNamespace, key: 'kubeconfig' },
          context: 'destination',
          endpointPolicy: { name: 'destination-dns', version: '1', scheme: 'https', hosts: ['kubernetes.default.svc'], ports: [443], redirects: 'deny' },
        },
      },
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: false,
        allowedHostImports: [],
        sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
      },
    });
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(compiled.value.manifest.spec.secondaryWatches).toContainEqual(expect.objectContaining({
      source: expect.objectContaining({ kind: 'DNSEndpoint' }),
      target: expect.objectContaining({ kind: 'DnsPublication' }),
      mapper: { mode: 'targetNameFromSourceField', source: { kind: 'annotation', key: 'dns.applik8s.dev/source-name' }, namespace: 'source' },
    }));
    expect(compiled.value.manifest.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [connectionSecret] });

    const image = await buildImplicitRuntimeImage({ manifest: compiled.value.manifest });
    if (!image.ok) throw new Error(image.error.message);
    artifactDir = join(requiredTempDir(), 'dist/kubernetes');
    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-dns-e2e', '--filename', manifestPath]);
    }
    await kubectl(['wait', `crd/dnspublications.${group}`, '--for=condition=Established', '--timeout=60s']);
    await rolloutWithDiagnostics(`deployment/${operatorName}`, operatorNamespace);
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') await cleanup();
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') await rm(tempDir, { recursive: true, force: true });
  }, 600_000);

  it('publishes, observes, updates, exact-wakes, and finalizes local and connection-scoped records', async () => {
    await applyOwner(localOwner, 'local', 'A', '192.0.2.10');
    await applyOwner(remoteOwner, 'connection', 'A', '192.0.2.20');
    await waitForOwner(localOwner, '192.0.2.10', 'Observed');
    await waitForOwner(remoteOwner, '192.0.2.20', 'Observed');

    const localEndpoint = await ownerStatus(localOwner, 'endpointName');
    const remoteEndpoint = await ownerStatus(remoteOwner, 'endpointName');
    const localUid = await endpointValue(operatorNamespace, localEndpoint, '.metadata.uid');
    const remoteUid = await endpointValue(destinationNamespace, remoteEndpoint, '.metadata.uid');
    expect(await endpointValue(operatorNamespace, localEndpoint, '.spec.endpoints[0].targets[0]')).toBe('192.0.2.10');
    expect(await endpointValue(destinationNamespace, remoteEndpoint, '.spec.endpoints[0].targets[0]')).toBe('192.0.2.20');
    expect(await endpointValue(operatorNamespace, localEndpoint, '.status.observedGeneration')).not.toBe('');
    expect(await endpointValue(destinationNamespace, remoteEndpoint, '.status.observedGeneration')).not.toBe('');

    await expect(canI([`--as=system:serviceaccount:${operatorNamespace}:${operatorName}-controller`, 'get', 'dnsendpoints.externaldns.k8s.io', '--namespace', destinationNamespace])).resolves.toBe(false);
    await expect(canI([`--as=system:serviceaccount:${destinationNamespace}:${remoteServiceAccount}`, 'get', 'dnsendpoints.externaldns.k8s.io', '--namespace', destinationNamespace])).resolves.toBe(true);

    await kubectl(['rollout', 'restart', `deployment/${operatorName}`, '--namespace', operatorNamespace]);
    await rolloutWithDiagnostics(`deployment/${operatorName}`, operatorNamespace);

    await applyOwner(localOwner, 'local', 'A', '192.0.2.11');
    await applyOwner(remoteOwner, 'connection', 'A', '192.0.2.21');
    await waitForOwner(localOwner, '192.0.2.11', 'Observed');
    await waitForOwner(remoteOwner, '192.0.2.21', 'Observed');
    expect(await endpointValue(operatorNamespace, localEndpoint, '.metadata.uid')).toBe(localUid);
    expect(await endpointValue(destinationNamespace, remoteEndpoint, '.metadata.uid')).toBe(remoteUid);

    await applyOwner(localOwner, 'local', 'CNAME', 'active.example.test');
    await applyOwner(remoteOwner, 'connection', 'CNAME', 'remote-active.example.test');
    await waitForOwner(localOwner, 'active.example.test', 'Observed');
    await waitForOwner(remoteOwner, 'remote-active.example.test', 'Observed');
    expect(await endpointValue(operatorNamespace, localEndpoint, '.metadata.uid')).toBe(localUid);
    expect(await endpointValue(operatorNamespace, localEndpoint, '.spec.endpoints[0].recordType')).toBe('CNAME');
    expect(await endpointValue(destinationNamespace, remoteEndpoint, '.metadata.uid')).toBe(remoteUid);
    expect(await endpointValue(destinationNamespace, remoteEndpoint, '.spec.endpoints[0].recordType')).toBe('CNAME');

    await applyOwner(localOwner, 'local', 'A', '192.0.2.10');
    await applyOwner(remoteOwner, 'connection', 'A', '192.0.2.20');
    await waitForOwner(localOwner, '192.0.2.10', 'Observed');
    await waitForOwner(remoteOwner, '192.0.2.20', 'Observed');
    expect(await endpointValue(operatorNamespace, localEndpoint, '.metadata.uid')).toBe(localUid);
    expect(await endpointValue(destinationNamespace, remoteEndpoint, '.metadata.uid')).toBe(remoteUid);

    await kubectl(['annotate', `dnsendpoint/${localEndpoint}`, '--namespace', operatorNamespace, 'dns.applik8s.dev/test-wake-token=exact-owner-only', '--overwrite']);
    await kubectl(['wait', `dnspublications.${group}/${localOwner}`, '--namespace', operatorNamespace, '--for=jsonpath={.status.wakeToken}=exact-owner-only', '--timeout=90s']);
    expect(await ownerStatus(remoteOwner, 'wakeToken')).toBe('');

    await kubectl(['delete', `dnspublications.${group}/${localOwner}`, `dnspublications.${group}/${remoteOwner}`, '--namespace', operatorNamespace, '--wait=true', '--timeout=180s']);
    expect((await kubectl(['get', `dnsendpoint/${localEndpoint}`, '--namespace', operatorNamespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `dnsendpoint/${remoteEndpoint}`, '--namespace', destinationNamespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
  }, 600_000);
});

function operatorSource(): string {
  return `import { dns, externalDnsPublicationMetadata, externalDnsPublicationName } from '@applik8s/applik8s/dns';
import { sdk } from '@applik8s/sdk';

const DnsPublication = sdk.crd({
  apiVersion: '${group}/v1alpha1', kind: 'DnsPublication',
  spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DnsPublicationSpec' }, schema: { type: 'object', additionalProperties: false, required: ['placement', 'recordType', 'target'], properties: { placement: { type: 'string', enum: ['local', 'connection'] }, recordType: { type: 'string', enum: ['A', 'CNAME'] }, target: { type: 'string' } } } },
  status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DnsPublicationStatus' }, schema: { type: 'object', additionalProperties: false, properties: { phase: { type: 'string' }, target: { type: 'string' }, endpointName: { type: 'string' }, intentState: { type: 'string' }, controllerState: { type: 'string' }, propagationState: { type: 'string' }, objectUid: { type: 'string' }, objectResourceVersion: { type: 'string' }, desiredGeneration: { type: 'integer' }, observedGeneration: { type: 'integer' }, intentDigest: { type: 'string' }, wakeToken: { type: 'string' }, diagnostic: { type: 'string' } } } },
});
const LocalDnsEndpoint = dns.externalDns.resource({ access: 'local', namespaces: ['${operatorNamespace}'] });
const RemoteDnsEndpoint = dns.externalDns.resource({ access: 'connection', namespaces: ['${destinationNamespace}'] });
const destination = sdk.kubernetes.connection.required({
  endpointPolicy: 'destination-dns',
  permissions: [{ apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: ['get', 'list', 'create', 'patch', 'delete'], namespaces: ['${destinationNamespace}'] }],
});
const capabilities = dns.externalDns.capabilities({
  crdSource: 'enabled', configuredRecordTypes: ['A', 'AAAA', 'CNAME'], managedDomainPatterns: ['example.test'], watchedNamespaces: 'all',
  controllerObservation: 'supported', mutationPolicy: 'sync', registry: 'noop', providerRecordOwnership: 'unconfigured', targetUpdates: 'supported', recordDeletion: 'supported', dryRun: false,
  propagationVerification: 'unavailable', configurationEvidenceRefs: [{ apiVersion: 'apps/v1', kind: 'Deployment', namespace: '${operatorNamespace}', name: 'external-dns' }],
});

function normalizedIntent(publication) {
  return dns.normalize({ publicationId: publication.metadata.name, dnsName: publication.metadata.name + '.example.test', record: publication.spec.recordType === 'CNAME' ? { type: 'CNAME', target: publication.spec.target } : { type: 'A', addresses: [publication.spec.target] }, ttlSeconds: 60 });
}
function ownership(publication, intent) {
  return { controllerId: '${group}/v1', publicationId: intent.publicationId, source: { apiVersion: '${group}/v1alpha1', kind: 'DnsPublication', namespace: publication.metadata.namespace, name: publication.metadata.name, uid: publication.metadata.uid } };
}
function setStatus(publication, field, value) {
  if (publication.object.status?.[field] !== value) publication.status[field] = value;
}

export const dnsPublicationProof = sdk.operator({
  name: '${operatorName}', deployment: { namespace: '${operatorNamespace}' }, resources: { DnsPublication }, reads: { LocalDnsEndpoint, RemoteDnsEndpoint }, capabilities: { destination },
  permissions: [{ apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: ['create', 'patch', 'delete'] }],
  secondaryWatches: [sdk.watch(LocalDnsEndpoint).enqueue(DnsPublication, { namespace: 'source', map: { mode: 'targetNameFromSourceField', source: { kind: 'annotation', key: externalDnsPublicationMetadata.sourceNameAnnotation } } })],
  handlers: ({ resources }) => [
    resources.DnsPublication.on.reconcile(async (publication) => {
      const intent = normalizedIntent(publication);
      if (!intent.ok) throw new Error(intent.error.message);
      const owner = ownership(publication, intent.value);
      const remoteMode = publication.spec.placement === 'connection';
      const namespace = remoteMode ? '${destinationNamespace}' : '${operatorNamespace}';
      const placement = remoteMode ? { mode: 'connection', connection: 'destination', namespace } : { mode: 'local', namespace };
      const endpointName = externalDnsPublicationName(owner.controllerId, owner.publicationId);
      const remote = remoteMode ? publication.kubernetes.connection('destination') : undefined;
      const current = remoteMode
        ? await remote.read.resource(RemoteDnsEndpoint).get({ name: endpointName, namespace })
        : await publication.read.resource(LocalDnsEndpoint).get({ name: endpointName, namespace });
      const decision = dns.externalDns.decide({ intent: intent.value, ownership: owner, placement, capabilities, requirements: { providerRecordOwnership: 'optional' }, ...(current ? { current } : {}) });
      if (decision.kind === 'apply') {
        if (remoteMode) remote.resources.apply(decision.resource, { ownership: { mode: 'none' }, authority: { mode: 'managed', identity: 'dns/' + publication.metadata.uid + '/' + publication.metadata.name, sourceUid: publication.metadata.uid } });
        else publication.resources.apply(decision.resource, { ownership: { mode: 'none' } });
        publication.requeue({ afterSeconds: 2, reason: 'DNS object applied' });
      } else if (decision.kind === 'patch') {
        if (remoteMode) remote.resources.patch(decision.ref, decision.patch, { authority: { mode: 'existing', precondition: decision.precondition } });
        else publication.resources.patch(decision.ref, decision.patch);
        publication.requeue({ afterSeconds: 2, reason: 'DNS object updated' });
      } else if (decision.kind === 'noop' && decision.observation.controller.state !== 'observed') {
        publication.requeue({ afterSeconds: 2, reason: 'ExternalDNS observation pending' });
      }
      setStatus(publication, 'phase', decision.kind === 'conflict' ? 'Conflict' : decision.kind === 'unsupported' ? 'Unsupported' : decision.observation.controller.state === 'observed' ? 'Observed' : 'Pending');
      setStatus(publication, 'target', publication.spec.target);
      setStatus(publication, 'endpointName', endpointName);
      setStatus(publication, 'intentState', decision.observation.intent.state);
      setStatus(publication, 'controllerState', decision.observation.controller.state);
      setStatus(publication, 'propagationState', decision.observation.propagation.state);
      setStatus(publication, 'intentDigest', intent.value.normalization.intentDigest);
      if (decision.kind === 'conflict' || decision.kind === 'unsupported') setStatus(publication, 'diagnostic', decision.diagnostic.message);
      const evidence = decision.observation.evidence[0];
      if (evidence) {
        setStatus(publication, 'objectUid', evidence.uid);
        setStatus(publication, 'objectResourceVersion', evidence.resourceVersion);
        setStatus(publication, 'desiredGeneration', evidence.desiredGeneration);
        if (evidence.observedGeneration !== undefined) setStatus(publication, 'observedGeneration', evidence.observedGeneration);
      }
      const wakeToken = current?.metadata.annotations?.['dns.applik8s.dev/test-wake-token'];
      if (wakeToken) setStatus(publication, 'wakeToken', wakeToken);
    }),
    resources.DnsPublication.on.finalize(async (publication) => {
      const intent = normalizedIntent(publication);
      if (!intent.ok) throw new Error(intent.error.message);
      const owner = ownership(publication, intent.value);
      const remoteMode = publication.spec.placement === 'connection';
      const namespace = remoteMode ? '${destinationNamespace}' : '${operatorNamespace}';
      const placement = remoteMode ? { mode: 'connection', connection: 'destination', namespace } : { mode: 'local', namespace };
      const endpointName = externalDnsPublicationName(owner.controllerId, owner.publicationId);
      const remote = remoteMode ? publication.kubernetes.connection('destination') : undefined;
      const current = remoteMode
        ? await remote.read.resource(RemoteDnsEndpoint).get({ name: endpointName, namespace })
        : await publication.read.resource(LocalDnsEndpoint).get({ name: endpointName, namespace });
      const decision = dns.externalDns.decideDelete({ ownership: owner, placement, capabilities, requirements: { providerRecordOwnership: 'optional' }, ...(current ? { current } : {}) });
      if (decision.kind === 'delete') {
        if (remoteMode) remote.resources.delete(decision.ref, { preconditions: decision.precondition, authority: { mode: 'existing', precondition: { uid: decision.precondition.uid, resourceVersion: decision.precondition.resourceVersion } } });
        else publication.resources.delete(decision.ref, { preconditions: decision.precondition });
      } else if (decision.kind === 'conflict' || decision.kind === 'unsupported') throw new Error(decision.diagnostic.message);
    }, { finalizer: '${group}/dns-cleanup' }),
  ],
});
`;
}

async function installDnsEndpointCrd(): Promise<void> {
  const existing = await kubectl(['get', 'crd/dnsendpoints.externaldns.k8s.io', '--ignore-not-found=true', '--output=name']);
  if (existing.stdout.trim()) return;
  installedDnsEndpointCrd = true;
  const path = join(requiredTempDir(), 'dnsendpoint-crd.yaml');
  await writeFile(path, `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  annotations:
    api-approved.kubernetes.io: https://github.com/kubernetes-sigs/external-dns/pull/2007
  name: dnsendpoints.externaldns.k8s.io
spec:
  group: externaldns.k8s.io
  scope: Namespaced
  names:
    plural: dnsendpoints
    singular: dnsendpoint
    kind: DNSEndpoint
  versions:
    - name: v1alpha1
      served: true
      storage: true
      subresources:
        status: {}
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                endpoints:
                  type: array
                  items:
                    type: object
                    required: [dnsName, recordType, targets]
                    properties:
                      dnsName: { type: string }
                      recordType: { type: string }
                      recordTTL: { type: integer, format: int64 }
                      targets:
                        type: array
                        items: { type: string }
            status:
              type: object
              properties:
                observedGeneration: { type: integer, format: int64 }
`);
  await kubectl(['apply', '--filename', path]);
  await kubectl(['wait', 'crd/dnsendpoints.externaldns.k8s.io', '--for=condition=Established', '--timeout=60s']);
}

async function installExternalDns(): Promise<void> {
  externalDnsManifestPath = join(requiredTempDir(), 'external-dns.yaml');
  await writeFile(externalDnsManifestPath, `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${externalDnsServiceAccount}
  namespace: ${operatorNamespace}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${externalDnsClusterRole}
rules:
  - apiGroups: [externaldns.k8s.io]
    resources: [dnsendpoints]
    verbs: [get, list, watch]
  - apiGroups: [externaldns.k8s.io]
    resources: [dnsendpoints/status]
    verbs: [get, update, patch]
  - apiGroups: ['']
    resources: [events]
    verbs: [create, patch, update]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${externalDnsClusterRole}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${externalDnsClusterRole}
subjects:
  - kind: ServiceAccount
    name: ${externalDnsServiceAccount}
    namespace: ${operatorNamespace}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-dns
  namespace: ${operatorNamespace}
spec:
  replicas: 1
  selector:
    matchLabels: { app.kubernetes.io/name: external-dns }
  template:
    metadata:
      labels: { app.kubernetes.io/name: external-dns }
    spec:
      serviceAccountName: ${externalDnsServiceAccount}
      containers:
        - name: external-dns
          image: registry.k8s.io/external-dns/external-dns:v0.21.0
          args:
            - --source=crd
            - --crd-source-apiversion=externaldns.k8s.io/v1alpha1
            - --crd-source-kind=DNSEndpoint
            - --provider=inmemory
            - --registry=noop
            - --policy=sync
            - --domain-filter=example.test
            - --interval=1s
            - --log-level=debug
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65532
            runAsGroup: 65532
            capabilities: { drop: [ALL] }
`);
  await kubectl(['apply', '--filename', externalDnsManifestPath]);
  await rolloutWithDiagnostics('deployment/external-dns', operatorNamespace);
}

async function installDestinationIdentity(): Promise<void> {
  const path = join(requiredTempDir(), 'destination-rbac.yaml');
  await writeFile(path, `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${remoteServiceAccount}
  namespace: ${destinationNamespace}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${remoteServiceAccount}
  namespace: ${destinationNamespace}
rules:
  - apiGroups: [externaldns.k8s.io]
    resources: [dnsendpoints]
    verbs: [get, list, create, patch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${remoteServiceAccount}
  namespace: ${destinationNamespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${remoteServiceAccount}
subjects:
  - kind: ServiceAccount
    name: ${remoteServiceAccount}
    namespace: ${destinationNamespace}
`);
  await kubectl(['apply', '--filename', path]);
}

async function installConnectionSecret(): Promise<void> {
  const token = (await kubectl(['create', 'token', remoteServiceAccount, '--namespace', destinationNamespace, '--duration=1h'])).stdout.trim();
  const ca = (await kubectl(['get', 'configmap/kube-root-ca.crt', '--namespace', operatorNamespace, '--output=jsonpath={.data.ca\\.crt}'])).stdout;
  if (!token || !ca) throw new Error('Could not obtain the bounded destination token and cluster CA.');
  const kubeconfig = `apiVersion: v1
kind: Config
clusters:
  - name: destination
    cluster:
      server: https://kubernetes.default.svc:443
      certificate-authority-data: ${Buffer.from(ca).toString('base64')}
users:
  - name: destination
    user: { token: ${JSON.stringify(token)} }
contexts:
  - name: destination
    context: { cluster: destination, user: destination }
current-context: destination
`;
  const path = join(requiredTempDir(), 'connection-secret.yaml');
  await writeFile(path, `apiVersion: v1
kind: Secret
metadata:
  name: ${connectionSecret}
  namespace: ${operatorNamespace}
type: applik8s.dev/kubeconfig
stringData:
  kubeconfig: ${JSON.stringify(kubeconfig)}
`);
  await kubectl(['apply', '--filename', path]);
}

async function applyOwner(name: string, placement: 'local' | 'connection', recordType: 'A' | 'CNAME', target: string): Promise<void> {
  const path = join(requiredTempDir(), `${name}.yaml`);
  await writeFile(path, `apiVersion: ${group}/v1alpha1
kind: DnsPublication
metadata:
  name: ${name}
  namespace: ${operatorNamespace}
spec:
  placement: ${placement}
  recordType: ${recordType}
  target: ${target}
`);
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-dns-e2e', '--filename', path]);
}

async function waitForOwner(name: string, target: string, phase: string): Promise<void> {
  try {
    await kubectl(['wait', `dnspublications.${group}/${name}`, '--namespace', operatorNamespace, `--for=jsonpath={.status.target}=${target}`, '--timeout=180s']);
    await kubectl(['wait', `dnspublications.${group}/${name}`, '--namespace', operatorNamespace, `--for=jsonpath={.status.phase}=${phase}`, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `dnspublications.${group}/${name}`, '--namespace', operatorNamespace, '--output=yaml']),
      kubectl(['get', 'dnsendpoints.externaldns.k8s.io', '--all-namespaces', '--output=yaml']),
      kubectl(['logs', '--namespace', operatorNamespace, '--selector', `app.kubernetes.io/name=${operatorName}`, '--all-containers=true', '--tail=300']),
      kubectl(['logs', '--namespace', operatorNamespace, '--selector', 'app.kubernetes.io/name=external-dns', '--all-containers=true', '--tail=300']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'DNS publication did not converge.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function ownerStatus(name: string, field: string): Promise<string> {
  return (await kubectl(['get', `dnspublications.${group}/${name}`, '--namespace', operatorNamespace, `--output=jsonpath={.status.${field}}`])).stdout.trim();
}

async function endpointValue(namespace: string, name: string, path: string): Promise<string> {
  return (await kubectl(['get', `dnsendpoint/${name}`, '--namespace', namespace, `--output=jsonpath={${path}}`])).stdout.trim();
}

async function rolloutWithDiagnostics(resource: string, namespace: string): Promise<void> {
  try {
    await kubectl(['rollout', 'status', resource, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', resource, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--output=wide']),
      kubectl(['logs', '--namespace', namespace, '--all-containers=true', '--prefix=true', '--tail=300']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : `${resource} rollout failed.`}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function canI(args: readonly string[]): Promise<boolean> {
  try {
    const result = await execFileAsync('kubectl', ['auth', 'can-i', ...args], { cwd: process.cwd(), env: process.env });
    return result.stdout.trim() === 'yes';
  } catch (cause) {
    if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 1) return false;
    throw cause;
  }
}

async function cleanup(): Promise<void> {
  if (artifactDir) {
    await kubectl(['delete', `dnspublications.${group}`, '--all', '--namespace', operatorNamespace, '--ignore-not-found=true', '--wait=true', '--timeout=180s']);
    const endpoints = await kubectl(['get', 'dnsendpoints.externaldns.k8s.io', '--namespace', operatorNamespace, '--ignore-not-found=true', '--output=name']);
    const remoteEndpoints = await kubectl(['get', 'dnsendpoints.externaldns.k8s.io', '--namespace', destinationNamespace, '--ignore-not-found=true', '--output=name']);
    if (endpoints.stdout.trim() || remoteEndpoints.stdout.trim()) throw new Error(`DNS finalization left endpoints behind:\n${endpoints.stdout}${remoteEndpoints.stdout}`);
    const manifests = await generatedManifestPaths(artifactDir);
    const crds: string[] = [];
    for (const path of manifests) {
      if (/^kind:\s*CustomResourceDefinition\s*$/m.test(await readFile(path, 'utf8'))) crds.push(path);
    }
    for (const path of manifests.filter((candidate) => !crds.includes(candidate)).reverse()) await kubectl(['delete', '--filename', path, '--ignore-not-found=true', '--wait=true', '--timeout=120s']);
    for (const path of crds) await kubectl(['delete', '--filename', path, '--ignore-not-found=true', '--wait=false']);
    await waitForOwnerCrdDeletion();
  }
  if (externalDnsManifestPath) await kubectl(['delete', '--filename', externalDnsManifestPath, '--ignore-not-found=true', '--wait=true', '--timeout=120s']);
  await kubectl(['delete', `secret/${connectionSecret}`, '--namespace', operatorNamespace, '--ignore-not-found=true', '--wait=true', '--timeout=30s']);
  await kubectl([
    'delete',
    `serviceaccount/${remoteServiceAccount}`,
    `role/${remoteServiceAccount}`,
    `rolebinding/${remoteServiceAccount}`,
    '--namespace', destinationNamespace,
    '--ignore-not-found=true',
    '--wait=true',
    '--timeout=30s',
  ]);
  await Promise.all([
    kubectl(['delete', 'events', '--all', '--namespace', operatorNamespace, '--ignore-not-found=true', '--wait=false']),
    kubectl(['delete', 'events', '--all', '--namespace', destinationNamespace, '--ignore-not-found=true', '--wait=false']),
  ]);
  await deleteTestNamespaces();
  if (installedDnsEndpointCrd) {
    const remaining = await kubectl(['get', 'dnsendpoints.externaldns.k8s.io', '--all-namespaces', '--ignore-not-found=true', '--output=name']);
    if (!remaining.stdout.trim()) await kubectl(['delete', 'crd/dnsendpoints.externaldns.k8s.io', '--ignore-not-found=true', '--wait=true', '--timeout=120s']);
  }
}

function requiredTempDir(): string {
  if (!tempDir) throw new Error('DNS proof temporary directory was not created.');
  return tempDir;
}

async function deleteTestNamespaces(): Promise<void> {
  await kubectl(['delete', 'namespace', operatorNamespace, destinationNamespace, '--ignore-not-found=true', '--wait=false']);
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const remaining = await remainingNamespaces();
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  for (const namespace of await remainingNamespaces()) await finalizeEmptyNamespace(namespace);
  await kubectl(['wait', '--for=delete', `namespace/${operatorNamespace}`, `namespace/${destinationNamespace}`, '--timeout=60s']);
}

async function waitForOwnerCrdDeletion(): Promise<void> {
  const crdName = `dnspublications.${group}`;
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const result = await kubectl(['get', `crd/${crdName}`, '--ignore-not-found=true', '--output=name']);
    if (!result.stdout.trim()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const remaining = await kubectl(['get', `dnspublications.${group}`, '--all-namespaces', '--ignore-not-found=true', '--output=name']);
  if (remaining.stdout.trim()) throw new Error(`Refusing to finalize crd/${crdName}; instances remain:\n${remaining.stdout}`);
  await kubectl(['patch', `crd/${crdName}`, '--type=merge', '--patch', '{"metadata":{"finalizers":[]}}']);
  await kubectl(['wait', '--for=delete', `crd/${crdName}`, '--timeout=30s']);
}

async function remainingNamespaces(): Promise<string[]> {
  const result = await kubectl(['get', 'namespace', operatorNamespace, destinationNamespace, '--ignore-not-found=true', '--output=jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}']);
  return result.stdout.split('\n').map((value) => value.trim()).filter(Boolean);
}

async function finalizeEmptyNamespace(namespace: string): Promise<void> {
  const resourceTypes = [
    'pods', 'services', 'endpoints', 'endpointslices.discovery.k8s.io',
    'deployments.apps', 'replicasets.apps', 'statefulsets.apps', 'jobs.batch',
    'configmaps', 'secrets', 'serviceaccounts', 'events',
    'roles.rbac.authorization.k8s.io', 'rolebindings.rbac.authorization.k8s.io',
    'leases.coordination.k8s.io', 'networkpolicies.networking.k8s.io',
    'dnsendpoints.externaldns.k8s.io',
  ];
  const listed = await Promise.allSettled(resourceTypes.map((resource) => kubectl(['get', resource, '--namespace', namespace, '--ignore-not-found=true', '--output=name'])));
  const failures = listed.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length > 0) throw new Error(`Refusing to finalize namespace/${namespace}; ${failures.length} resource queries failed.`);
  const remaining = listed
    .flatMap((result) => result.status === 'fulfilled' ? result.value.stdout.split('\n').map((value) => value.trim()).filter(Boolean) : [])
    .filter((resource) => resource !== 'configmap/kube-root-ca.crt' && resource !== 'serviceaccount/default');
  if (remaining.length > 0) throw new Error(`Refusing to finalize namespace/${namespace}; resources remain:\n${remaining.join('\n')}`);
  await kubectl(['delete', 'configmap/kube-root-ca.crt', 'serviceaccount/default', '--namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  const namespaceDocument: { spec?: { finalizers?: string[] } } = JSON.parse((await kubectl(['get', `namespace/${namespace}`, '--output=json'])).stdout);
  namespaceDocument.spec = { ...namespaceDocument.spec, finalizers: [] };
  const path = join(requiredTempDir(), `finalize-${namespace}.json`);
  await writeFile(path, JSON.stringify(namespaceDocument));
  await kubectl(['replace', '--raw', `/api/v1/namespaces/${namespace}/finalize`, '--filename', path]);
}
