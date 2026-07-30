import { createHash } from 'node:crypto';
import type { DnsEndpointObject, DnsPublicationCapabilities, DnsPublicationEvidence, DnsPublicationOwnership, DnsPublicationPlacement, JsonSchemaSource, NormalizedDnsPublicationIntent } from '@applik8s/core';
import { dispatchOperatorHandler, sdk } from '@applik8s/sdk';
import { describe, expect, it } from 'vitest';
import {
  decideExternalDnsPublication,
  decideExternalDnsPublicationDelete,
  externalDnsCapabilities,
  externalDnsEndpointResource,
  externalDnsPublicationMetadata,
  externalDnsPublicationName,
  normalizeDnsPublicationIntent,
} from '../src/dns.js';

describe('v0.5 reusable DNS publication primitives', () => {
  it('normalizes record-specific inputs and produces stable versioned digests', () => {
    const first = normalized({
      publicationId: 'tenant.primary',
      dnsName: 'BÜCHER.Example.',
      record: { type: 'A', addresses: ['192.0.2.10', '192.0.2.2', '192.0.2.10'] },
      ttlSeconds: 60,
    });
    const equivalent = normalized({
      publicationId: 'tenant.primary',
      dnsName: 'xn--bcher-kva.example',
      record: { type: 'A', addresses: ['192.0.2.2', '192.0.2.10'] },
      ttlSeconds: 60,
    });
    expect(first).toMatchObject({
      publicationId: 'tenant.primary',
      dnsName: 'xn--bcher-kva.example',
      record: { type: 'A', addresses: ['192.0.2.10', '192.0.2.2'] },
      normalization: { version: 'applik8s.dns-normalization/v1', digestAlgorithm: 'sha256' },
    });
    expect(first.normalization.intentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(equivalent.normalization.intentDigest).toBe(first.normalization.intentDigest);

    expect(normalized({ publicationId: 'ipv6', dnsName: 'v6.example.test', record: { type: 'AAAA', addresses: ['2001:0DB8:0:0:0:0:0:1', '::ffff:192.0.2.1'] } }).record).toEqual({
      type: 'AAAA',
      addresses: ['2001:db8::1', '::ffff:c000:201'],
    });
    expect(normalized({ publicationId: 'alias', dnsName: 'www.example.test', record: { type: 'CNAME', target: 'Origin.Example.Test.' } }).record).toEqual({ type: 'CNAME', target: 'origin.example.test' });
  });

  it('rejects ambiguous or invalid record inputs without branded caller casts', () => {
    expect(normalizeDnsPublicationIntent({ publicationId: 'bad ttl', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] }, ttlSeconds: 0 })).toMatchObject({ ok: false, error: { code: 'SCHEMA_INVALID' } });
    expect(normalizeDnsPublicationIntent({ publicationId: 'valid', dnsName: '*.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } })).toMatchObject({ ok: false });
    expect(normalizeDnsPublicationIntent({ publicationId: 'valid', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.168.001.1'] } })).toMatchObject({ ok: false });
    expect(normalizeDnsPublicationIntent({ publicationId: 'valid', dnsName: 'app.example.test', record: { type: 'AAAA', addresses: ['2001::db8::1'] } })).toMatchObject({ ok: false });
    expect(normalizeDnsPublicationIntent({ publicationId: 'valid', dnsName: 'app.example.test', record: { type: 'CNAME', target: 'https://origin.example.test' } })).toMatchObject({ ok: false });
  });

  it('declares the canonical external resource for local or connection-scoped access', () => {
    expect(externalDnsEndpointResource({ access: 'local', namespaces: ['dns-system'] })).toMatchObject({
      apiVersion: 'externaldns.k8s.io/v1alpha1', kind: 'DNSEndpoint', plural: 'dnsendpoints', scope: 'Namespaced', access: 'local', namespaces: ['dns-system'],
    });
    const remote = externalDnsEndpointResource({ access: 'connection', namespaces: ['remote-dns'] });
    expect(remote.access).toBe('connection');
    expect(remote.permissions.read()).toEqual({ apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: ['get', 'list'] });
  });

  it('rejects invalid Kubernetes placement before rendering or reading provider state', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const ownership = owner(intent);
    expect(decideExternalDnsPublication({ intent, ownership, placement: { mode: 'local', namespace: 'DNS_System' }, capabilities })).toMatchObject({ kind: 'conflict', diagnostic: { code: 'SCHEMA_INVALID' } });
    expect(decideExternalDnsPublication({ intent, ownership, placement: { mode: 'connection', connection: 'Destination!', namespace: 'dns-system' }, capabilities })).toMatchObject({ kind: 'conflict', diagnostic: { code: 'SCHEMA_INVALID' } });
  });

  it('creates a deterministic owned DNSEndpoint and keeps its identity across record mutations', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] }, ttlSeconds: 60 });
    const ownership = owner(intent);
    const expectedName = `dns-${createHash('sha256').update(`applik8s.dns-identity/v1\u0000${ownership.controllerId}\u0000${intent.publicationId}`).digest('hex').slice(0, 32)}`;
    expect(externalDnsPublicationName(ownership.controllerId, intent.publicationId)).toBe(expectedName);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    expect(create.kind).toBe('apply');
    if (create.kind !== 'apply') return;
    expect(create.resource).toMatchObject({
      apiVersion: 'externaldns.k8s.io/v1alpha1',
      kind: 'DNSEndpoint',
      metadata: {
        name: externalDnsPublicationName(ownership.controllerId, intent.publicationId),
        namespace: 'dns-system',
        labels: { 'app.kubernetes.io/managed-by': 'applik8s' },
        annotations: {
          [externalDnsPublicationMetadata.publicationIdAnnotation]: 'tenant.primary',
          [externalDnsPublicationMetadata.sourceUidAnnotation]: 'source-uid',
          [externalDnsPublicationMetadata.sourceNameAnnotation]: 'tenant-a',
          [externalDnsPublicationMetadata.intentDigestAnnotation]: intent.normalization.intentDigest,
        },
      },
      spec: { endpoints: [{ dnsName: 'app.example.test', recordType: 'A', targets: ['192.0.2.1'], recordTTL: 60 }] },
    });
    expect(create.observation).toMatchObject({ intent: { state: 'absent' }, controller: { state: 'unavailable' }, propagation: { state: 'notChecked' } });

    const current = observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '42', generation: 1, observedGeneration: 1 });
    const changed = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'CNAME', target: 'active.example.test' }, ttlSeconds: 60 });
    const update = decideExternalDnsPublication({ intent: changed, ownership: owner(changed), placement: localPlacement, capabilities, current });
    expect(update.kind).toBe('patch');
    if (update.kind !== 'patch') return;
    expect(update.ref.name).toBe(create.resource.metadata.name);
    expect(update.precondition).toEqual({ uid: 'endpoint-uid', resourceVersion: '42' });
    expect(update.patch.slice(0, 2)).toEqual([
      { op: 'test', path: '/metadata/uid', value: 'endpoint-uid' },
      { op: 'test', path: '/metadata/resourceVersion', value: '42' },
    ]);
    expect(update.patch.at(-1)).toEqual({ op: 'add', path: '/spec', value: { endpoints: [{ dnsName: 'app.example.test', recordType: 'CNAME', targets: ['active.example.test'], recordTTL: 60 }] } });
    expect(update.observation.intent.state).toBe('drifted');
    expect(update.observation.controller).toEqual({ state: 'pending', desiredGeneration: 2, observedGeneration: 1 });
  });

  it('returns current orthogonal observation and durable redacted evidence without claiming propagation', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const ownership = owner(intent);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const current = observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '43', generation: 2, observedGeneration: 2 });
    const decision = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities, current });
    expect(decision.kind).toBe('noop');
    expect(decision.observation).toMatchObject({
      intent: { state: 'current', generation: 2, intentDigest: intent.normalization.intentDigest },
      controller: { state: 'observed', desiredGeneration: 2, observedGeneration: 2 },
      propagation: { state: 'notChecked' },
      diagnostics: [],
      evidence: [{ name: current.metadata.name, uid: 'endpoint-uid', resourceVersion: '43', desiredGeneration: 2, observedGeneration: 2, sourceUid: 'source-uid' }],
    });
    expect(JSON.stringify(decision.observation)).not.toMatch(/credential|secret|kubeconfig/i);
  });

  it('compares Kubernetes objects semantically rather than by serialized property order', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] }, ttlSeconds: 60 });
    const ownership = owner(intent);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const endpoint = create.resource.spec.endpoints[0];
    if (!endpoint) throw new Error('Expected one rendered endpoint.');
    const reordered: DnsEndpointObject = {
      ...observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '43', generation: 2, observedGeneration: 2 }),
      spec: { endpoints: [{ dnsName: endpoint.dnsName, ...(endpoint.recordTTL === undefined ? {} : { recordTTL: endpoint.recordTTL }), recordType: endpoint.recordType, targets: endpoint.targets }] },
    };
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities, current: reordered })).toMatchObject({ kind: 'noop', observation: { controller: { state: 'observed' } } });
  });

  it('fails closed on ownership mismatch and same-name replacement', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const ownership = owner(intent);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const unowned = observed({ ...create.resource, metadata: { ...create.resource.metadata, annotations: {} } }, { uid: 'foreign', resourceVersion: '1', generation: 1 });
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities, current: unowned })).toMatchObject({ kind: 'conflict', diagnostic: { code: 'RESOURCE_CONFLICT' } });

    const current = observed(create.resource, { uid: 'new-uid', resourceVersion: '2', generation: 1 });
    const previousEvidence: DnsPublicationEvidence = {
      adapter: 'external-dns', apiVersion: 'externaldns.k8s.io/v1alpha1', kind: 'DNSEndpoint', placement: localPlacement,
      name: current.metadata.name, uid: 'old-uid', resourceVersion: '1', desiredGeneration: 1,
      controllerId: ownership.controllerId, publicationId: ownership.publicationId, sourceUid: ownership.source.uid,
      normalizationVersion: 'applik8s.dns-normalization/v1', digestAlgorithm: 'sha256', intentDigest: intent.normalization.intentDigest,
      capabilityEvidenceRefs: capabilities.installation.configurationEvidenceRefs,
    };
    expect(decideExternalDnsPublication({ intent, ownership: { ...ownership, previousEvidence }, placement: localPlacement, capabilities, current })).toMatchObject({ kind: 'conflict', diagnostic: { message: expect.stringContaining('replaced') } });
  });

  it('makes installation policy and provider-record ownership executable', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const ownership = owner(intent);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const current = observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '5', generation: 1 });
    const changed = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.2'] } });
    const createOnly = withInstallation({ mutationPolicy: 'create-only', targetUpdates: 'unsupported' });
    expect(decideExternalDnsPublication({ intent: changed, ownership: owner(changed), placement: localPlacement, capabilities: createOnly, current })).toMatchObject({ kind: 'unsupported', diagnostic: { code: 'CAPABILITY_MISSING' } });

    const noRegistry = withInstallation({ registry: 'noop', providerRecordOwnership: 'unconfigured' });
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities: noRegistry })).toMatchObject({ kind: 'unsupported' });
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities: noRegistry, requirements: { providerRecordOwnership: 'optional' } }).kind).toBe('apply');
  });

  it('accepts only current, capability-backed propagation evidence without overstating it', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const ownership = owner(intent);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const current = observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '5', generation: 1, observedGeneration: 1 });
    const verification = {
      verifier: 'dns-query/v1', checkedAt: '2026-07-14T12:00:00Z',
      intentDigest: intent.normalization.intentDigest, dnsName: intent.dnsName, recordType: intent.record.type,
      expected: ['192.0.2.1'], observed: ['192.0.2.1'], evidenceDigest: `sha256:${'a'.repeat(64)}`,
    };

    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities, current, propagation: { state: 'verified', verification } }).observation).toMatchObject({
      propagation: { state: 'notChecked' }, diagnostics: [{ code: 'CAPABILITY_MISSING' }],
    });
    const verifierCapabilities = withInstallation({ propagationVerification: 'available' });
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities: verifierCapabilities, current, propagation: { state: 'verified', verification } }).observation.propagation).toEqual({ state: 'verified', verification });
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities: verifierCapabilities, current, propagation: { state: 'verified', verification: { ...verification, observed: ['192.0.2.99'] } } }).observation).toMatchObject({
      propagation: { state: 'mismatch' }, diagnostics: [{ code: 'RESOURCE_CONFLICT' }],
    });
    expect(decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities: verifierCapabilities, current, propagation: { state: 'verified', verification: { ...verification, expected: ['192.0.2.99'] } } }).observation).toMatchObject({
      propagation: { state: 'notChecked' }, diagnostics: [{ code: 'SCHEMA_INVALID' }],
    });
    const otherIntent = normalized({ publicationId: 'tenant.primary', dnsName: 'other.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    expect(decideExternalDnsPublication({ intent: otherIntent, ownership: owner(otherIntent), placement: localPlacement, capabilities: verifierCapabilities, current, propagation: { state: 'verified', verification } }).observation).toMatchObject({
      propagation: { state: 'notChecked' }, diagnostics: [{ code: 'SCHEMA_INVALID' }],
    });
  });

  it('deletes only an ownership-proven object with sync-policy UID preconditions', () => {
    const intent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const ownership = owner(intent);
    const create = decideExternalDnsPublication({ intent, ownership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const current = observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '9', generation: 1, observedGeneration: 1 });
    expect(decideExternalDnsPublicationDelete({ ownership, placement: localPlacement, capabilities, current })).toMatchObject({
      kind: 'delete',
      ref: { uid: 'endpoint-uid', resourceVersion: '9' },
      precondition: { uid: 'endpoint-uid', resourceVersion: '9' },
    });
    expect(decideExternalDnsPublicationDelete({ ownership, placement: localPlacement, capabilities: withInstallation({ mutationPolicy: 'upsert-only', recordDeletion: 'unsupported' }), current })).toMatchObject({ kind: 'unsupported' });
    expect(decideExternalDnsPublicationDelete({ ownership, placement: localPlacement, capabilities })).toMatchObject({ kind: 'noop', observation: { intent: { state: 'absent' } } });
  });

  it('dispatches typed local observation into one guarded patch operation', async () => {
    const Owner = dnsOwnerResource();
    const Endpoint = externalDnsEndpointResource({ access: 'local', namespaces: ['dns-system'] });
    const initialIntent = normalized({ publicationId: 'tenant.primary', dnsName: 'app.example.test', record: { type: 'A', addresses: ['192.0.2.1'] } });
    const initialOwnership: DnsPublicationOwnership = {
      controllerId: 'dns-controller.applik8s.dev/v1', publicationId: initialIntent.publicationId,
      source: { apiVersion: 'dns.applik8s.dev/v1alpha1', kind: 'DnsOwner', namespace: 'dns-system', name: 'tenant-a', uid: 'source-uid' },
    };
    const create = decideExternalDnsPublication({ intent: initialIntent, ownership: initialOwnership, placement: localPlacement, capabilities });
    if (create.kind !== 'apply') throw new Error('Expected create decision.');
    const current = observed(create.resource, { uid: 'endpoint-uid', resourceVersion: '42', generation: 1, observedGeneration: 1 });
    const operator = sdk.operator({
      name: 'dns-local-dispatch', resources: { Owner }, reads: { Endpoint },
      handlers: [Owner.on.context.reconcile(async (resource, ctx) => {
        const nextIntent = normalizeDnsPublicationIntent({ publicationId: resource.spec.publicationId, dnsName: resource.spec.dnsName, record: { type: 'A', addresses: resource.spec.addresses } });
        if (!nextIntent.ok) throw new Error(nextIntent.error.message);
        const nextOwnership = dnsOwner(resource, nextIntent.value);
        const live = await ctx.read.resource(Endpoint).get({ name: externalDnsPublicationName(nextOwnership.controllerId, nextIntent.value.publicationId), namespace: 'dns-system' });
        const decision = decideExternalDnsPublication({ intent: nextIntent.value, ownership: nextOwnership, placement: localPlacement, capabilities, ...(live ? { current: live } : {}) });
        if (decision.kind === 'patch') return ctx.apply({ patch: [{ kind: 'patch', ref: decision.ref, patch: decision.patch }] });
        return ctx.noop();
      })],
    });

    const output = await dispatchOperatorHandler(operator.definition, ownerInput('DnsOwner.reconcile.0', ['192.0.2.2']), {
      kubernetesRead(requestJson) {
        expect(JSON.parse(requestJson)).toMatchObject({ operation: 'get', apiVersion: 'externaldns.k8s.io/v1alpha1', kind: 'DNSEndpoint', query: { namespace: 'dns-system', name: current.metadata.name } });
        return JSON.stringify({ ok: true, value: current });
      },
    });
    const plan: { readonly operations: readonly [{ readonly kind: string; readonly ref: object; readonly patch: readonly unknown[] }] } = JSON.parse(output);
    expect(plan.operations[0]).toMatchObject({ kind: 'patch', ref: { uid: 'endpoint-uid', resourceVersion: '42' } });
    expect(plan.operations[0].patch.slice(0, 2)).toEqual([
      { op: 'test', path: '/metadata/uid', value: 'endpoint-uid' },
      { op: 'test', path: '/metadata/resourceVersion', value: '42' },
    ]);
  });

  it('dispatches connection-scoped create and guarded delete without local resource authority', async () => {
    const Owner = dnsOwnerResource();
    const Endpoint = externalDnsEndpointResource({ access: 'connection', namespaces: ['dns-system'] });
    const destination = sdk.kubernetes.connection.required({
      endpointPolicy: 'dns-destination',
      permissions: [{ apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: ['get', 'list', 'create', 'patch', 'delete'], namespaces: ['dns-system'] }],
    });
    const operator = sdk.operator({
      name: 'dns-connection-dispatch', resources: { Owner }, reads: { Endpoint }, capabilities: { destination },
      handlers: [Owner.on.context.reconcile(async (resource, ctx) => {
        const nextIntent = normalizeDnsPublicationIntent({ publicationId: resource.spec.publicationId, dnsName: resource.spec.dnsName, record: { type: 'A', addresses: resource.spec.addresses } });
        if (!nextIntent.ok) throw new Error(nextIntent.error.message);
        const ownership = dnsOwner(resource, nextIntent.value);
        const placement: DnsPublicationPlacement = { mode: 'connection', connection: 'destination', namespace: 'dns-system' };
        const remote = ctx.kubernetes.connection('destination');
        const current = await remote.read.resource(Endpoint).get({ name: externalDnsPublicationName(ownership.controllerId, nextIntent.value.publicationId), namespace: 'dns-system' });
        const decision = decideExternalDnsPublication({ intent: nextIntent.value, ownership, placement, capabilities, ...(current ? { current } : {}) });
        if (decision.kind === 'apply') remote.resources.apply(decision.resource, { ownership: { mode: 'none' }, authority: { mode: 'managed', identity: `dns/${resource.metadata.uid}/${nextIntent.value.publicationId}`, sourceUid: resource.metadata.uid ?? '' } });
        return ctx.noop();
      })],
    });

    const output = await dispatchOperatorHandler(operator.definition, ownerInput('DnsOwner.reconcile.0', ['192.0.2.2']), {
      kubernetesRead(requestJson) {
        expect(JSON.parse(requestJson)).toMatchObject({ operation: 'get', connection: 'destination', kind: 'DNSEndpoint' });
        return JSON.stringify({ ok: true, value: null });
      },
    });
    expect(JSON.parse(output)).toMatchObject({ operations: [{ kind: 'apply', connection: 'destination', resource: { kind: 'DNSEndpoint', metadata: { namespace: 'dns-system' } }, authority: { mode: 'managed', sourceUid: 'source-uid' } }] });
  });
});

const localPlacement: DnsPublicationPlacement = { mode: 'local', namespace: 'dns-system' };

const capabilities = externalDnsCapabilities({
  crdSource: 'enabled',
  configuredRecordTypes: ['A', 'AAAA', 'CNAME'],
  managedDomainPatterns: ['example.test', 'example'],
  watchedNamespaces: ['dns-system'],
  controllerObservation: 'supported',
  mutationPolicy: 'sync',
  registry: 'txt',
  providerRecordOwnership: 'configured',
  targetUpdates: 'supported',
  recordDeletion: 'supported',
  dryRun: false,
  propagationVerification: 'unavailable',
  configurationEvidenceRefs: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'external-dns', namespace: 'dns-system' }],
});

function normalized(input: Parameters<typeof normalizeDnsPublicationIntent>[0]): NormalizedDnsPublicationIntent {
  const result = normalizeDnsPublicationIntent(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function owner(intent: NormalizedDnsPublicationIntent): DnsPublicationOwnership {
  return {
    controllerId: 'dns-controller.applik8s.dev/v1',
    publicationId: intent.publicationId,
    source: { apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'Tenant', namespace: 'dns-system', name: 'tenant-a', uid: 'source-uid' },
  };
}

function observed(resource: DnsEndpointObject, metadata: { readonly uid: string; readonly resourceVersion: string; readonly generation: number; readonly observedGeneration?: number }): DnsEndpointObject {
  return {
    ...resource,
    metadata: { ...resource.metadata, uid: metadata.uid, resourceVersion: metadata.resourceVersion, generation: metadata.generation },
    ...(metadata.observedGeneration === undefined ? {} : { status: { observedGeneration: metadata.observedGeneration } }),
  };
}

function withInstallation(overrides: Partial<DnsPublicationCapabilities['installation']>): DnsPublicationCapabilities {
  return { ...capabilities, installation: { ...capabilities.installation, ...overrides } };
}

interface DnsOwnerSpec { readonly publicationId: string; readonly dnsName: string; readonly addresses: readonly string[] }
interface DnsOwnerStatus { readonly phase?: string }

function dnsOwnerResource() {
  const spec = {
    kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DnsOwnerSpec' },
    schema: { type: 'object', additionalProperties: false, required: ['publicationId', 'dnsName', 'addresses'], properties: { publicationId: { type: 'string' }, dnsName: { type: 'string' }, addresses: { type: 'array', items: { type: 'string' } } } },
  } satisfies JsonSchemaSource<DnsOwnerSpec>;
  const status = {
    kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'DnsOwnerStatus' },
    schema: { type: 'object', additionalProperties: false, properties: { phase: { type: 'string' } } },
  } satisfies JsonSchemaSource<DnsOwnerStatus>;
  return sdk.crd<DnsOwnerSpec, DnsOwnerStatus>({ apiVersion: 'dns.applik8s.dev/v1alpha1', kind: 'DnsOwner', spec, status });
}

function dnsOwner(resource: { readonly metadata: { readonly name: string; readonly namespace?: string; readonly uid?: string } }, intent: NormalizedDnsPublicationIntent): DnsPublicationOwnership {
  return {
    controllerId: 'dns-controller.applik8s.dev/v1', publicationId: intent.publicationId,
    source: { apiVersion: 'dns.applik8s.dev/v1alpha1', kind: 'DnsOwner', ...(resource.metadata.namespace ? { namespace: resource.metadata.namespace } : {}), name: resource.metadata.name, uid: resource.metadata.uid ?? '' },
  };
}

function ownerInput(handlerId: string, addresses: readonly string[]): string {
  return JSON.stringify({
    abiVersion: 'applik8s.handler/v1alpha1', handlerId, event: 'reconcile',
    object: { apiVersion: 'dns.applik8s.dev/v1alpha1', kind: 'DnsOwner', metadata: { name: 'tenant-a', namespace: 'dns-system', uid: 'source-uid' }, spec: { publicationId: 'tenant.primary', dnsName: 'app.example.test', addresses } },
  });
}
