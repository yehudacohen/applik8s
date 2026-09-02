// typecast-file-boundary: The live fake and captured transport deliberately
// cross untyped HTTP/process boundaries to test production validation.
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAgentProvider } from '@applik8s/dev/agent/opencode';
import { createDevelopmentDaemon } from '@applik8s/dev';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.APPLIK8S_E2E_OPENCODE === '1';

describe.skipIf(!enabled)('v0.9 real OpenCode Builder qualification', () => {
  let workspace = '';
  let modelPort = 0;
  let opencodePort = 0;
  let provider: OpenCodeAgentProvider | undefined;
  let modelResponse = 'The exported greeting is the string “hello”. No files were changed.';
  const requests: unknown[] = [];
  const model = createServer((request, response) => void serveModel(request, response, requests, () => modelResponse));

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'applik8s-builder-opencode-'));
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'builder-qualification', private: true, type: 'module' }));
    await writeFile(join(workspace, 'app.ts'), 'export const greeting = "hello";\n');
    model.listen(0, '127.0.0.1');
    await once(model, 'listening');
    modelPort = addressPort(model.address());
    opencodePort = await unusedPort();
    const configuration = {
      $schema: 'https://opencode.ai/config.json',
      model: 'qualification/coder',
      provider: {
        qualification: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Applik8s deterministic qualification',
          options: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'qualification-only' },
          models: {
            coder: { name: 'Qualification coder', limit: { context: 8_192, output: 1_024 } },
          },
        },
      },
    };
    provider = new OpenCodeAgentProvider({
      port: opencodePort,
      protocolVersion: 'latest-v2',
      environment: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(configuration),
        OPENCODE_DISABLE_AUTOUPDATE: 'true',
      },
      model: { providerID: 'qualification', modelID: 'coder' },
    });
  }, 30_000);

  afterAll(async () => {
    await provider?.stop();
    model.close();
    if (model.listening) await once(model, 'close');
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('executes a bounded advisory turn through a real loopback OpenCode process', async () => {
    if (!provider) throw new Error('OpenCode provider was not initialized.');
    const session = await provider.startSession({
      projectId: 'builder-qualification',
      workspaceRoot: workspace,
      mode: 'reviewed-apply',
      sourceEgress: { provider: 'local', remote: false, consentedAttachmentClasses: ['source'] },
    });
    const events = [];
    for await (const event of provider.inspect({
      sessionId: session.id,
      request: 'Explain the exported greeting without changing any file.',
      attachments: [{
        id: 'app-source',
        class: 'source',
        digest: `sha256:${'1'.repeat(64)}`,
        capturedAtRevision: 'fixture-v1',
        resolution: 'exact',
        redaction: 'none',
        payload: { path: 'app.ts', source: 'export const greeting = "hello";' },
      }],
      referents: [],
    })) events.push(event);
    expect(events).toContainEqual({ type: 'message', text: 'The exported greeting is the string “hello”. No files were changed.' });
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'status', state: 'complete' }));
    expect(requests.length).toBeGreaterThan(0);
    expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toBe('export const greeting = "hello";\n');
    await provider.close({ sessionId: session.id });
  }, 30_000);

  it('brokers a real OpenCode proposal through review, validation, recovery, conflict-safe undo, and application failure', async () => {
    if (!provider) throw new Error('OpenCode provider was not initialized.');
    const original = 'export const greeting = "hello";\n';
    const updated = 'export const greeting = "hello builder";\n';
    await writeFile(join(workspace, 'app.ts'), original);
    modelResponse = JSON.stringify({
      protocol: 'applik8s.developmentChangeProposal/v1alpha1',
      message: 'Prepared a bounded greeting update for review.',
      plan: {
        id: 'plan_builder_closed_loop',
        summary: 'Update the greeting through the reviewed Builder boundary',
        requestedOutcome: 'Update the greeting and prove the complete reviewed change lifecycle.',
        contextReferents: [],
        files: [{
          path: 'app.ts',
          baseDigest: `sha256:${createHash('sha256').update(original).digest('hex')}`,
          nextText: updated,
          classification: 'update',
        }],
        graphChanges: [],
        schemaChanges: [],
        authorityChanges: [],
        infrastructureChanges: [],
        dependencies: [],
        risks: [],
        validation: [{ id: 'typecheck', commandClass: 'typecheck', required: true, timeoutMs: 5_000 }],
        rollbackBoundary: { kind: 'agent-owned-hunks', files: ['app.ts'] },
      },
    });
    const journalPath = join(workspace, '.applik8s/dev/builder-qualification.sqlite');
    let applicationState: 'ready' | 'failed' = 'ready';
    const daemon = await createDevelopmentDaemon({
      projectName: 'builder-qualification',
      workspaceRoot: workspace,
      revision: 'sha256:builder-qualification',
      target: 'local',
      port: 0,
      journalPath,
      agentProvider: provider,
      validationCommands: {
        typecheck: {
          executable: process.execPath,
          args: ['-e', 'process.stdout.write("builder-validation-passed")'],
          inheritedEnvironment: ['PATH'],
        },
      },
      state: async () => ({
        application: applicationState === 'ready'
          ? { state: 'ready', message: 'Generated application is running.' }
          : { state: 'failed', message: 'Generated application is unavailable.' },
        runtime: { state: 'ready', message: 'Independent Builder daemon is healthy.' },
      }),
    });
    await daemon.start();
    let browser: Browser | undefined;
    const headers = {
      authorization: `Bearer ${daemon.sessionToken}`,
      origin: daemon.origin,
      'content-type': 'application/json',
      'x-applik8s-csrf': '1',
    };
    let sessionId = '';
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(daemon.origin, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Builder', exact: true }).click();
      await page.getByRole('navigation', { name: 'Builder workflow' }).waitFor();
      expect(await page.getByRole('navigation', { name: 'Builder workflow' }).allTextContents()).toEqual([
        expect.stringMatching(/Conversation.*Plan.*Changes.*Preview.*Evidence/su),
      ]);
      const started = await fetch(`${daemon.origin}/v1/agent/sessions`, {
        method: 'POST', headers, body: JSON.stringify({ mode: 'reviewed-apply' }),
      }).then((response) => response.json()) as { readonly session: { readonly id: string } };
      sessionId = started.session.id;
      const turn = await fetch(`${daemon.origin}/v1/agent/sessions/${sessionId}/turns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'propose',
          request: 'Update the greeting and prove the complete reviewed change lifecycle.',
          requestedOutcome: 'Update the greeting and prove the complete reviewed change lifecycle.',
        }),
      });
      expect(turn.status).toBe(200);
      expect(await turn.text()).toContain('plan_builder_closed_loop');
      expect(daemon.coordinator.snapshot().plans).toEqual([
        expect.objectContaining({
          id: 'plan_builder_closed_loop',
          approved: false,
          applied: false,
          requiredApprovals: ['source-mutation'],
        }),
      ]);
      expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toBe(original);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Builder', exact: true }).click();
      await page.getByText('Update the greeting through the reviewed Builder boundary', { exact: true }).waitFor();
      for (const surface of ['PLAN', 'CHANGES', 'PREVIEW', 'EVIDENCE']) {
        expect(await page.getByText(surface, { exact: true }).count()).toBeGreaterThan(0);
      }

      const insufficient = await fetch(`${daemon.origin}/v1/plans/plan_builder_closed_loop/approve`, {
        method: 'POST', headers, body: JSON.stringify({ classes: [], principal: 'developer:qualification' }),
      });
      expect(insufficient.status).toBe(422);
      expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toBe(original);

      expect((await fetch(`${daemon.origin}/v1/plans/plan_builder_closed_loop/approve`, {
        method: 'POST', headers, body: JSON.stringify({ classes: ['source-mutation'], principal: 'developer:qualification' }),
      })).status).toBe(200);
      await writeFile(join(workspace, 'app.ts'), `${original}// unrelated developer work\n`);
      const dirtyApply = await fetch(`${daemon.origin}/v1/plans/plan_builder_closed_loop/apply`, {
        method: 'POST', headers, body: '{}',
      });
      expect(dirtyApply.status).toBe(422);
      expect(await dirtyApply.json()).toMatchObject({ message: expect.stringMatching(/was reviewed at .* but is now/u) });
      expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toContain('unrelated developer work');
      await writeFile(join(workspace, 'app.ts'), original);
      const applied = await fetch(`${daemon.origin}/v1/plans/plan_builder_closed_loop/apply`, {
        method: 'POST', headers, body: '{}',
      });
      expect(applied.status).toBe(200);
      expect(await applied.json()).toMatchObject({
        state: 'complete',
        evidence: [{ commandClass: 'typecheck', state: 'passed', redactedOutput: 'builder-validation-passed' }],
      });
      expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toBe(updated);

      applicationState = 'failed';
      expect(await fetch(`${daemon.origin}/v1/state`, { headers }).then((response) => response.json())).toMatchObject({
        application: { state: 'failed' },
        runtime: { state: 'ready' },
        journal: { valid: true },
        development: { plans: [expect.objectContaining({ id: 'plan_builder_closed_loop', applied: true })] },
      });
    } finally {
      await browser?.close();
      await daemon.stop();
    }

    const recovered = await createDevelopmentDaemon({
      projectName: 'builder-qualification',
      workspaceRoot: workspace,
      revision: 'sha256:builder-qualification',
      target: 'local',
      port: 0,
      journalPath,
      agentProvider: provider,
      state: async () => ({
        application: { state: 'failed', message: 'Generated application remains unavailable.' },
        runtime: { state: 'ready', message: 'Recovered Builder daemon is healthy.' },
      }),
    });
    await recovered.start();
    const recoveredHeaders = {
      authorization: `Bearer ${recovered.sessionToken}`,
      origin: recovered.origin,
      'content-type': 'application/json',
      'x-applik8s-csrf': '1',
    };
    try {
      expect(recovered.coordinator.snapshot().plans).toEqual([
        expect.objectContaining({ id: 'plan_builder_closed_loop', approved: true, applied: true }),
      ]);
      await writeFile(join(workspace, 'app.ts'), `${updated}// user-owned change\n`);
      const conflictingUndo = await fetch(`${recovered.origin}/v1/plans/plan_builder_closed_loop/undo`, {
        method: 'POST', headers: recoveredHeaders, body: '{}',
      });
      expect(conflictingUndo.status).toBe(422);
      expect(await conflictingUndo.json()).toMatchObject({ message: expect.stringMatching(/changed after the reviewed apply/u) });
      expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toContain('user-owned change');

      await writeFile(join(workspace, 'app.ts'), updated);
      expect((await fetch(`${recovered.origin}/v1/plans/plan_builder_closed_loop/undo`, {
        method: 'POST', headers: recoveredHeaders, body: '{}',
      })).status).toBe(200);
      expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toBe(original);
      expect(await recovered.journal.verify()).toMatchObject({ valid: true });
      expect((await recovered.journal.events()).map(({ kind }) => kind)).toEqual(expect.arrayContaining([
        'agent.session-started', 'plan.proposed', 'plan.approved', 'plan.applied',
        'validation.evidence', 'plan.completed', 'plan.undone',
      ]));
      expect(sessionId).not.toBe('');
    } finally {
      await recovered.stop();
    }
  }, 45_000);
});

async function serveModel(
  request: IncomingMessage,
  response: ServerResponse,
  requests: unknown[],
  responseText: () => string,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/v1/models') {
    json(response, { object: 'list', data: [{ id: 'coder', object: 'model', owned_by: 'qualification' }] });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  const body = await bodyJson(request);
  requests.push(body);
  const text = responseText();
  if (Reflect.get(body, 'stream') === true) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-builder', object: 'chat.completion.chunk', created: 1, model: 'coder', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-builder', object: 'chat.completion.chunk', created: 1, model: 'coder', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
    return;
  }
  json(response, {
    id: 'chatcmpl-builder', object: 'chat.completion', created: 1, model: 'coder',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 },
  });
}

async function bodyJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model request body is invalid.');
  return value as Record<string, unknown>;
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function addressPort(address: AddressInfo | string | null): number {
  if (!address || typeof address === 'string') throw new Error('Qualification server did not bind a TCP port.');
  return address.port;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = addressPort(server.address());
  server.close();
  await once(server, 'close');
  return port;
}
