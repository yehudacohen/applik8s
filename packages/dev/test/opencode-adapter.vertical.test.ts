// typecast-file-boundary: Test doubles intentionally model unknown OpenCode transport payloads.
import { describe, expect, it } from 'vitest';
import { OpenCodeAgentProvider } from '../src/agent/opencode.js';

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
      fetch: fakeFetch as typeof globalThis.fetch,
      spawn: (() => ({ kill: () => true })) as unknown as typeof import('node:child_process').spawn,
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
    const prompt = JSON.parse(String(promptRequest?.init?.body)) as { readonly parts: readonly { readonly text: string }[]; readonly tools: Readonly<Record<string, boolean>> };
    expect(prompt.tools).toMatchObject({ bash: false, edit: false, write: false, read: false });
    expect(prompt.parts[0]?.text).toContain('src/app.ts');
    expect(prompt.parts[0]?.text).not.toContain('excluded');
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
});
