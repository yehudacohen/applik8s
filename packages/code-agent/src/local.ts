// typecast-file-boundary: The local workspace provider validates filesystem,
// process, and JSON boundaries before translating them into protocol records.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  ApplicationAgentHarnessProvider,
  ApplicationCodeWorkspaceLease,
  ApplicationCodeWorkspaceProvider,
  ApplicationProcessRunnerProvider,
  ApplicationSourceRepositoryChange,
  ApplicationSourceRepositoryProvider,
} from './contracts.js';
import { bindCodeAgentProviderRuntime } from './runtime-contract.js';

export interface LocalCodeProviderOptions {
  readonly root: string;
  readonly clock?: () => Date;
}

export function createLocalCodeWorkspaceProvider(
  options: LocalCodeProviderOptions,
): ApplicationCodeWorkspaceProvider {
  const root = resolve(options.root);
  const clock = options.clock ?? (() => new Date());
  const active = new Map<string, ApplicationCodeWorkspaceLease>();
  const implementation: ApplicationCodeWorkspaceProvider = {
    provider: 'local-workspace', kind: 'local-code-workspace', mode: 'live',
    async lease(input) {
      const workspace = stableIdentity(input.workspace, 'workspace');
      const runId = boundedText(input.runId, 'runId', 1, 500);
      const fencingToken = boundedText(input.fencingToken, 'fencingToken', 1, 500);
      const prior = active.get(workspace);
      if (prior) {
        if (prior.runId !== runId || prior.fencingToken !== fencingToken) {
          throw new Error(`Workspace ${workspace} already has an active fenced writer.`);
        }
        return prior;
      }
      const workspaceRoot = inside(root, join(root, workspace));
      await mkdir(workspaceRoot, { recursive: true });
      const acquiredAt = clock();
      const ttlMs = boundedInteger(input.ttlMs ?? 30 * 60_000, 1_000, 24 * 60 * 60_000, 'ttlMs');
      const lease = Object.freeze({
        apiVersion: 'applik8s.codeWorkspaceLease/v1alpha1' as const,
        id: `lease:${workspace}:${createHash('sha256').update(`${runId}\0${fencingToken}`).digest('hex').slice(0, 20)}`,
        workspace,
        runId,
        fencingToken,
        generation: 1,
        root: workspaceRoot,
        baseRevision: input.baseRevision ?? await directoryDigest(workspaceRoot),
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: new Date(acquiredAt.getTime() + ttlMs).toISOString(),
      });
      active.set(workspace, lease);
      return lease;
    },
    async release(input) {
      const current = active.get(input.lease.workspace);
      assertLease(current, input.lease);
      active.delete(input.lease.workspace);
      if (input.disposition === 'release') {
        await rm(inside(root, input.lease.root), { recursive: true, force: true });
      }
      return { released: true };
    },
  };
  return bindCodeAgentProviderRuntime(implementation, 'workspace', {
    env: { APPLIK8S_CODE_WORKSPACE_ROOT: root },
  });
}

export function createLocalSourceRepositoryProvider(
  options: LocalCodeProviderOptions,
): ApplicationSourceRepositoryProvider {
  const root = resolve(options.root);
  const implementation: ApplicationSourceRepositoryProvider = {
    provider: 'local-source', kind: 'local-source-repository', mode: 'live',
    async inspect(input) {
      assertLeaseRoot(root, input.lease);
      const files = input.paths
        ? [...input.paths]
        : await listFiles(input.lease.root);
      const maximumBytes = boundedInteger(input.maximumBytes ?? 1_000_000, 1, 10_000_000, 'maximumBytes');
      let bytes = 0;
      const values = [];
      for (const path of files.sort()) {
        const absolute = inside(input.lease.root, join(input.lease.root, safeRelative(path)));
        const info = await stat(absolute);
        if (!info.isFile()) continue;
        const text = await readFile(absolute, 'utf8');
        bytes += Buffer.byteLength(text);
        if (bytes > maximumBytes) throw new Error('Source inspection exceeded its declared byte bound.');
        values.push(Object.freeze({ path: safeRelative(path), digest: digest(text), text }));
      }
      return Object.freeze({ revision: await directoryDigest(input.lease.root), files: Object.freeze(values) });
    },
    async apply(input) {
      assertLeaseRoot(root, input.lease);
      const normalized = input.changes.map((change) => normalizeChange(input.lease.root, change));
      for (const change of normalized) {
        const prior = await readFile(change.absolute, 'utf8').catch((error: unknown) => {
          if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return '';
          throw error;
        });
        if (prior === change.nextText) continue;
        if (digest(prior) !== change.baseDigest) {
          throw new Error(`Source change ${change.path} no longer matches its admitted base digest.`);
        }
      }
      for (const change of normalized) {
        await mkdir(resolve(change.absolute, '..'), { recursive: true });
        await writeFile(change.absolute, change.nextText, 'utf8');
      }
      return implementation.inspect({ lease: input.lease });
    },
  };
  return bindCodeAgentProviderRuntime(implementation, 'repository', {
    env: { APPLIK8S_CODE_WORKSPACE_ROOT: root },
  });
}

export function createLocalProcessRunnerProvider(options: LocalCodeProviderOptions & {
  readonly allow: readonly string[];
  readonly inheritedEnvironment?: readonly string[];
}): ApplicationProcessRunnerProvider {
  const root = resolve(options.root);
  const allow = new Set(options.allow.map((value) => boundedText(value, 'allowed executable', 1, 200)));
  const inherited = options.inheritedEnvironment ?? ['PATH'];
  const receipts = new Map<string, {
    readonly fingerprint: string;
    readonly result: Awaited<ReturnType<ApplicationProcessRunnerProvider['run']>>;
  }>();
  const implementation: ApplicationProcessRunnerProvider = {
    provider: 'local-process', kind: 'local-process-runner', mode: 'live',
    async run(input) {
      assertLeaseRoot(root, input.lease);
      if (!allow.has(input.executable)) throw new Error(`Process executable ${input.executable} is not authorized.`);
      const timeoutMs = boundedInteger(input.timeoutMs ?? 60_000, 100, 10 * 60_000, 'timeoutMs');
      const idempotencyKey = input.idempotencyKey
        ? boundedText(input.idempotencyKey, 'idempotencyKey', 1, 1_000)
        : undefined;
      const fingerprint = digest(JSON.stringify({
        lease: input.lease.id,
        executable: input.executable,
        arguments: input.arguments ?? [],
        timeoutMs,
      }));
      const prior = idempotencyKey ? receipts.get(idempotencyKey) : undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error(`Process idempotency key ${idempotencyKey} was reused with different input.`);
        return prior.result;
      }
      const startedAt = new Date();
      const result = await boundedProcess(input.executable, input.arguments ?? [], input.lease.root, timeoutMs, inherited);
      const receipt = Object.freeze({
        command: [input.executable, ...(input.arguments ?? [])].join(' '),
        ...result,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      });
      if (idempotencyKey) receipts.set(idempotencyKey, { fingerprint, result: receipt });
      return receipt;
    },
  };
  return bindCodeAgentProviderRuntime(implementation, 'process', {
    env: {
      APPLIK8S_CODE_WORKSPACE_ROOT: root,
      APPLIK8S_CODE_PROCESS_ALLOW: [...allow].sort().join(','),
    },
  });
}

export function createDeterministicAgentHarnessProvider(options: {
  readonly changes?: readonly ApplicationSourceRepositoryChange[];
  readonly summary?: string;
} = {}): ApplicationAgentHarnessProvider {
  const terminal = new Map<string, Awaited<ReturnType<ApplicationAgentHarnessProvider['run']>>>();
  const implementation: ApplicationAgentHarnessProvider = {
    provider: 'deterministic-harness', kind: 'agent-harness-deterministic', mode: 'deterministic',
    async run(input) {
      validateHarnessRequest(input);
      const prior = terminal.get(input.runId);
      if (prior) return prior;
      const result = Object.freeze({
        apiVersion: 'applik8s.agentHarnessResult/v1alpha1' as const,
        runId: input.runId,
        sessionId: `deterministic:${input.runId}`,
        status: 'completed' as const,
        events: Object.freeze([{ sequence: 1, type: 'status' as const, payload: { state: 'completed' } }]),
        changes: Object.freeze([...(options.changes ?? [])]),
        summary: options.summary ?? 'Deterministic code-agent run completed.',
        receipt: Object.freeze({ provider: 'deterministic-harness', fencingTokenDigest: digest(input.fencingToken) }),
      });
      terminal.set(input.runId, result);
      return result;
    },
    async cancel(input) {
      boundedText(input.runId, 'runId', 1, 500);
      boundedText(input.fencingToken, 'fencingToken', 1, 500);
      return { status: terminal.has(input.runId) ? 'alreadyTerminal' : 'cancelled' };
    },
  };
  return bindCodeAgentProviderRuntime(implementation, 'harness', {
    env: { APPLIK8S_AGENT_HARNESS_KIND: 'deterministic' },
  });
}

function validateHarnessRequest(input: Parameters<ApplicationAgentHarnessProvider['run']>[0]): void {
  if (input.apiVersion !== 'applik8s.agentHarnessRun/v1alpha1') throw new Error('Agent harness request protocol is unsupported.');
  boundedText(input.runId, 'runId', 1, 500);
  boundedText(input.fencingToken, 'fencingToken', 1, 500);
  boundedText(input.instruction, 'instruction', 1, 20_000);
  if (Number.isNaN(Date.parse(input.deadline))) throw new Error('Agent harness deadline must be an ISO timestamp.');
  assertLease(input.workspace, input.workspace);
}

function normalizeChange(root: string, change: ApplicationSourceRepositoryChange) {
  return { ...change, path: safeRelative(change.path), absolute: inside(root, join(root, safeRelative(change.path))) };
}

function assertLease(current: ApplicationCodeWorkspaceLease | undefined, presented: ApplicationCodeWorkspaceLease): void {
  if (!current || current.id !== presented.id || current.fencingToken !== presented.fencingToken) {
    throw new Error(`Workspace lease ${presented.id} is stale or not owned by this run.`);
  }
}

function assertLeaseRoot(root: string, lease: ApplicationCodeWorkspaceLease): void {
  if (inside(root, lease.root) !== resolve(lease.root)) throw new Error(`Workspace lease ${lease.id} escapes its provider root.`);
  if (!lease.fencingToken) throw new Error(`Workspace lease ${lease.id} has no fencing token.`);
}

function inside(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(path);
  const offset = relative(absoluteRoot, absolute);
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error(`Path ${path} escapes its workspace authority.`);
  return absolute;
}

function safeRelative(path: string): string {
  if (!path || isAbsolute(path) || path.split(/[\\/]/u).includes('..')) throw new Error(`Source path ${JSON.stringify(path)} is not workspace-relative.`);
  return path.replaceAll('\\', '/');
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.applik8s') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(relative(root, absolute).replaceAll('\\', '/'));
    }
  };
  await visit(root);
  return output;
}

async function directoryDigest(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const path of (await listFiles(root)).sort()) {
    hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableIdentity(value: string, label: string): string {
  const text = boundedText(value, label, 1, 200);
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(text)) throw new Error(`${label} must be a stable lowercase identity.`);
  return text;
}

function boundedText(value: string, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) throw new Error(`${label} must contain ${minimum} to ${maximum} characters.`);
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

function boundedProcess(executable: string, arguments_: readonly string[], cwd: string, timeoutMs: number, inherited: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const environment = Object.fromEntries(inherited.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name] as string]]));
    const child = spawn(executable, [...arguments_], { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString('utf8')}`.slice(-1_000_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Process ${executable} exceeded ${timeoutMs}ms.`)); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise({ exitCode: code ?? -1, stdout, stderr }); });
  });
}
