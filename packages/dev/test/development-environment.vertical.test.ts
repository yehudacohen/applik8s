// typecast-file-boundary: Test doubles intentionally model untyped process, filesystem, and HTTP boundary values.
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DevelopmentAgentProvider, DevelopmentEvent } from '../src/agent/index.js';
import type { DevelopmentChangePlan } from '../src/contracts.js';
import { DevelopmentCoordinator } from '../src/coordinator.js';
import { openDevelopmentJournal } from '../src/journal.js';
import { createDevelopmentDaemon } from '../src/server.js';
import { renderDevelopmentPortal } from '../src/ui.js';
import { applyDevelopmentChange, developmentContentDigest, undoDevelopmentChange } from '../src/workspace.js';

describe('independent development environment', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it('persists a verified hash-chained SQLite/WAL journal across restart', async () => {
    const root = await temporaryRoot();
    const path = join(root, '.applik8s/dev/journal.sqlite');
    const first = await openDevelopmentJournal(path);
    await first.append('session.started', { sessionId: 'one' });
    await first.append('plan.approved', { planId: 'plan-one' });
    expect(await first.verify()).toEqual({ valid: true, verifiedThrough: 2 });
    first.close();
    const recovered = await openDevelopmentJournal(path);
    expect((await recovered.events()).map(({ kind }) => kind)).toEqual(['session.started', 'plan.approved']);
    expect(await recovered.verify()).toEqual({ valid: true, verifiedThrough: 2 });
    recovered.close();
  });

  it('applies and undoes only reviewed files while preserving unrelated dirty work', async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/app.ts'), 'old\n');
    await writeFile(join(root, 'src/unrelated.ts'), 'dirty and user-owned\n');
    const applied = await applyDevelopmentChange(root, plan({ path: 'src/app.ts', baseDigest: developmentContentDigest('old\n'), nextText: 'new\n', classification: 'update' }));
    expect(await readFile(join(root, 'src/app.ts'), 'utf8')).toBe('new\n');
    expect(await readFile(join(root, 'src/unrelated.ts'), 'utf8')).toBe('dirty and user-owned\n');
    await undoDevelopmentChange(root, applied);
    expect(await readFile(join(root, 'src/app.ts'), 'utf8')).toBe('old\n');
    expect(await readFile(join(root, 'src/unrelated.ts'), 'utf8')).toBe('dirty and user-owned\n');
  });

  it('fails optimistic concurrency and path/symlink escape attempts closed', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, 'current.ts'), 'current');
    await expect(applyDevelopmentChange(root, plan({ path: 'current.ts', baseDigest: developmentContentDigest('reviewed'), nextText: 'unsafe', classification: 'update' }))).rejects.toThrow(/reviewed at/u);
    await expect(applyDevelopmentChange(root, plan({ path: '../escape.ts', baseDigest: 'absent', nextText: 'unsafe', classification: 'create' }))).rejects.toThrow(/escapes/u);
    const outside = await temporaryRoot();
    await symlink(outside, join(root, 'outside'));
    await expect(applyDevelopmentChange(root, plan({ path: 'outside/escape.ts', baseDigest: 'absent', nextText: 'unsafe', classification: 'create' }))).rejects.toThrow(/symbolic link/u);
  });

  it('requires scoped approval, persists validation evidence, and recovers undo state', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, 'app.ts'), 'before\n');
    const path = join(root, '.applik8s/dev/journal.sqlite');
    const journal = await openDevelopmentJournal(path);
    const coordinator = await DevelopmentCoordinator.open({
      workspaceRoot: root,
      projectId: 'proof',
      revision: () => 'revision-one',
      journal,
      validationCommands: { typecheck: { executable: process.execPath, args: ['-e', 'process.stdout.write("validated")'] } },
    });
    const reviewed = { ...plan({ path: 'app.ts', baseDigest: developmentContentDigest('before\n'), nextText: 'after\n', classification: 'update' }), id: 'plan_reviewed', validation: [{ id: 'typecheck', commandClass: 'typecheck' as const, required: true as const, timeoutMs: 5_000 }] };
    await coordinator.propose(reviewed);
    await expect(coordinator.apply(reviewed.id)).rejects.toThrow(/not been approved/u);
    await expect(coordinator.approve(reviewed.id, [], 'developer:one')).rejects.toThrow(/source-mutation/u);
    await coordinator.approve(reviewed.id, ['source-mutation'], 'developer:one');
    await expect(coordinator.apply(reviewed.id)).resolves.toMatchObject({ state: 'complete', evidence: [{ state: 'passed', redactedOutput: 'validated' }] });
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('after\n');
    journal.close();
    const recoveredJournal = await openDevelopmentJournal(path);
    const recovered = await DevelopmentCoordinator.open({ workspaceRoot: root, projectId: 'proof', revision: () => 'revision-one', journal: recoveredJournal });
    await recovered.undo(reviewed.id);
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('before\n');
    expect((await recoveredJournal.events()).map(({ kind }) => kind).slice(-2)).toEqual(['plan.completed', 'plan.undone']);
    recoveredJournal.close();
  });

  it('keeps secret canaries out of attachments, plans, validation evidence, and the durable journal', async () => {
    const canary = 'applik8s-secret-canary-7f5c88e87f13';
    const root = await temporaryRoot();
    await writeFile(join(root, 'app.ts'), 'before\n');
    const path = join(root, '.applik8s/dev/journal.sqlite');
    const journal = await openDevelopmentJournal(path);
    const coordinator = await DevelopmentCoordinator.open({
      workspaceRoot: root,
      projectId: 'secret-proof',
      revision: () => 'revision-one',
      journal,
      knownSecretValues: [canary],
      validationCommands: {
        typecheck: {
          executable: process.execPath,
          args: ['-e', `process.stdout.write(${JSON.stringify(canary)})`],
        },
      },
    });
    const attachment = await coordinator.admitSelection({
      id: 'selection_secret_proof',
      capturedAtRevision: 'revision-one',
      route: { pathname: '/app', searchKeys: [] },
      element: { role: 'button', boundedText: `Create ${canary}` },
      text: { boundedValue: `Visible ${canary}`, redaction: 'partial' },
      sourceHints: [],
    });
    expect(JSON.stringify(attachment)).not.toContain(canary);
    expect(JSON.stringify(attachment)).toContain('[REDACTED]');

    await expect(coordinator.propose({
      ...plan({
        path: 'app.ts',
        baseDigest: developmentContentDigest('before\n'),
        nextText: `export const credential = ${JSON.stringify(canary)};\n`,
        classification: 'update',
      }),
      id: 'plan_secret_rejected',
    })).rejects.toThrow(/known secret value/u);

    const reviewed = {
      ...plan({
        path: 'app.ts',
        baseDigest: developmentContentDigest('before\n'),
        nextText: 'after\n',
        classification: 'update',
      }),
      id: 'plan_secret_validation',
      validation: [{ id: 'typecheck', commandClass: 'typecheck' as const, required: true as const, timeoutMs: 5_000 }],
    };
    await coordinator.propose(reviewed);
    await coordinator.approve(reviewed.id, ['source-mutation'], 'developer:one');
    const outcome = await coordinator.apply(reviewed.id);
    expect(JSON.stringify(outcome)).not.toContain(canary);
    expect(outcome.evidence[0]?.redactedOutput).toBe('[REDACTED]');
    expect(JSON.stringify(await journal.events())).not.toContain(canary);
    journal.close();
  });

  it('renders the independent recovery portal without generated-application code', () => {
    const html = renderDevelopmentPortal({ projectName: 'proof', revision: 'sha256:revision', target: 'local', scriptNonce: 'test-nonce' });
    expect(html).toContain('Applik8s Builder');
    expect(html).toContain('The portal remains available when the application cannot compile or start.');
    expect(html).toContain('PROVIDER GUARANTEES');
    expect(html).toContain('SCHEDULES AND DATASETS');
    expect(html).toContain('real-account qualification required');
    expect(html).toContain('What outcome do you want?');
    expect(html).toContain('Approve exact scopes');
    expect(html).toContain('applik8s dev --agent');
  });

  it.skipIf(process.env.APPLIK8S_DEV_LIVE !== '1')('keeps health and recovery state available independently of an application failure', async () => {
    const root = await temporaryRoot();
    const applicationOrigin = 'http://127.0.0.1:3010';
    const daemon = await createDevelopmentDaemon({ projectName: 'proof', workspaceRoot: root, revision: 'sha256:revision', target: 'local', port: 0, allowedOrigins: [applicationOrigin], state: async () => ({ application: { state: 'failed', message: 'Typecheck failed.' }, runtime: { state: 'ready', message: 'Providers healthy.' } }) });
    await daemon.start();
    try {
      expect(await fetch(`${daemon.origin}/v1/health`).then((response) => response.json())).toMatchObject({ ready: true, applicationIndependent: true });
      const state = await fetch(`${daemon.origin}/v1/state`, { headers: { authorization: `Bearer ${daemon.sessionToken}`, origin: daemon.origin } }).then((response) => response.json());
      expect(state).toMatchObject({ application: { state: 'failed' }, runtime: { state: 'ready' }, journal: { valid: true } });
      expect((await fetch(`${daemon.origin}/v1/state`, { headers: { authorization: 'Bearer invalid' } })).status).toBe(403);
      const preflight = await fetch(`${daemon.origin}/v1/selections`, { method: 'OPTIONS', headers: { origin: applicationOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-applik8s-bridge, x-applik8s-bridge-nonce' } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(applicationOrigin);
      const selection = await fetch(`${daemon.origin}/v1/selections`, { method: 'POST', headers: { origin: applicationOrigin, 'content-type': 'application/json', 'x-applik8s-bridge': daemon.bridgeToken, 'x-applik8s-bridge-nonce': 'nonce_for_selection_001' }, body: JSON.stringify({ id: 'selection_one_001', capturedAtRevision: 'sha256:revision', route: { pathname: '/app', searchKeys: [] }, element: { role: 'button', boundedText: 'Create' }, sourceHints: [] }) });
      expect(selection.status).toBe(201);
      expect(selection.headers.get('access-control-allow-origin')).toBe(applicationOrigin);
      expect(daemon.coordinator.snapshot().attachments).toHaveLength(1);
    } finally { await daemon.stop(); }
  });

  it.skipIf(process.env.APPLIK8S_DEV_LIVE !== '1')('brokers a reviewed agent proposal through apply, undo, and daemon recovery', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, 'app.ts'), 'before\n');
    const proposed = { ...plan({ path: 'app.ts', baseDigest: developmentContentDigest('before\n'), nextText: 'after\n', classification: 'update' }), id: 'plan_agent_review' };
    let restoreCount = 0;
    const provider = (): DevelopmentAgentProvider => ({
      async startSession() { return { id: 'session_reviewed', provider: 'proof', createdAt: '2026-08-20T00:00:00.000Z' }; },
      inspect: () => events({ type: 'message', text: 'Inspection only.' }),
      propose: () => events({ type: 'plan', plan: proposed }),
      continue: () => events({ type: 'message', text: 'Continued.' }),
      async cancel(input) { return { sessionId: input.sessionId, turnId: input.turnId, state: 'cancelled' }; },
      async close() {},
      async restoreSession(session) { restoreCount += 1; return session; },
    });
    const journalPath = join(root, '.applik8s/dev/journal.sqlite');
    const daemon = await createDevelopmentDaemon({ projectName: 'proof', workspaceRoot: root, revision: 'sha256:revision', target: 'local', port: 0, journalPath, agentProvider: provider() });
    await daemon.start();
    const headers = { authorization: `Bearer ${daemon.sessionToken}`, origin: daemon.origin, 'content-type': 'application/json', 'x-applik8s-csrf': '1' };
    try {
      const started = await fetch(`${daemon.origin}/v1/agent/sessions`, { method: 'POST', headers, body: '{}' }).then((response) => response.json()) as { readonly session: { readonly id: string } };
      const turn = await fetch(`${daemon.origin}/v1/agent/sessions/${started.session.id}/turns`, { method: 'POST', headers, body: JSON.stringify({ kind: 'propose', request: 'Update the application.' }) });
      expect(turn.status).toBe(200);
      expect(await turn.text()).toContain('plan_agent_review');
      expect(daemon.coordinator.snapshot().plans).toEqual([expect.objectContaining({ id: 'plan_agent_review', requiredApprovals: ['source-mutation'] })]);
      expect((await fetch(`${daemon.origin}/v1/plans/plan_agent_review/approve`, { method: 'POST', headers, body: JSON.stringify({ classes: ['source-mutation'], principal: 'developer:test' }) })).status).toBe(200);
      expect((await fetch(`${daemon.origin}/v1/plans/plan_agent_review/apply`, { method: 'POST', headers, body: '{}' })).status).toBe(200);
      expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('after\n');
      expect((await fetch(`${daemon.origin}/v1/plans/plan_agent_review/undo`, { method: 'POST', headers, body: '{}' })).status).toBe(200);
      expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('before\n');
    } finally { await daemon.stop(); }
    const recovered = await createDevelopmentDaemon({ projectName: 'proof', workspaceRoot: root, revision: 'sha256:revision', target: 'local', port: 0, journalPath, agentProvider: provider() });
    expect(restoreCount).toBe(1);
    await recovered.start();
    await recovered.stop();
  });

  async function temporaryRoot(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'applik8s-dev-')); roots.push(root); return root; }
});

async function* events(event: DevelopmentEvent): AsyncIterable<DevelopmentEvent> { yield event; }

function plan(file: DevelopmentChangePlan['files'][number]): DevelopmentChangePlan {
  return { id: 'plan-one', summary: 'Update one file', requestedOutcome: 'proof', contextReferents: [], files: [file], graphChanges: [], schemaChanges: [], authorityChanges: [], infrastructureChanges: [], dependencies: [], risks: [], validation: [], rollbackBoundary: { kind: 'agent-owned-hunks', files: [file.path] } };
}
