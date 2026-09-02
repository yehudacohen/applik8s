// typecast-file-boundary: Test doubles intentionally model unknown OpenCode transport payloads.
import { describe, expect, it } from 'vitest';
import { OpenCodeAgentProvider } from '../src/agent/opencode.js';
import { OpenCodeHarnessProvider } from '../src/agent/opencode-code-harness.js';

describe('OpenCode development-agent adapter', () => {
  it('uses the supported session prompt protocol and keeps provider tools advisory-only', async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
    const responses = [
      { healthy: true, version: '1.18.15' },
      { id: 'ses_adapterproof' },
      { info: { id: 'msg_one' }, parts: [{ id: 'prt_one', type: 'text', text: 'Bounded proposal.' }] },
      true,
    ];
    const fakeFetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new OpenCodeAgentProvider({
      port: 43210,
      protocolVersion: 'latest-v2',
      environment: { OPENCODE_CONFIG_CONTENT: '{"model":"qualification/coder"}' },
      model: { providerID: 'qualification', modelID: 'coder' },
      fetch: fakeFetch as typeof globalThis.fetch,
      spawn: ((...args: Parameters<typeof import('node:child_process').spawn>) => {
        expect(args[2]?.env).toMatchObject({
          OPENCODE_CONFIG_CONTENT: '{"model":"qualification/coder"}',
          OPENCODE_SERVER_PASSWORD: expect.any(String),
        });
        expect(args[2]?.env).not.toHaveProperty('HOME');
        return { kill: () => true };
      }) as unknown as typeof import('node:child_process').spawn,
    });
    const session = await provider.startSession({ projectId: 'proof', workspaceRoot: '/workspace/proof', mode: 'reviewed-apply', sourceEgress: { provider: 'local', remote: false, consentedAttachmentClasses: ['source'] } });
    const events = [];
    for await (const event of provider.propose({
      sessionId: session.id,
      request: 'Add a field.',
      requestedOutcome: 'Typed field exists.',
      attachments: [
        { id: 'one', class: 'source', digest: `sha256:${'1'.repeat(64)}`, capturedAtRevision: 'one', resolution: 'exact', redaction: 'none', payload: { file: 'src/app.ts' } },
        { id: 'two', class: 'runtimeTrace', digest: `sha256:${'2'.repeat(64)}`, capturedAtRevision: 'one', resolution: 'exact', redaction: 'none', payload: { secret: 'excluded' } },
      ],
      referents: [],
    })) events.push(event);
    expect(events).toEqual([
      expect.objectContaining({ type: 'status', state: 'planning' }),
      { type: 'message', text: 'Bounded proposal.' },
      expect.objectContaining({ type: 'status', state: 'waiting-for-approval' }),
    ]);
    const promptRequest = requests.find(({ url }) => url.includes(`/session/${session.id}/message`));
    const prompt = JSON.parse(String(promptRequest?.init?.body)) as { readonly parts: readonly { readonly text: string }[]; readonly tools: Readonly<Record<string, boolean>>; readonly model: { readonly providerID: string; readonly modelID: string } };
    expect(prompt.tools).toMatchObject({ bash: false, edit: false, write: false, read: false });
    expect(prompt.parts[0]?.text).toContain('src/app.ts');
    expect(prompt.parts[0]?.text).not.toContain('excluded');
    expect(prompt.model).toEqual({ providerID: 'qualification', modelID: 'coder' });
    expect(promptRequest?.url).toContain('directory=%2Fworkspace%2Fproof');
    await provider.close({ sessionId: session.id });
    await provider.stop();
  });

  it('rejects remote source egress without explicit attachment consent', async () => {
    const provider = new OpenCodeAgentProvider({ port: 43211, protocolVersion: 'latest-v2' });
    await expect(provider.startSession({ projectId: 'proof', workspaceRoot: '/workspace/proof', mode: 'suggest', sourceEgress: { provider: 'remote', remote: true, consentedAttachmentClasses: [] } })).rejects.toThrow(/explicit attachment-class consent/u);
  });

  it('decodes a complete structured proposal without granting provider mutation tools', async () => {
    const proposed = {
      id: 'plan_structured_proof', summary: 'Add one typed field', requestedOutcome: 'The typed field exists.',
      contextReferents: [], files: [{ path: 'src/app.ts', baseDigest: 'absent', nextText: 'export const ready = true;\n', classification: 'create' }],
      graphChanges: [], schemaChanges: [], authorityChanges: [], infrastructureChanges: [], dependencies: [], risks: [], validation: [],
      rollbackBoundary: { kind: 'agent-owned-hunks', files: ['src/app.ts'] },
    };
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const responses = [
      { healthy: true, version: '1.18.15' },
      { id: 'ses_structured' },
      { parts: [{ type: 'text', text: JSON.stringify({ protocol: 'applik8s.developmentChangeProposal/v1alpha1', message: 'Review this exact change.', plan: proposed }) }] },
    ];
    const provider = new OpenCodeAgentProvider({
      port: 43212, protocolVersion: 'latest-v2',
      fetch: (async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof globalThis.fetch,
      spawn: (() => ({ kill: () => true })) as unknown as typeof import('node:child_process').spawn,
    });
    const session = await provider.startSession({ projectId: 'proof', workspaceRoot: '/workspace/proof', mode: 'reviewed-apply', sourceEgress: { provider: 'local', remote: false, consentedAttachmentClasses: ['source'] } });
    const events = [];
    for await (const event of provider.propose({ sessionId: session.id, request: 'Add it.', requestedOutcome: 'The typed field exists.', attachments: [], referents: [] })) events.push(event);
    expect(events).toContainEqual({ type: 'message', text: 'Review this exact change.' });
    expect(events).toContainEqual({ type: 'plan', plan: proposed });
    const request = requests.find(({ url }) => url.includes('/message'));
    const body = JSON.parse(String(request?.init?.body)) as { readonly tools: Readonly<Record<string, boolean>> };
    expect(Object.values(body.tools).every((allowed) => allowed === false)).toBe(true);
    await provider.stop();
  });

  it('implements the fenced AgentHarness contract and replays one terminal run', async () => {
    const digest = `sha256:${'3'.repeat(64)}` as const;
    const plan = {
      id: 'plan_harness_proof', summary: 'Update the admitted source', requestedOutcome: 'Update it.',
      contextReferents: [], files: [{ path: 'app.ts', baseDigest: digest, nextText: 'export const ready = true;\n', classification: 'update' as const }],
      graphChanges: [], schemaChanges: [], authorityChanges: [], infrastructureChanges: [], dependencies: [], risks: [], validation: [],
      rollbackBoundary: { kind: 'agent-owned-hunks' as const, files: ['app.ts'] },
    };
    const responses = [
      { healthy: true, version: '1.18.15' },
      { id: 'ses_harness' },
      { parts: [{ type: 'text', text: JSON.stringify({ protocol: 'applik8s.developmentChangeProposal/v1alpha1', message: 'Bounded change.', plan }) }] },
    ];
    let messageRequests = 0;
    const provider = new OpenCodeAgentProvider({
      port: 43213, protocolVersion: 'latest-v2',
      fetch: (async (input: URL | RequestInfo) => {
        if (String(input).includes('/message')) messageRequests += 1;
        return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof globalThis.fetch,
      spawn: (() => ({ kill: () => true })) as unknown as typeof import('node:child_process').spawn,
    });
    const harness = new OpenCodeHarnessProvider({ port: 43213, protocolVersion: 'latest-v2', provider });
    const request = {
      apiVersion: 'applik8s.agentHarnessRun/v1alpha1' as const,
      runId: 'run-one', fencingToken: 'fence-one', instruction: 'Update it.',
      model: { apiVersion: 'applik8s.aiModel/v1alpha1' as const, name: 'coding', capabilities: [], constraints: {} },
      workspace: {
        apiVersion: 'applik8s.codeWorkspaceLease/v1alpha1' as const,
        id: 'lease-one', workspace: 'repository-one', runId: 'run-one', fencingToken: 'fence-one',
        generation: 1, root: '/workspace/repository-one', baseRevision: 'revision-one',
        acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      source: { revision: 'revision-one', files: [{ path: 'app.ts', digest, text: 'export const ready = false;\n' }] },
      deadline: new Date(Date.now() + 60_000).toISOString(), grants: ['source.read'],
    };
    const first = await harness.run(request);
    await expect(harness.run(request)).resolves.toEqual(first);
    expect(first).toMatchObject({
      status: 'completed',
      changes: [{ path: 'app.ts', baseDigest: digest, nextText: 'export const ready = true;\n' }],
      receipt: { provider: 'opencode', changeCount: 1 },
    });
    expect(messageRequests).toBe(1);
    await expect(harness.run({
      ...request,
      fencingToken: 'stale-fence',
      workspace: { ...request.workspace, fencingToken: 'stale-fence' },
    })).rejects.toThrow(/stale fencing token/u);
    await harness.stop();
  });
});
