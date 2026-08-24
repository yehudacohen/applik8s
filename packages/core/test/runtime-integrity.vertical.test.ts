import {
  ApplicationAdmissionContextV1Error,
  type ApplicationGraph,
  applicationAdmissionContextVersion,
  applicationAdmissionIdentityView,
  applicationAdmissionInvocationView,
  CanonicalJsonV1Error,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonStrictV1Policy,
  canonicalJsonV1Bytes,
  canonicalJsonV1String,
  canonicalJsonV1Value,
  createApplicationAdmissionContextV1,
  createApplicationExecutionPrincipalV1,
  SignedEnvelopeV1ValidationError,
  serializeApplicationGraph,
  signedEnvelopeAlgorithm,
  signedEnvelopeVersion,
  validateApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1WithoutReceipt,
  validateSignedEnvelopeV1Protected,
  withApplicationAdmissionTraceV1,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  adaptApplicationGraphCanonicalJsonV1,
  applicationGraphCanonicalJsonV1Policy,
} from '../src/application-graph-serialization.js';

describe('Canonical JSON v1', () => {
  it('produces stable UTF-8 bytes with lexical keys and normalized negative zero', () => {
    const first = { z: -0, nested: { b: true, a: 'value' }, a: [3, 2, 1] };
    const second = { a: [3, 2, 1], nested: { a: 'value', b: true }, z: 0 };
    const expected = '{"a":[3,2,1],"nested":{"a":"value","b":true},"z":0}';

    expect(canonicalJsonV1String(first)).toBe(expected);
    expect(canonicalJsonV1String(second)).toBe(expected);
    expect(new TextDecoder().decode(canonicalJsonV1Bytes(first))).toBe(expected);
  });

  it('makes undefined semantics explicit through named policies', () => {
    expect(() => canonicalJsonV1Value({ missing: undefined }))
      .toThrowError(expect.objectContaining({
        name: 'CanonicalJsonV1Error',
        code: 'CANONICAL_JSON_UNDEFINED',
        path: '$.missing',
        policy: 'strict',
      }));
    expect(canonicalJsonV1String(
      { kept: true, missing: undefined, array: [1, undefined] },
      canonicalJsonCompatibleV1Policy,
    )).toBe('{"array":[1,null],"kept":true}');
    expect(() => canonicalJsonV1Value(undefined, canonicalJsonCompatibleV1Policy))
      .toThrow(CanonicalJsonV1Error);
    expect(canonicalJsonStrictV1Policy.name).toBe('strict');
  });

  it('allows repeated value references but rejects cycles at the exact path', () => {
    const shared = { id: 'shared' };
    expect(canonicalJsonV1String({ first: shared, second: shared }))
      .toBe('{"first":{"id":"shared"},"second":{"id":"shared"}}');

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJsonV1String({ cycle })).toThrowError(
      expect.objectContaining({
        code: 'CANONICAL_JSON_CYCLE',
        path: '$.cycle.self',
      }),
    );
  });

  it.each([
    ['non-finite number', Number.NaN, 'CANONICAL_JSON_NON_FINITE_NUMBER'],
    ['date', new Date('2026-08-21T00:00:00.000Z'), 'CANONICAL_JSON_UNSUPPORTED_VALUE'],
    ['bigint', 1n, 'CANONICAL_JSON_UNSUPPORTED_VALUE'],
    ['function', () => undefined, 'CANONICAL_JSON_UNSUPPORTED_VALUE'],
    ['symbol', Symbol('value'), 'CANONICAL_JSON_UNSUPPORTED_VALUE'],
  ])('rejects unsupported %s values', (_name, value, code) => {
    expect(() => canonicalJsonV1String({ value })).toThrowError(
      expect.objectContaining({ code, path: '$.value' }),
    );
  });
});

describe('application graph Canonical JSON v1 adapter', () => {
  it('preserves the retained graph artifact bytes under its named policy', () => {
    const graph = {
      apiVersion: 'applik8s.applicationGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'fixture' },
      nodes: [],
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
    } as unknown as ApplicationGraph;
    expect(applicationGraphCanonicalJsonV1Policy.name).toBe('application-graph-artifact');
    expect(serializeApplicationGraph(graph)).toBe(
      '{"apiVersion":"applik8s.applicationGraph/v1alpha1","compatibility":{"documentedInternalContracts":[],"experimentalSurfaces":[],"labels":[],"postV3Surfaces":[],"stablePublicApis":[]},"edges":[],"kind":"ApplicationGraph","metadata":{"name":"fixture"},"nodes":[],"providerBindings":[],"providerRequirements":[]}\n',
    );
  });

  it('adapts only the public TypeKro reference protocol before canonical validation', () => {
    const reference = {
      [Symbol.for('TypeKro.KubernetesRef')]: true,
      resourceId: 'database',
      fieldPath: 'status.endpoint',
    };
    expect(adaptApplicationGraphCanonicalJsonV1({ endpoint: reference })).toEqual({
      endpoint: `\${database.status.endpoint}`,
    });
    expect(() => canonicalJsonV1String(
      adaptApplicationGraphCanonicalJsonV1({ createdAt: new Date(0) }),
      applicationGraphCanonicalJsonV1Policy,
    )).toThrowError(CanonicalJsonV1Error);
  });
});

describe('Signed Envelope v1 protected contract', () => {
  const protectedBody = {
    version: signedEnvelopeVersion,
    purpose: 'applik8s.test.cursor/v1',
    algorithm: signedEnvelopeAlgorithm,
    keyId: 'test-key-1',
    issuedAt: 1_800_000_000_000,
    expiresAt: 1_800_000_060_000,
    payload: { cursor: 'next' },
  } as const;

  it('validates purpose, lifetime, key identity, and a typed payload', () => {
    expect(validateSignedEnvelopeV1Protected(protectedBody, {
      purpose: protectedBody.purpose,
      now: protectedBody.issuedAt,
      maximumLifetimeMs: 60_000,
      validatePayload(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new TypeError('payload must be an object');
        }
        return value;
      },
    })).toEqual(protectedBody);
  });

  it.each([
    ['purpose', { ...protectedBody, purpose: 'another-purpose' }, 'SIGNED_ENVELOPE_PURPOSE_INVALID'],
    ['algorithm', { ...protectedBody, algorithm: 'none' }, 'SIGNED_ENVELOPE_ALGORITHM_INVALID'],
    ['key identity', { ...protectedBody, keyId: '../secret' }, 'SIGNED_ENVELOPE_KEY_ID_INVALID'],
    ['expiry', protectedBody, 'SIGNED_ENVELOPE_EXPIRED'],
  ])('rejects invalid %s before payload use', (_name, value, code) => {
    expect(() => validateSignedEnvelopeV1Protected(value, {
      purpose: protectedBody.purpose,
      now: code === 'SIGNED_ENVELOPE_EXPIRED'
        ? protectedBody.expiresAt + 1
        : protectedBody.issuedAt,
      validatePayload(payload) { return payload; },
    })).toThrowError(expect.objectContaining({
      name: 'SignedEnvelopeV1ValidationError',
      code,
    }));
  });

  it('normalizes payload validator failures without retaining their cause', () => {
    expect(() => validateSignedEnvelopeV1Protected(protectedBody, {
      purpose: protectedBody.purpose,
      now: protectedBody.issuedAt,
      validatePayload() { throw new Error('schema mismatch'); },
    })).toThrow(SignedEnvelopeV1ValidationError);
  });
});

describe('Admission Context v1', () => {
  const principal = {
    id: 'principal:human:user-1',
    kind: 'human',
    identity: {
      id: 'identity:human:user-1',
      kind: 'human',
      issuer: 'https://identity.example.test',
      subject: 'user-1',
    },
    authenticationMethod: 'oidc',
    audience: ['application'],
    trustedContextDigest: 'sha256:trusted-context',
    catalogRevision: 'catalog-v1',
    authorityRevision: 'authority-v1',
    admittedAt: '2026-08-21T12:00:00.000Z',
  } as const;
  const context = {
    apiVersion: applicationAdmissionContextVersion,
    principal,
    authorityRevision: 'authority-v1',
    trustedContext: {
      values: { organizationId: 'organization-1' },
      digest: 'sha256:trusted-context',
    },
    operation: {
      id: 'applik8s://models/Document/operations/create',
      transport: 'http',
    },
    correlationId: 'request-1',
    causationId: 'browser-action-1',
    deadline: '2026-08-21T12:01:00.000Z',
    cancellation: { revision: 'cancel-v1' },
    trace: {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    },
    delivery: { id: 'http-request-1', source: 'public-api' },
  } as const;

  it('validates once and exposes immutable narrowed execution views', () => {
    const admitted = validateApplicationAdmissionContextV1(context, {
      now: Date.parse('2026-08-21T12:00:30.000Z'),
    });
    expect(applicationAdmissionIdentityView(admitted)).toEqual({
      apiVersion: applicationAdmissionContextVersion,
      principal,
      authorityRevision: 'authority-v1',
      trustedContext: context.trustedContext,
    });
    expect(applicationAdmissionInvocationView(admitted)).not.toHaveProperty('delivery');
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it('constructs the canonical context only from authenticated request admission and transport provenance', () => {
    const admitted = createApplicationAdmissionContextV1({
      admission: {
        principal,
        trustedContext: context.trustedContext.values,
      },
      operation: context.operation,
      correlationId: context.correlationId,
    });
    expect(withApplicationAdmissionTraceV1(admitted, context.trace)).toEqual({
      apiVersion: context.apiVersion,
      principal: context.principal,
      authorityRevision: context.authorityRevision,
      trustedContext: context.trustedContext,
      operation: context.operation,
      correlationId: context.correlationId,
      trace: context.trace,
    });
  });

  it.each([
    ['principal authority', { ...context, authorityRevision: 'authority-v2' }, 'ADMISSION_AUTHORITY_MISMATCH'],
    ['trusted context', { ...context, trustedContext: { ...context.trustedContext, digest: 'sha256:other' } }, 'ADMISSION_AUTHORITY_MISMATCH'],
    ['operation', { ...context, operation: { ...context.operation, id: 'unsafe' } }, 'ADMISSION_OPERATION_INVALID'],
    ['deadline', context, 'ADMISSION_DEADLINE_EXPIRED'],
  ])('fails closed for mismatched %s evidence', (_name, value, code) => {
    expect(() => validateApplicationAdmissionContextV1(value, {
      now: code === 'ADMISSION_DEADLINE_EXPIRED'
        ? Date.parse('2026-08-21T12:02:00.000Z')
        : Date.parse('2026-08-21T12:00:30.000Z'),
    })).toThrowError(expect.objectContaining({
      name: 'ApplicationAdmissionContextV1Error',
      code,
    }));
  });

  it('rejects non-JSON trusted context values at their path', () => {
    expect(() => validateApplicationAdmissionContextV1({
      ...context,
      trustedContext: { ...context.trustedContext, values: { now: new Date() } },
    }, { now: Date.parse('2026-08-21T12:00:30.000Z') }))
      .toThrow(ApplicationAdmissionContextV1Error);
  });

  it('keeps receiptless transport validation canonical and fail-closed', () => {
    expect(validateApplicationAdmissionContextV1WithoutReceipt(context, {
      now: Date.parse('2026-08-21T12:00:30.000Z'),
    })).toEqual(context);
    expect(() => validateApplicationAdmissionContextV1WithoutReceipt({
      ...context,
      authorizationReceipt: { id: 'unverified-receipt' },
    }, { now: Date.parse('2026-08-21T12:00:30.000Z') }))
      .toThrow(/receipt is forbidden/u);
  });

  it('constructs one framework execution principal without granting operation authority', () => {
    const workloadIdentity = {
      id: 'identity:demo:workload:task.publish',
      kind: 'workload' as const,
      issuer: 'applik8s://demo',
      subject: 'task.publish',
    };
    const execution = createApplicationExecutionPrincipalV1({
      application: 'demo',
      executionKind: 'task',
      executionId: 'task-run-1',
      attempt: 2,
      workloadIdentity,
      causalPrincipal: {
        id: principal.id,
        identity: principal.identity,
        grantIds: ['grant:publish'],
      },
      envelopes: [],
      trustedContextDigest: context.trustedContext.digest,
      audience: ['workflow-worker'],
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      admittedAt: '2026-08-21T12:00:00.000Z',
      deadline: '2026-08-21T12:01:00.000Z',
      cancellationRevision: 'cancel-v1',
      authenticationMethod: 'hatchet-delivery',
    });
    expect(execution).toMatchObject({
      kind: 'execution',
      executionKind: 'task',
      executionId: 'task-run-1',
      attempt: 2,
      workloadIdentity,
      causalPrincipalId: principal.id,
      causalPrincipal: principal.identity,
      causalGrantIds: ['grant:publish'],
      authenticationMethod: 'hatchet-delivery',
      bindings: [],
      effectiveAuthority: [],
    });
    expect(validateApplicationAdmissionContextV1WithoutReceipt({
      ...createApplicationAdmissionContextV1({
        admission: {
          principal: execution,
          trustedContext: context.trustedContext.values,
        },
        operation: {
          id: 'applik8s://tasks/Publish/operations/execute',
          transport: 'workflow',
        },
        correlationId: 'workflow-run-1',
      }),
      causationId: 'workflow-parent-1',
      deadline: execution.deadline,
      cancellation: { revision: execution.cancellationRevision },
      delivery: { id: execution.executionId, source: 'hatchet' },
    }, { now: Date.parse('2026-08-21T12:00:30.000Z') })).toMatchObject({
      principal: execution,
      operation: {
        id: 'applik8s://tasks/Publish/operations/execute',
        transport: 'workflow',
      },
    });
  });

  it('requires complete framework-derived coordinates for actor execution principals', () => {
    const workloadIdentity = {
      id: 'identity:demo:workload:actor.workspace',
      kind: 'workload' as const,
      issuer: 'applik8s://demo',
      subject: 'actor.workspace',
    };
    const actorOptions = {
      application: 'demo',
      executionKind: 'actor' as const,
      executionId: 'actor-turn-1',
      attempt: 1,
      workloadIdentity,
      envelopes: [],
      trustedContextDigest: 'sha256:context',
      audience: ['actor-runtime'],
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      admittedAt: '2026-08-21T12:00:00.000Z',
      deadline: '2026-08-21T12:01:00.000Z',
      cancellationRevision: 'cancel-v1',
    };

    expect(() => createApplicationExecutionPrincipalV1(actorOptions))
      .toThrow(/Actor execution requires stable actor/u);
    expect(createApplicationExecutionPrincipalV1({
      ...actorOptions,
      executionContext: {
        kind: 'actor',
        actor: 'workspace.v1',
        member: 'rename',
        keyDigest: 'sha256:key',
        turnId: 'turn-1',
      },
    })).toMatchObject({
      executionKind: 'actor',
      executionContext: {
        kind: 'actor',
        actor: 'workspace.v1',
        member: 'rename',
        keyDigest: 'sha256:key',
        turnId: 'turn-1',
      },
    });
  });

  it('fails closed when execution envelopes drift from compiler-owned identity or revision', () => {
    const workloadIdentity = {
      id: 'identity:demo:workload:task.publish',
      kind: 'workload' as const,
      issuer: 'applik8s://demo',
      subject: 'task.publish',
    };
    const envelope = {
      apiVersion: 'applik8s.workloadAuthority/v1alpha1' as const,
      id: 'envelope:publish',
      workloadIdentity: {
        ...workloadIdentity,
        subject: 'task.other',
      },
      operationId: 'applik8s://models/Post/operations/publish' as const,
      catalogRevision: 'catalog-v1',
      restrictions: { predicates: [] },
      inputSchemaDigest: 'sha256:input',
      audiences: ['workflow-worker'],
      transports: ['workflow' as const],
      delegation: 'forbidden' as const,
      impersonation: 'forbidden' as const,
    };
    expect(() => createApplicationExecutionPrincipalV1({
      application: 'demo',
      executionKind: 'task',
      executionId: 'task-run-1',
      attempt: 1,
      workloadIdentity,
      envelopes: [envelope],
      trustedContextDigest: 'sha256:context',
      audience: ['workflow-worker'],
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      admittedAt: '2026-08-21T12:00:00.000Z',
      deadline: '2026-08-21T12:01:00.000Z',
      cancellationRevision: 'cancel-v1',
    })).toThrow(/belongs to/u);
  });
});
