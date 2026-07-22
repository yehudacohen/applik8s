import { type } from '@applik8s/applik8s/dsl';
import { createDeterministicStructuredGenerationCapability, createHttpStructuredGenerationCapability } from '@applik8s/applik8s/structured-generation-runtime';
import { describe, expect, it, vi } from 'vitest';

const Generated = type({ body: 'string', tags: 'string[]' });

describe('structured generation runtime', () => {
  it('validates deterministic output against the caller schema and reports bounded usage', async () => {
    const generation = createDeterministicStructuredGenerationCapability({ output: { body: 'hello', tags: ['test'] }, inputUnits: 7, outputUnits: 3 });
    await expect(generation.generate({ profile: 'fixture', input: { topic: 'hello' }, output: Generated, idempotencyKey: 'run-1' })).resolves.toEqual({
      value: { body: 'hello', tags: ['test'] },
      usage: { inputUnits: 7, outputUnits: 3 },
    });
  });

  it('rejects provider output that does not satisfy the declared schema', async () => {
    const generation = createDeterministicStructuredGenerationCapability({ output: { body: 42, tags: [] } });
    await expect(generation.generate({ profile: 'fixture', input: {}, output: Generated, idempotencyKey: 'run-2' })).rejects.toThrow(/output-invalid/);
  });

  it('sends a credential without exposing it in the body and validates the HTTP response', async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      output: { body: 'generated', tags: ['http'] },
      usage: { inputUnits: 11, outputUnits: 5, costMicrounits: 21 },
      providerRequestId: 'provider-1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const generation = createHttpStructuredGenerationCapability({ endpoint: 'https://generation.example.test/v1', apiKey: 'secret-value', fetch: request });
    await expect(generation.generate({ profile: 'small', input: { topic: 'runtime' }, output: Generated, idempotencyKey: 'run-3' })).resolves.toEqual({
      value: { body: 'generated', tags: ['http'] },
      usage: { inputUnits: 11, outputUnits: 5, costMicrounits: 21 },
      providerRequestId: 'provider-1',
    });
    const init = request.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer secret-value', 'idempotency-key': 'run-3' });
    expect(String(init?.body)).not.toContain('secret-value');
    expect(JSON.parse(String(init?.body))).toMatchObject({ profile: 'small', input: { topic: 'runtime' }, outputSchema: expect.objectContaining({ type: 'object' }) });
  });

  it('enforces HTTPS and response-size bounds', async () => {
    expect(() => createHttpStructuredGenerationCapability({ endpoint: 'http://generation.example.test' })).toThrow(/endpoint-insecure/);
    const generation = createHttpStructuredGenerationCapability({
      endpoint: 'https://generation.example.test',
      maxResponseBytes: 1_024,
      fetch: async () => new Response(JSON.stringify({ output: { body: 'x'.repeat(2_000), tags: [] }, usage: { inputUnits: 1, outputUnits: 1 } })),
    });
    await expect(generation.generate({ profile: 'small', input: {}, output: Generated, idempotencyKey: 'run-4' })).rejects.toThrow(/response-too-large/);
  });
});
