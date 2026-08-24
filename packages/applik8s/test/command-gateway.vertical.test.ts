// typecast-file-boundary: test doubles model untyped PostgreSQL and protocol boundaries exercised by runtime validation.
import { createHmac } from 'node:crypto';
import { createApplicationCommandGateway } from '@applik8s/applik8s';
import { canonicalJsonV1Value, createApplicationAdmissionContextV1, withApplicationAdmissionExecutionV1 } from '@applik8s/core';
import { createSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime/signed-envelope';
import { describe, expect, it, vi } from 'vitest';
import { testApplicationAdmission, testApplicationPrincipal } from '../../../test-support/application-principal.js';
import { applicationCommandPrincipal, applicationCommandTrustedContext } from '../src/command-principal.js';
import { applicationCommandScope } from '../src/command-runtime-contract.js';
import { applicationRelationalChangeScopes } from '../src/relational-runtime.js';

function transactionalSql(unsafe: (statement: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>) {
  return {
    unsafe,
    begin: async <T>(operation: (transaction: {
      unsafe: typeof unsafe;
      json(value: unknown): unknown;
    }) => Promise<T>) => operation({ unsafe, json: (value) => value }),
    async end() {},
  };
}

describe('authenticated command gateway', () => {
  it('includes admitted context in durable idempotency scope', () => {
    const first = applicationCommandScope('binding', 'Card', 'card-1', 'once', 'a'.repeat(64));
    const second = applicationCommandScope('binding', 'Card', 'card-1', 'once', 'b'.repeat(64));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^sha256:/);
  });

  it('bounds command cursor lifetime at the framework boundary', () => {
    expect(() => createApplicationCommandGateway({
      commands: [],
      authenticate: async () => testApplicationAdmission('user-1'),
      authorize: async () => true,
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      cursorTtlSeconds: 24 * 60 * 60 + 1,
      eventLogPublisher: { async publish() { throw new Error('unused'); }, async drain() {} },
    })).toThrow(/between 30 seconds and 24 hours/);
  });

  it('executes signed MCP placement invocations through the durable command processor', async () => {
    const publish = vi.fn(async () => ({
      stream: 'events',
      sequence: 1,
      duplicate: false,
      subject: 'command',
      messageId: 'internal',
    }));
    const unsafe = vi.fn(async (statement: string, parameters: readonly unknown[]) => {
      if (statement.includes('INSERT INTO applik8s_command_admissions')) {
        return [{ scope: parameters[0] }];
      }
      if (statement.includes('applik8s_command_results')) {
        return [{ output: { changed: true }, error: null }];
      }
      throw new Error(`Unexpected SQL in internal command fixture: ${statement}`);
    });
    const principal = testApplicationPrincipal('agent-1', {
      authorityRevision: 'authority-1',
      catalogRevision: 'catalog-1',
      trustedContext: { organizationId: 'organization-1' },
    });
    const receipt = {
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1' as const,
      application: 'chirp',
      id: 'receipt-internal-1',
      operationId: 'applik8s://models/Card/operations/rename' as const,
      operationVersion: 'v1',
      catalogRevision: principal.catalogRevision,
      authorityRevision: principal.authorityRevision,
      principal,
      trustedContextDigest: principal.trustedContextDigest,
      matchedPermissionIds: ['permission:card.rename'],
      matchedGrantIds: [],
      inputDigest: 'sha256:5d6004c889ff35626448876a306db680acceceae6ef1f887c2b121c4fea99034',
      target: { kind: 'all' as const },
      scopeEvidence: [],
      audience: 'https://chirp.example.test/mcp',
      transport: 'mcp' as const,
      admittedAt: '2026-07-30T12:00:00.000Z',
    };
    const gateway = createApplicationCommandGateway({
      commands: [{
        id: 'cards.rename.v1',
        application: 'chirp',
        bindingId: 'Card-cards.rename.v1',
        model: 'Card',
        operationId: receipt.operationId,
        operationVersion: 'v1',
        inputSchema: {
          type: 'object',
          properties: { cardId: { type: 'string' } },
          required: ['cardId'],
          additionalProperties: false,
        },
        databaseUrl: 'postgres://unused',
        sql: transactionalSql(unsafe) as never,
        key: (input) => String(Reflect.get(input, 'cardId')),
      }],
      authenticate: async () => {
        throw new Error('Internal invocation must not call public authentication.');
      },
      authorizeOperation: async () => {
        throw new Error('Internal invocation must use the signed receipt.');
      },
      revalidateOperation: async () => ({ allowed: true }),
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      eventLogPublisher: { publish, async drain() {} },
      now: () => new Date('2026-07-30T12:00:00.000Z'),
    });
    const input = { cardId: 'card-1' };
    const context = withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission: {
          principal,
          trustedContext: { organizationId: 'organization-1' },
        },
        operation: { id: receipt.operationId, transport: 'mcp' },
        correlationId: 'internal-1',
      }),
      {
        causationId: 'internal-1',
        deadline: '2026-07-30T12:00:30.000Z',
        authorizationReceipt: receipt,
        delivery: {
          id: 'internal-1',
          source: 'applik8s://internal-operation/mcpServer.public',
        },
      },
    );
    const invocation = {
      apiVersion: 'applik8s.internalOperation/v1alpha1' as const,
      id: 'internal-1',
      operationId: receipt.operationId,
      operationVersion: 'v1',
      inputDigest: receipt.inputDigest,
      audience: receipt.audience,
      source: {
        transport: 'mcp' as const,
        workloadId: 'mcpServer.public',
      },
      context,
      admission: {
        principal,
        trustedContext: { organizationId: 'organization-1' },
      },
      authorizationReceipt: receipt,
      idempotencyKey: 'rename-once',
      issuedAt: '2026-07-30T12:00:00.000Z',
      expiresAt: '2026-07-30T12:00:30.000Z',
    };

    await expect(gateway.invoke({
      operationId: receipt.operationId,
      input,
      invocation,
    })).resolves.toEqual({ changed: true });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^internal-[a-f0-9]{64}$/),
      correlationId: expect.stringMatching(/^internal-[a-f0-9]{64}$/),
      authorizationReceipt: receipt,
      routing: expect.objectContaining({
        binding: 'Card-cards.rename.v1',
        idempotencyKey: 'rename-once',
      }),
    }), 'commands');
    expect(unsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO applik8s_command_admissions'),
      expect.arrayContaining([
        expect.stringMatching(/^sha256:/),
        'cards.rename.v1',
        'Card-cards.rename.v1',
        expect.stringMatching(/^internal-[a-f0-9]{64}$/),
      ]),
    );
    await gateway.close();
  });

  it('reports redacted internal failures while preserving the public error boundary', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, databaseUrl: 'postgres://unused', key: (input) => String(Reflect.get(input, 'id')) }],
      authenticate: async () => testApplicationAdmission('principal-1', { authorityRevision: 'policy-v1', trustedContext: { tenant: 'tenant-1' } }),
      authorize: async () => true,
      cursorSecret: '01234567890123456789012345678901',
      eventLogPublisher: {
        publish: async () => { throw new Error('upstream details'); },
        drain: async () => undefined,
      },
    });
    try {
      const response = await gateway.handle(new Request('http://gateway/commands/cards.rename.v1/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: 'card-1' }, commandId: 'command-1', idempotencyKey: 'idempotency-1' }),
      }));
      expect(response?.status).toBe(500);
      await expect(response?.json()).resolves.toEqual({ error: 'internal_error' });
      expect(error).toHaveBeenCalledWith(JSON.stringify({
        event: 'applik8s-command-gateway-error',
        command: 'cards.rename.v1',
        operation: 'submit',
        error: { name: 'Error', message: 'upstream details' },
      }));
    } finally {
      error.mockRestore();
      await gateway.close();
    }
  });

  it('separates transport acknowledgement from durable result and scopes opaque progress to admission', async () => {
    const contextSecret = 'an-application-wide-context-secret-with-32-characters';
    const publish = vi.fn(async () => ({ stream: 'APPLIK8S_EVENTS', sequence: 1, duplicate: false, subject: 'applik8s.commands.cards.rename.v1.card-1', messageId: 'command-1' }));
    const unsafe = vi.fn(async () => [{ output: { changed: true }, error: null, model_revision: 'revision-2' }]);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] }, databaseUrl: 'postgres://unused', sql: transactionalSql(unsafe) as never, key: (input, context) => {
        expect(context).toMatchObject({ principal: { id: 'user-1' }, authorizationVersion: 'membership-2', trustedContext: { organizationId: 'organization-1' } });
        return Reflect.get(input, 'cardId');
      } }],
      authenticate: async () => testApplicationAdmission('user-1', { authorityRevision: 'membership-2', trustedContext: { organizationId: 'organization-1' } }),
      authorize: async ({ principal }) => principal.id === 'user-1',
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      contextSecret,
      eventLogPublisher: { publish, async drain() {} },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
    });
    const submissionResponse = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/submit', { method: 'POST', body: JSON.stringify({ input: { cardId: 'card-1' }, commandId: 'command-1', idempotencyKey: 'rename-once' }) }));
    expect(submissionResponse?.status).toBe(202);
    const submission = await submissionResponse?.json() as { readonly progressCursor: string; readonly durableResult: string };
    expect(submission.durableResult).toBe('pending');
    expect(submission.progressCursor).not.toContain('organization-1');
    const cursorBody = JSON.parse(Buffer.from(submission.progressCursor.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    const [encodedBody, encodedSignature] = submission.progressCursor.split('.');
    expect(encodedSignature).toBe(
      createHmac('sha256', 'a-secure-test-secret-with-at-least-32-characters')
        .update(encodedBody ?? '')
        .digest('base64url'),
    );
    expect(cursorBody).toMatchObject({ version: 2, command: 'cards.rename.v1', durableScope: expect.stringMatching(/^sha256:/) });
    expect(cursorBody).not.toHaveProperty('principalId');
    expect(cursorBody).not.toHaveProperty('authorizationVersion');
    expect(cursorBody).not.toHaveProperty('contextDigest');
    expect(cursorBody).not.toHaveProperty('targetKey');
    expect(JSON.stringify(cursorBody)).not.toContain('user-1');
    expect(JSON.stringify(cursorBody)).not.toContain('membership-2');
    expect(JSON.stringify(cursorBody)).not.toContain('organization-1');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      id: 'command-1',
      routing: { binding: 'Card-cards.rename.v1', targetKey: 'card-1', idempotencyKey: 'rename-once' },
      trustedContext: expect.objectContaining({
        values: expect.objectContaining({ organizationId: 'organization-1' }),
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        changeScopes: expect.objectContaining({
          global: expect.stringMatching(/^[a-f0-9]{64}$/),
          'context:organizationId': expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    }), 'commands');
    const published = (publish.mock.calls as unknown as readonly (readonly [unknown])[])[0]?.[0] as unknown as {
      readonly trustedContext?: {
        readonly values: Readonly<Record<string, never>>;
        readonly changeScopes?: Readonly<Record<string, string>>;
      };
    };
    expect(applicationCommandPrincipal(published.trustedContext)).toEqual(
      testApplicationPrincipal('user-1', {
        authorityRevision: 'membership-2',
        trustedContext: { organizationId: 'organization-1' },
      }),
    );
    expect(applicationCommandTrustedContext(published.trustedContext)).toEqual({ organizationId: 'organization-1' });
    expect(JSON.stringify(published.trustedContext?.changeScopes)).not.toContain('organization-1');
    expect(JSON.stringify(published.trustedContext?.changeScopes)).not.toContain('user-1');
    expect(published.trustedContext?.changeScopes?.global).toBe(
      applicationRelationalChangeScopes({
        values: {},
        digestSecret: contextSecret,
      }).global,
    );

    const progressResponse = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/progress', { method: 'POST', body: JSON.stringify({ cursor: submission.progressCursor }) }));
    await expect(progressResponse?.json()).resolves.toMatchObject({ durableResult: 'succeeded', output: { changed: true }, modelRevision: 'revision-2', reconciliation: 'ready' });
    const issuedAt = Date.parse('2026-07-15T00:00:00.000Z');
    const v1Codec = createSignedEnvelopeCodec({
      purpose: 'applik8s.command-cursor/v1',
      keys: staticSignedEnvelopeKeyProvider({
        current: {
          id: 'command-cursor-current',
          key: signedEnvelopeUtf8Key('a-secure-test-secret-with-at-least-32-characters'),
        },
      }),
      now: () => issuedAt,
      maximumLifetimeMs: 15 * 60_000,
      validatePayload(value) { return value; },
    });
    const v1Cursor = await v1Codec.sign(canonicalJsonV1Value(cursorBody), {
      issuedAt,
      expiresAt: Number(cursorBody.expiresAt),
    });
    const v1Progress = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/progress', { method: 'POST', body: JSON.stringify({ cursor: v1Cursor }) }));
    await expect(v1Progress?.json()).resolves.toMatchObject({ durableResult: 'succeeded', output: { changed: true } });
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('applik8s_command_results'), [expect.stringMatching(/^sha256:/)]);
    await gateway.close();
  });

  it('ends progress polling with a redacted terminal processing failure instead of a domain rejection', async () => {
    const unsafe = vi.fn(async () => [{
      output: null,
      error: { name: 'internalFailure', payload: { code: 'processing_failed', attempts: 5, detail: 'must-not-leak' } },
      model_revision: 'terminal-revision',
    }]);
    const gateway = createApplicationCommandGateway({
      commands: [{ id: 'cards.rename.v1', bindingId: 'Card-cards.rename.v1', model: 'Card', inputSchema: { type: 'object' }, databaseUrl: 'postgres://unused', sql: transactionalSql(unsafe) as never, key: () => 'card-1' }],
      authenticate: async () => testApplicationAdmission('user-1', { authorityRevision: 'membership-1' }),
      authorize: async () => true,
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      eventLogPublisher: { async publish() { return { stream: 'events', sequence: 1, duplicate: false, subject: 'command', messageId: 'terminal-1' }; }, async drain() {} },
    });
    const submitted = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/submit', { method: 'POST', body: JSON.stringify({ input: {}, commandId: 'terminal-1', idempotencyKey: 'terminal-1' }) }));
    const cursor = Reflect.get(await submitted?.json(), 'progressCursor');
    const response = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/progress', { method: 'POST', body: JSON.stringify({ cursor }) }));
    const body = await response?.json();
    expect(body).toEqual(expect.objectContaining({
      durableResult: 'failed',
      failure: { code: 'processing_failed', attempts: 5 },
      reconciliation: 'failed',
      modelRevision: 'terminal-revision',
    }));
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    await gateway.close();
  });

  it('persists canonical operation authorization receipts into durable command envelopes', async () => {
    const publish = vi.fn(async () => ({
      stream: 'events',
      sequence: 1,
      duplicate: false,
      subject: 'command',
      messageId: 'command-authorized',
    }));
    const principalContract = {
      id: 'principal:user-1',
      identity: { id: 'identity:user-1', kind: 'human' as const, issuer: 'test', subject: 'user-1' },
      kind: 'human' as const,
      authenticationMethod: 'test',
      audience: ['chirp'],
      trustedContextDigest: 'replaced-by-admission',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-07-29T00:00:00.000Z',
    };
    let durableReceipt: unknown;
    const unsafe = vi.fn(async (statement: string, parameters: readonly unknown[]) => {
      if (statement.includes('INSERT INTO applik8s_command_admissions')) {
        durableReceipt = typeof parameters[4] === 'string'
          ? JSON.parse(parameters[4])
          : parameters[4];
        return [{ scope: parameters[0] }];
      }
      if (statement.includes('SELECT authorization_receipt')) {
        // Compatibility fixture for the brief v0.7 development encoding that
        // stored the receipt as a JSON string scalar.
        return [{ authorization_receipt: JSON.stringify(durableReceipt) }];
      }
      if (statement.includes('applik8s_command_results')) {
        return [{ output: { changed: true }, error: null, model_revision: 'revision-2' }];
      }
      throw new Error(`Unexpected SQL in command gateway fixture: ${statement}`);
    });
    let resultReadAllowed = true;
    let currentAuthorityRevision = 'authority-1';
    let currentTrustedContext: Readonly<Record<string, string>> = {
      organizationId: 'organization-1',
    };
    const authorizeOperation = vi.fn(async (request: Parameters<NonNullable<Parameters<typeof createApplicationCommandGateway>[0]['authorizeOperation']>>[0]) => ({
      allowed: true as const,
      receipt: {
        apiVersion: 'applik8s.authorizationReceipt/v1alpha1' as const,
        application: 'test',
        id: 'receipt-1',
        operationId: 'applik8s://models/Card/operations/rename' as const,
        operationVersion: 'v1',
        catalogRevision: request.principal.catalogRevision,
        authorityRevision: request.principal.authorityRevision,
        principal: { ...request.principal, trustedContextDigest: request.trustedContextDigest },
        trustedContextDigest: request.trustedContextDigest,
        matchedPermissionIds: ['permission:card.rename'],
        matchedGrantIds: ['grant:card.rename'],
        inputDigest: request.inputDigest,
        target: { kind: 'target' as const, model: 'Card', identity: { id: request.targetKey } },
        scopeEvidence: [],
        audience: 'chirp',
        transport: 'http' as const,
        admittedAt: '2026-07-29T00:00:00.000Z',
      },
    }));
    const revalidateOperation = vi.fn(async () => resultReadAllowed
      ? { allowed: true as const }
      : { allowed: false as const, code: 'AUTHORITY_REVOKED', message: 'revoked' });
    const gateway = createApplicationCommandGateway({
      commands: [{
        id: 'cards.rename.v1',
        bindingId: 'Card-cards.rename.v1',
        model: 'Card',
        operationId: 'applik8s://models/Card/operations/rename',
        operationVersion: 'v1',
        inputSchema: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] },
        databaseUrl: 'postgres://unused',
        sql: transactionalSql(unsafe) as never,
        key: (input) => String(Reflect.get(input, 'cardId')),
      }],
      authenticate: async () => ({
        principal: {
          ...principalContract,
          // The identity provider and operation authority intentionally expose
          // different revisions. Identity-scoped capability verification must
          // receive this admission revision.
          authorityRevision: 'identity-admission-7',
        },
        trustedContext: currentTrustedContext,
      }),
      admitPrincipal: async () => ({
        ...principalContract,
        authorityRevision: currentAuthorityRevision,
      }),
      authorizeOperation,
      revalidateOperation,
      cursorSecret: 'a-secure-test-secret-with-at-least-32-characters',
      eventLogPublisher: { publish, async drain() {} },
    });

    const response = await gateway.handle(new Request('https://catalog.test/commands/cards.rename.v1/submit', {
      method: 'POST',
      headers: {
        'x-request-id': 'command-request-1',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
      body: JSON.stringify({
        input: { cardId: 'card-1' },
        commandId: 'command-authorized',
        idempotencyKey: 'rename-once',
      }),
    }));

    expect(response?.status).toBe(202);
    expect(authorizeOperation).toHaveBeenCalledWith(expect.objectContaining({
      admission: expect.objectContaining({
        correlationId: 'command-authorized',
        operation: { id: 'applik8s://models/Card/operations/rename', transport: 'http' },
        trace: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      }),
      authorizationVersion: 'identity-admission-7',
      principal: expect.objectContaining({ authorityRevision: 'authority-1' }),
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      authorizationReceipt: expect.objectContaining({
        id: 'receipt-1',
        operationId: 'applik8s://models/Card/operations/rename',
        trustedContextDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }), 'commands');
    const submission = await response?.json() as { readonly progressCursor: string };
    const cursorBody = JSON.parse(
      Buffer.from(submission.progressCursor.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(cursorBody).toMatchObject({
      version: 3,
      operationId: 'applik8s://models/Card/operations/rename',
      operationVersion: 'v1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      receiptBinding: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(JSON.stringify(cursorBody)).not.toContain('principal:user-1');
    expect(JSON.stringify(cursorBody)).not.toContain('receipt-1');

    // Authorization itself may append an audit event, advancing the authority
    // revision before the first poll. The receipt remains bound to the issuing
    // revision and must be revalidated rather than rejected as a malformed
    // cursor.
    currentAuthorityRevision = 'authority-2';
    currentTrustedContext = {};
    const progress = await gateway.handle(new Request(
      'https://catalog.test/commands/cards.rename.v1/progress',
      { method: 'POST', body: JSON.stringify({ cursor: submission.progressCursor }) },
    ));
    expect(progress?.status).toBe(200);
    await expect(progress?.json()).resolves.toMatchObject({
      durableResult: 'succeeded',
      output: { changed: true },
    });
    expect(revalidateOperation).toHaveBeenCalledWith(expect.objectContaining({
      boundary: 'result-read',
      receipt: expect.objectContaining({ id: 'receipt-1' }),
      trustedContextDigest: Reflect.get(
        durableReceipt as object,
        'trustedContextDigest',
      ),
      principal: expect.objectContaining({
        id: 'principal:user-1',
        authorityRevision: 'authority-2',
      }),
    }));

    resultReadAllowed = false;
    const deniedProgress = await gateway.handle(new Request(
      'https://catalog.test/commands/cards.rename.v1/progress',
      { method: 'POST', body: JSON.stringify({ cursor: submission.progressCursor }) },
    ));
    expect(deniedProgress?.status).toBe(403);
    await expect(deniedProgress?.json()).resolves.toEqual({
      error: 'forbidden',
      code: 'AUTHORITY_REVOKED',
    });
    await gateway.close();
  });
});
