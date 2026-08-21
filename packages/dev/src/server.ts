// typecast-file-boundary: Development HTTP requests and agent payloads are decoded from unknown JSON at this boundary.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { DevelopmentApprovalClass, DevelopmentChangePlan, DevelopmentConversationReferent, DevelopmentVisualSelection } from './contracts.js';
import type {
  DevelopmentAgentProvider,
  DevelopmentEvent,
  DevelopmentSession,
  StartDevelopmentSession,
} from './agent/index.js';
import { DevelopmentCoordinator } from './coordinator.js';
import type { DevelopmentJournal } from './journal.js';
import { openDevelopmentJournal } from './journal.js';
import { renderDevelopmentPortal } from './ui.js';
import { redactDevelopmentText, redactDevelopmentValue } from './redaction.js';
import type { DevelopmentValidationCommands } from './validation.js';

export interface DevelopmentDaemonState {
  readonly project: { readonly name: string; readonly root: string; readonly revision: string };
  readonly application: { readonly state: 'ready' | 'building' | 'failed' | 'stopped'; readonly message: string };
  readonly runtime: { readonly state: 'ready' | 'degraded' | 'failed' | 'stopped'; readonly message: string };
  readonly target: string;
  /** Redacted, compiler-derived evidence for the current source revision. */
  readonly evidence?: DevelopmentApplicationEvidence;
}

export interface DevelopmentApplicationEvidence {
  readonly schemaVersion: 'applik8s.developmentEvidence/v1alpha1';
  readonly sourceDigest: string;
  readonly artifacts: {
    readonly applicationPlan: string;
    readonly targetPlan: string;
  };
  readonly semantic: {
    readonly nodes: number;
    readonly executions: number;
    readonly authorityGrants: number;
    readonly dataFlows: number;
    readonly stateAuthorities: number;
    readonly exposures: number;
  };
  readonly providers: {
    readonly total: number;
    readonly resolved: number;
    readonly unresolved: number;
    readonly gaps: number;
  };
  readonly runtimeAccess: {
    readonly requirements: number;
    readonly executionIdentities: readonly string[];
  };
  readonly telemetry: readonly { readonly subject: string; readonly signals: readonly string[]; readonly collector: string; readonly export: string }[];
  readonly schedules: readonly { readonly id: string; readonly configuration: string }[];
  readonly datasets: readonly { readonly id: string; readonly event: string }[];
  readonly actors: readonly { readonly id: string; readonly published: boolean; readonly realtime: boolean }[];
  readonly targetPlans: readonly { readonly target: string; readonly lifecycleAuthority: string; readonly resources: number; readonly status: 'materialized' | 'available-on-demand' | 'external-evidence-required' }[];
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
}

export interface DevelopmentDaemonOptions {
  readonly projectName: string;
  readonly workspaceRoot: string;
  readonly revision: string | (() => string);
  readonly target: string;
  readonly port?: number;
  readonly allowedOrigins?: readonly string[] | (() => readonly string[]);
  readonly journalPath?: string;
  readonly state?: () => Promise<Omit<DevelopmentDaemonState, 'project' | 'target'>>;
  readonly validationCommands?: DevelopmentValidationCommands;
  readonly knownSecretValues?: readonly string[];
  /** Optional local coding provider. The portal remains useful without one. */
  readonly agentProvider?: DevelopmentAgentProvider;
}

export interface DevelopmentDaemon {
  readonly origin: string;
  /** Daemon API capability. Never emitted into generated application code. */
  readonly sessionToken: string;
  /** Selection-only capability for the development toolbar. */
  readonly bridgeToken: string;
  readonly journal: DevelopmentJournal;
  readonly coordinator: DevelopmentCoordinator;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Loopback-only portal/daemon whose lifecycle does not depend on the generated application. */
export async function createDevelopmentDaemon(options: DevelopmentDaemonOptions): Promise<DevelopmentDaemon> {
  const host = '127.0.0.1';
  const port = options.port ?? 3418;
  if (!Number.isInteger(port) || port !== 0 && (port < 1024 || port > 65535)) throw new Error('Development daemon port is invalid.');
  let origin = `http://${host}:${port}`;
  const sessionToken = randomBytes(32).toString('base64url');
  const bridgeToken = randomBytes(32).toString('base64url');
  const usedBridgeNonces = new Set<string>();
  const root = resolve(options.workspaceRoot);
  const configuredRevision = options.revision;
  const currentRevision: () => string = typeof configuredRevision === 'function' ? configuredRevision : () => configuredRevision;
  const journal = await openDevelopmentJournal(options.journalPath ?? resolve(root, '.applik8s/dev/journal.sqlite'));
  const coordinator = await DevelopmentCoordinator.open({
    workspaceRoot: root,
    projectId: options.projectName,
    revision: currentRevision,
    journal,
    ...(options.validationCommands ? { validationCommands: options.validationCommands } : {}),
    ...(options.knownSecretValues ? { knownSecretValues: options.knownSecretValues } : {}),
  });
  const agentSessions = await recoverAgentSessions(options.agentProvider, journal);
  const server = createServer(async (request, response) => {
    const scriptNonce = randomBytes(18).toString('base64url');
    try {
      harden(response, scriptNonce);
      assertLoopbackHost(request, origin);
      const url = new URL(request.url ?? '/', origin);
      if (request.method === 'GET' && url.pathname === '/') {
        response.setHeader('set-cookie', `applik8s_dev=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
        html(response, renderDevelopmentPortal({ projectName: options.projectName, revision: currentRevision(), target: options.target, scriptNonce }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/health') { json(response, 200, { ready: true, applicationIndependent: true, revision: currentRevision() }); return; }
      const effectivePort = new URL(origin).port;
      const configuredOrigins = typeof options.allowedOrigins === 'function' ? options.allowedOrigins() : options.allowedOrigins;
      const allowedOrigins = new Set([origin, `http://localhost:${effectivePort}`, ...(configuredOrigins ?? [])]);
      if (request.method === 'OPTIONS' && url.pathname === '/v1/selections') {
        authorizeBridgePreflight(request, allowedOrigins);
        bridgeCors(response, request);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/selections') {
        authorizeBridge(request, allowedOrigins, bridgeToken, usedBridgeNonces);
        const selection = await body<DevelopmentVisualSelection>(request);
        bridgeCors(response, request);
        response.setHeader('cross-origin-resource-policy', 'cross-origin');
        json(response, 201, { attachment: await coordinator.admitSelection(selection) });
        return;
      }
      authorizePortal(request, allowedOrigins, sessionToken);
      if (request.method === 'GET' && url.pathname === '/v1/state') {
        const dynamic = await options.state?.() ?? { application: { state: 'stopped' as const, message: 'Application state has not been connected.' }, runtime: { state: 'stopped' as const, message: 'Local supervisor state has not been connected.' } };
        const verification = await journal.verify();
        json(response, 200, {
          project: { name: options.projectName, root, revision: currentRevision() },
          target: options.target,
          ...dynamic,
          journal: verification,
          development: coordinator.snapshot(),
          agent: {
            available: Boolean(options.agentProvider),
            sessions: [...agentSessions.values()].map(({ session }) => session),
          },
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/journal') { json(response, 200, { events: await journal.events(Number(url.searchParams.get('after') ?? 0)), verification: await journal.verify() }); return; }
      if (request.method === 'POST' && url.pathname === '/v1/referents') { const value = await body<DevelopmentConversationReferent>(request); await coordinator.saveReferent(value); json(response, 201, { accepted: true }); return; }
      const attachment = /^\/v1\/attachments\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'DELETE' && attachment?.[1]) { await coordinator.removeAttachment(decodeURIComponent(attachment[1])); json(response, 200, { removed: true }); return; }
      if (request.method === 'POST' && url.pathname === '/v1/plans') { const value = await body<DevelopmentChangePlan>(request); await coordinator.propose(value); json(response, 201, { accepted: true }); return; }
      if (request.method === 'POST' && url.pathname === '/v1/agent/sessions') {
        if (!options.agentProvider) throw new Error('No development-agent provider is configured. Restart `applik8s dev` with --agent.');
        const value = await body<{ readonly mode?: 'suggest' | 'reviewed-apply'; readonly consentedAttachmentClasses?: readonly string[] }>(request);
        const configuration: StartDevelopmentSession = {
          projectId: options.projectName,
          workspaceRoot: root,
          mode: value.mode ?? 'reviewed-apply',
          sourceEgress: {
            provider: 'local',
            remote: false,
            consentedAttachmentClasses: value.consentedAttachmentClasses ?? [
              'visualSelection', 'source', 'graphNode', 'operation', 'runtimeTrace',
              'applicationPlanNode', 'validationEvidence',
            ],
          },
        };
        const session = await options.agentProvider.startSession(configuration);
        agentSessions.set(session.id, { session, configuration });
        await journal.append('agent.session-started', { session, configuration });
        json(response, 201, { session });
        return;
      }
      const agentTurn = /^\/v1\/agent\/sessions\/([^/]+)\/turns$/u.exec(url.pathname);
      if (request.method === 'POST' && agentTurn?.[1]) {
        if (!options.agentProvider) throw new Error('No development-agent provider is configured.');
        const sessionId = decodeURIComponent(agentTurn[1]);
        if (!agentSessions.has(sessionId)) throw new Error(`Unknown development-agent session ${sessionId}.`);
        const value = await body<{
          readonly kind?: 'inspect' | 'propose'; readonly request: string; readonly requestedOutcome?: string;
          readonly attachmentIds?: readonly string[]; readonly referentIds?: readonly string[];
        }>(request);
        if (!value.request?.trim()) throw new SyntaxError('Development-agent request must not be empty.');
        const context = coordinator.context(value.attachmentIds, value.referentIds);
        const events = value.kind === 'inspect'
          ? options.agentProvider.inspect({ sessionId, request: value.request, ...context })
          : options.agentProvider.propose({ sessionId, request: value.request, requestedOutcome: value.requestedOutcome?.trim() || value.request, ...context });
        response.statusCode = 200;
        response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
        response.setHeader('x-content-type-options', 'nosniff');
        try {
          for await (const event of events) {
            if (event.type === 'plan') await coordinator.propose(event.plan);
            const safeEvent = safeAgentEvent(event, options.knownSecretValues ?? []);
            await journal.append('agent.turn-event', { sessionId, event: redactedAgentEvent(safeEvent) });
            response.write(`${JSON.stringify(safeEvent)}\n`);
          }
        } catch (cause) {
          const event: DevelopmentEvent = {
            type: 'diagnostic', severity: 'error', code: 'DEVELOPMENT_AGENT_TURN_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          };
          const safeEvent = safeAgentEvent(event, options.knownSecretValues ?? []);
          await journal.append('agent.turn-event', { sessionId, event: redactedAgentEvent(safeEvent) });
          response.write(`${JSON.stringify(safeEvent)}\n`);
        }
        response.end();
        return;
      }
      const agentCancel = /^\/v1\/agent\/sessions\/([^/]+)\/turns\/([^/]+)\/cancel$/u.exec(url.pathname);
      if (request.method === 'POST' && agentCancel?.[1] && agentCancel[2]) {
        if (!options.agentProvider) throw new Error('No development-agent provider is configured.');
        const outcome = await options.agentProvider.cancel({ sessionId: decodeURIComponent(agentCancel[1]), turnId: decodeURIComponent(agentCancel[2]) });
        await journal.append('agent.turn-cancelled', { outcome });
        json(response, 200, outcome);
        return;
      }
      const agentSession = /^\/v1\/agent\/sessions\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'DELETE' && agentSession?.[1]) {
        if (!options.agentProvider) throw new Error('No development-agent provider is configured.');
        const sessionId = decodeURIComponent(agentSession[1]);
        await options.agentProvider.close({ sessionId });
        agentSessions.delete(sessionId);
        await journal.append('agent.session-closed', { sessionId });
        json(response, 200, { closed: true });
        return;
      }
      const approval = /^\/v1\/plans\/([^/]+)\/approve$/u.exec(url.pathname);
      if (request.method === 'POST' && approval?.[1]) {
        const value = await body<{ readonly classes: readonly DevelopmentApprovalClass[]; readonly principal: string }>(request);
        await coordinator.approve(decodeURIComponent(approval[1]), value.classes, value.principal);
        json(response, 200, { approved: true }); return;
      }
      const apply = /^\/v1\/plans\/([^/]+)\/apply$/u.exec(url.pathname);
      if (request.method === 'POST' && apply?.[1]) { json(response, 200, await coordinator.apply(decodeURIComponent(apply[1]))); return; }
      const undo = /^\/v1\/plans\/([^/]+)\/undo$/u.exec(url.pathname);
      if (request.method === 'POST' && undo?.[1]) { await coordinator.undo(decodeURIComponent(undo[1])); json(response, 200, { undone: true }); return; }
      json(response, 404, { error: 'not_found' });
    } catch (cause) {
      const status = cause instanceof DevelopmentAuthorizationError ? 403 : cause instanceof SyntaxError ? 400 : 422;
      json(response, status, {
        error: status === 403 ? 'forbidden' : 'request_rejected',
        message: redactDevelopmentText(
          cause instanceof Error ? cause.message : String(cause),
          options.knownSecretValues ?? [],
        ),
      });
    }
  });
  return {
    get origin() { return origin; }, sessionToken, bridgeToken, journal, coordinator,
    start: () => new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); const address = server.address(); if (!address || typeof address === 'string') { reject(new Error('Development daemon did not receive a TCP address.')); return; } origin = `http://${host}:${address.port}`; accept(); }); }),
    stop: () => new Promise((accept, reject) => server.close((error) => {
      void (async () => {
        try { await options.agentProvider?.stop?.(); }
        finally {
          journal.close();
          if (error) reject(error); else accept();
        }
      })();
    })),
  };
}

interface RecoveredAgentSession {
  readonly session: DevelopmentSession;
  readonly configuration: StartDevelopmentSession;
}

async function recoverAgentSessions(
  provider: DevelopmentAgentProvider | undefined,
  journal: DevelopmentJournal,
): Promise<Map<string, RecoveredAgentSession>> {
  const sessions = new Map<string, RecoveredAgentSession>();
  for (const event of await journal.events()) {
    if (event.kind === 'agent.session-started' && isRecoveredAgentSession(event.payload)) {
      sessions.set(event.payload.session.id, event.payload);
    }
    if (event.kind === 'agent.session-closed' && typeof event.payload.sessionId === 'string') sessions.delete(event.payload.sessionId);
  }
  if (provider?.restoreSession) {
    for (const recovered of sessions.values()) await provider.restoreSession(recovered.session, recovered.configuration);
  }
  return sessions;
}

function isRecoveredAgentSession(value: Readonly<Record<string, unknown>>): value is Readonly<Record<string, unknown>> & RecoveredAgentSession {
  const session = value.session;
  const configuration = value.configuration;
  return Boolean(
    session && typeof session === 'object' && !Array.isArray(session) && typeof Reflect.get(session, 'id') === 'string'
    && configuration && typeof configuration === 'object' && !Array.isArray(configuration)
    && typeof Reflect.get(configuration, 'projectId') === 'string'
  );
}

function redactedAgentEvent(event: DevelopmentEvent): Readonly<Record<string, unknown>> {
  if (event.type === 'plan') return { type: 'plan', planId: event.plan.id, summary: event.plan.summary };
  if (event.type === 'message') return { type: 'message', text: event.text };
  return { ...event };
}

function safeAgentEvent(event: DevelopmentEvent, knownSecretValues: readonly string[]): DevelopmentEvent {
  if (event.type === 'message') return { ...event, text: redactDevelopmentText(event.text, knownSecretValues) };
  if (event.type === 'diagnostic') return { ...event, message: redactDevelopmentText(event.message, knownSecretValues) };
  if (event.type === 'plan') return event;
  return redactDevelopmentValue(event, knownSecretValues) as DevelopmentEvent;
}

class DevelopmentAuthorizationError extends Error {}
function authorizePortal(request: IncomingMessage, origins: ReadonlySet<string>, token: string): void {
  const authorization = request.headers.authorization;
  const cookies = parseCookies(request.headers.cookie);
  if (authorization !== `Bearer ${token}` && cookies.applik8s_dev !== token) throw new DevelopmentAuthorizationError('Development daemon capability is absent or invalid.');
  assertOrigin(request, origins);
  if (request.method !== 'GET' && request.headers['x-applik8s-csrf'] !== '1') throw new DevelopmentAuthorizationError('Development mutation requires its same-origin CSRF header.');
}
function authorizeBridge(request: IncomingMessage, origins: ReadonlySet<string>, token: string, usedNonces: Set<string>): void {
  assertOrigin(request, origins);
  if (request.headers['x-applik8s-bridge'] !== token) throw new DevelopmentAuthorizationError('Development toolbar bridge capability is absent or invalid.');
  const nonce = request.headers['x-applik8s-bridge-nonce'];
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(nonce) || usedNonces.has(nonce)) throw new DevelopmentAuthorizationError('Development toolbar selection nonce is absent, invalid, or replayed.');
  usedNonces.add(nonce);
  if (usedNonces.size > 10_000) usedNonces.delete(usedNonces.values().next().value as string);
}
function authorizeBridgePreflight(request: IncomingMessage, origins: ReadonlySet<string>): void {
  assertOrigin(request, origins);
  const requestedMethod = request.headers['access-control-request-method'];
  const requestedHeaders = request.headers['access-control-request-headers']?.toLowerCase().split(',').map((value) => value.trim()) ?? [];
  if (requestedMethod !== 'POST') throw new DevelopmentAuthorizationError('Development toolbar preflight requested an unsupported method.');
  if (!['content-type', 'x-applik8s-bridge', 'x-applik8s-bridge-nonce'].every((header) => requestedHeaders.includes(header))) {
    throw new DevelopmentAuthorizationError('Development toolbar preflight omitted required capability headers.');
  }
}
function bridgeCors(response: ServerResponse, request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin) response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, x-applik8s-bridge, x-applik8s-bridge-nonce');
  response.setHeader('access-control-max-age', '600');
  response.setHeader('vary', 'origin');
}
function assertOrigin(request: IncomingMessage, origins: ReadonlySet<string>): void {
  const origin = request.headers.origin;
  if (origin !== undefined && !origins.has(origin)) throw new DevelopmentAuthorizationError(`Origin ${origin} is not admitted for this development daemon.`);
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new DevelopmentAuthorizationError('Cross-site development requests are forbidden.');
}
function assertLoopbackHost(request: IncomingMessage, origin: string): void {
  const expectedPort = new URL(origin).port;
  const host = request.headers.host?.toLowerCase();
  if (host !== `127.0.0.1:${expectedPort}` && host !== `localhost:${expectedPort}`) throw new DevelopmentAuthorizationError('Development daemon rejects non-loopback Host headers.');
}
function parseCookies(header: string | undefined): Record<string, string> { return Object.fromEntries((header ?? '').split(';').flatMap((part) => { const index = part.indexOf('='); return index < 1 ? [] : [[part.slice(0, index).trim(), part.slice(index + 1).trim()]]; })); }
async function body<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const value = Buffer.from(chunk); size += value.length; if (size > 256 * 1024) throw new SyntaxError('Development request body exceeds 256KiB.'); chunks.push(value); } const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('Development request body must be an object.'); return parsed as T; }
function harden(response: ServerResponse, nonce: string): void { response.setHeader('cache-control', 'no-store'); response.setHeader('content-security-policy', `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`); response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('x-frame-options', 'DENY'); response.setHeader('referrer-policy', 'no-referrer'); response.setHeader('cross-origin-resource-policy', 'same-origin'); }
function json(response: ServerResponse, status: number, value: unknown): void { if (response.headersSent) return; response.statusCode = status; response.setHeader('content-type', 'application/json; charset=utf-8'); response.end(JSON.stringify(value)); }
function html(response: ServerResponse, value: string): void { response.statusCode = 200; response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(value); }
