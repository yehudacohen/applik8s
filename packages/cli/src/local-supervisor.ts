// typecast-file-boundary: Persisted supervisor records and driver output are validated at this process boundary.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer, Socket, type Server as TcpServer } from 'node:net';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  digestLocalSupervisorPlan,
  type LocalSupervisorBinding,
  type LocalSupervisorContainer,
  type LocalSupervisorEnvironment,
  type LocalSupervisorPlan,
  type LocalSupervisorProcess,
  type LocalSupervisorResource,
  validateLocalSupervisorPlan,
} from '@applik8s/deployment-contract';

export interface LocalSupervisorIo {
  readonly cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface LocalSupervisorDriverResource {
  readonly resourceId: string;
  readonly runtimeId: string;
  readonly kind: 'process' | 'container';
  readonly pid?: number;
}

export interface LocalSupervisorDriver {
  startProcess(resource: LocalSupervisorProcess, environment: Readonly<Record<string, string>>): Promise<LocalSupervisorDriverResource>;
  startContainer(resource: LocalSupervisorContainer, environment: Readonly<Record<string, string>>, ports: Readonly<Record<string, number>>, identity: string): Promise<LocalSupervisorDriverResource>;
  stop(resource: LocalSupervisorDriverResource): Promise<void>;
  remove(resource: LocalSupervisorDriverResource): Promise<void>;
  waitHealthy(resource: LocalSupervisorResource, bindings: Readonly<Record<string, string | number>>): Promise<void>;
  /** Resolves declared post-readiness outputs without exposing them through logs. */
  resolveBindings?(resource: LocalSupervisorContainer, runtime: LocalSupervisorDriverResource): Promise<Readonly<Record<string, string | number>>>;
}

export interface LocalSupervisorOptions {
  readonly stateRoot?: string;
  readonly driver?: LocalSupervisorDriver;
  readonly signal?: AbortSignal;
  readonly stopOnAbort?: boolean;
  readonly allocatePort?: () => Promise<number>;
  readonly lifecycle?: LocalSupervisorLifecycle;
}

export interface LocalSupervisorLifecycleContext {
  readonly stateDirectory: string;
  readonly bindings: Readonly<Record<string, string | number>>;
}

export interface LocalSupervisorLifecycle {
  resourceReady?(
    resource: LocalSupervisorResource,
    context: LocalSupervisorLifecycleContext,
  ): Promise<Readonly<Record<string, string | number>> | void>;
  beforeReset?(context: LocalSupervisorLifecycleContext): Promise<void>;
}

export interface LocalSupervisorSession {
  readonly stateDirectory: string;
  readonly state: LocalSupervisorState;
  stop(): Promise<void>;
  reset(): Promise<void>;
}

export interface LocalSupervisorState {
  readonly apiVersion: 'applik8s.localSupervisorState/v1alpha1';
  readonly application: string;
  readonly target: string;
  readonly profile: string;
  readonly projectDigest: string;
  readonly planDigest: string;
  readonly leaseId: string;
  readonly startedAt: string;
  readonly bindings: Readonly<Record<string, string | number>>;
  readonly resources: readonly LocalSupervisorDriverResource[];
}

interface LocalSupervisorLease {
  readonly apiVersion: 'applik8s.localSupervisorLease/v1alpha1';
  readonly pid: number;
  readonly leaseId: string;
  readonly acquiredAt: string;
}

export async function startLocalSupervisor(
  plan: LocalSupervisorPlan,
  io: LocalSupervisorIo,
  options: LocalSupervisorOptions = {},
): Promise<LocalSupervisorSession> {
  const validation = validateLocalSupervisorPlan(plan);
  if (!validation.valid) {
    throw new Error(validation.diagnostics.map(({ code, message }) => `${code}: ${message}`).join('\n'));
  }
  const stateDirectory = options.stateRoot
    ?? resolve(io.cwd, '.applik8s', 'local', plan.target, safePathSegment(plan.projectDigest));
  await mkdir(stateDirectory, { recursive: true });
  const lease = await acquireLocalSupervisorLease(stateDirectory);
  const driver = options.driver ?? nodeLocalSupervisorDriver(io);
  const statePath = join(stateDirectory, 'state.json');
  const secretsPath = join(stateDirectory, 'credentials.json');
  const prior = await readSupervisorState(statePath);
  if (prior) await stopRecordedResources(prior.resources, driver, io);

  const secretValues = await resolveSecretBindings(plan.bindings, secretsPath);
  const publicBindings = await resolvePublicBindings(plan, options.allocatePort ?? availablePort);
  const allBindings: Record<string, string | number> = { ...publicBindings, ...secretValues };
  const started: LocalSupervisorDriverResource[] = [];
  const startedAt = new Date().toISOString();
  try {
    for (const resource of topologicalLocalResources(plan.resources)) {
      if (resource.kind === 'external') continue;
      const environment = {
        ...Object.fromEntries(resource.environment.map((entry) => [entry.name, resolveEnvironment(entry, allBindings, resource.kind)])),
        ...(resource.kind === 'process' ? {
          APPLIK8S_APPLICATION_NAME: plan.application,
          APPLIK8S_DEPLOYMENT_TARGET: plan.target,
          APPLIK8S_ENVIRONMENT_ID: `${plan.target}:${plan.profile}`,
          APPLIK8S_LOCAL_STATE_DIRECTORY: stateDirectory,
          APPLIK8S_SCHEDULE_STATE_PATH: join(stateDirectory, 'schedules.json'),
        } : {}),
      };
      const record = resource.kind === 'process'
        ? await driver.startProcess(resource, environment)
        : await driver.startContainer(resource, environment, containerPorts(resource, publicBindings), localRuntimeIdentity(plan, resource.id));
      started.push(record);
      await driver.waitHealthy(resource, publicBindings);
      const driverBindings = resource.kind === 'container'
        ? await driver.resolveBindings?.(resource, record)
        : undefined;
      if (driverBindings) mergeResolvedBindings(plan, resource, driverBindings, allBindings, publicBindings);
      const resolved = await options.lifecycle?.resourceReady?.(resource, {
        stateDirectory,
        bindings: allBindings,
      });
      if (resolved) mergeResolvedBindings(plan, resource, resolved, allBindings, publicBindings);
      await writeCredentialBindings(secretsPath, plan, allBindings);
      await writeSupervisorState(statePath, supervisorState(plan, lease, startedAt, publicBindings, started));
      io.stdout(`Local ${resource.kind} ready: ${resource.id}`);
    }
  } catch (cause) {
    await stopRecordedResources(started, driver, io);
    await releaseLocalSupervisorLease(stateDirectory, lease.leaseId);
    throw cause;
  }

  let stopped = false;
  const state = supervisorState(plan, lease, startedAt, publicBindings, started);
  await writeSupervisorState(statePath, state);
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await stopRecordedResources([...started].reverse(), driver, io);
    await releaseLocalSupervisorLease(stateDirectory, lease.leaseId);
  };
  const reset = async (): Promise<void> => {
    await options.lifecycle?.beforeReset?.({ stateDirectory, bindings: allBindings });
    await stop();
    for (const resource of [...started].reverse()) await driver.remove(resource).catch((cause) => io.stderr(`Local cleanup warning for ${resource.resourceId}: ${errorMessage(cause)}`));
    await rm(stateDirectory, { recursive: true, force: true });
  };
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      if (options.stopOnAbort !== false) void stop();
    }, { once: true });
  }
  return { stateDirectory, state, stop, reset };
}

export async function readLocalSupervisorStatus(stateDirectory: string): Promise<LocalSupervisorState | undefined> {
  return readSupervisorState(join(stateDirectory, 'state.json'));
}

export async function resetLocalSupervisor(
  stateDirectory: string,
  io: LocalSupervisorIo,
  driver: LocalSupervisorDriver = nodeLocalSupervisorDriver(io),
): Promise<void> {
  const lease = await readJson<LocalSupervisorLease>(join(stateDirectory, 'lease.json'));
  if (lease && processIsAlive(lease.pid)) {
    throw new Error(`Local supervisor reset refused: active lease ${lease.leaseId} is held by pid ${lease.pid}. Stop that process first.`);
  }
  const state = await readSupervisorState(join(stateDirectory, 'state.json'));
  if (state) {
    for (const resource of [...state.resources].reverse()) {
      await driver.stop(resource).catch((cause) => io.stderr(`Local stop warning for ${resource.resourceId}: ${errorMessage(cause)}`));
      await driver.remove(resource);
    }
  }
  await rm(stateDirectory, { recursive: true, force: true });
}

function supervisorState(
  plan: LocalSupervisorPlan,
  lease: LocalSupervisorLease,
  startedAt: string,
  bindings: Readonly<Record<string, string | number>>,
  resources: readonly LocalSupervisorDriverResource[],
): LocalSupervisorState {
  return {
    apiVersion: 'applik8s.localSupervisorState/v1alpha1',
    application: plan.application,
    target: plan.target,
    profile: plan.profile,
    projectDigest: plan.projectDigest,
    planDigest: digestLocalSupervisorPlan(plan),
    leaseId: lease.leaseId,
    startedAt,
    bindings,
    resources: [...resources],
  };
}

async function acquireLocalSupervisorLease(stateDirectory: string): Promise<LocalSupervisorLease> {
  const path = join(stateDirectory, 'lease.json');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lease: LocalSupervisorLease = {
      apiVersion: 'applik8s.localSupervisorLease/v1alpha1',
      pid: process.pid,
      leaseId: randomUUID(),
      acquiredAt: new Date().toISOString(),
    };
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`); } finally { await handle.close(); }
      return lease;
    } catch (cause) {
      if (!isFileExistsError(cause)) throw cause;
      const current = await readJson<LocalSupervisorLease>(path);
      if (current && processIsAlive(current.pid)) {
        throw new Error(`A local supervisor is already active under pid ${current.pid} (lease ${current.leaseId}).`);
      }
      await rm(path, { force: true });
    }
  }
  throw new Error('Could not acquire the local supervisor lease after removing stale ownership.');
}

async function releaseLocalSupervisorLease(stateDirectory: string, leaseId: string): Promise<void> {
  const path = join(stateDirectory, 'lease.json');
  const current = await readJson<LocalSupervisorLease>(path);
  if (!current) return;
  if (current.leaseId !== leaseId) throw new Error(`Local supervisor lease ${leaseId} was replaced by ${current.leaseId}; refusing to remove another owner.`);
  await rm(path, { force: true });
}

async function resolveSecretBindings(bindings: readonly LocalSupervisorBinding[], path: string): Promise<Record<string, string>> {
  const prior = await readJson<Record<string, string>>(path) ?? {};
  const next: Record<string, string> = {};
  for (const binding of bindings.filter(({ sensitivity, kind }) => sensitivity === 'sensitive' && kind === 'credential')) {
    const retained = prior[binding.id];
    next[binding.id] = typeof retained === 'string' && retained ? retained : randomBytes(32).toString('base64url');
  }
  await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}

async function writeCredentialBindings(
  path: string,
  plan: LocalSupervisorPlan,
  bindings: Readonly<Record<string, string | number>>,
): Promise<void> {
  const sensitive = Object.fromEntries(plan.bindings
    .filter(({ sensitivity }) => sensitivity === 'sensitive')
    .flatMap(({ id }) => typeof bindings[id] === 'string' ? [[id, bindings[id]]] : []));
  await writeFileAtomic(path, `${JSON.stringify(sensitive, null, 2)}\n`, 0o600);
}

async function resolvePublicBindings(plan: LocalSupervisorPlan, allocatePort: () => Promise<number>): Promise<Record<string, string | number>> {
  const result: Record<string, string | number> = {};
  const resources = new Map(plan.resources.map((resource) => [resource.id, resource]));
  for (const binding of plan.bindings.filter(({ sensitivity }) => sensitivity === 'public')) {
    if (binding.value !== undefined && !String(binding.value).startsWith('applik8s-local://')) {
      result[binding.id] = binding.value;
      continue;
    }
    if (binding.kind === 'port') {
      result[binding.id] = await allocatePort();
      continue;
    }
    if (binding.kind === 'endpoint') {
      const owner = resources.get(binding.owner);
      const portName = binding.id.split(':').at(-1);
      if (owner?.kind === 'container') {
        const port = owner.ports.find(({ name }) => name === portName) ?? owner.ports[0];
        if (!port) throw new Error(`Local endpoint ${binding.id} has no container port.`);
        const portBinding = `port:${binding.owner.replace(/^provider:/, '')}:${port.name}`;
        const hostPort = typeof result[portBinding] === 'number' ? result[portBinding] : await allocatePort();
        result[portBinding] = hostPort;
        const authority = `127.0.0.1:${hostPort}`;
        result[binding.id] = binding.format === 'authority'
          ? authority
          : `${port.protocol === 'http' ? 'http' : protocolForProvider(owner.image)}://${authority}`;
      } else {
        const portBinding = `port:${binding.owner.replace(/^process:/, '')}:${portName ?? 'http'}`;
        const hostPort = typeof result[portBinding] === 'number' ? result[portBinding] : await allocatePort();
        result[portBinding] = hostPort;
        result[binding.id] = `http://127.0.0.1:${hostPort}`;
      }
    }
    if (binding.kind === 'targetOutput') continue;
  }
  return result;
}

function containerPorts(resource: LocalSupervisorContainer, bindings: Readonly<Record<string, string | number>>): Record<string, number> {
  return Object.fromEntries(resource.ports.map((port) => {
    const id = `port:${resource.id.replace(/^provider:/, '')}:${port.name}`;
    const value = bindings[id];
    if (typeof value !== 'number') throw new Error(`Local container port ${id} was not allocated.`);
    return [port.name, value];
  }));
}

function resolveEnvironmentBinding(
  binding: string,
  values: Readonly<Record<string, string | number>>,
  runtime: 'process' | 'container',
  transform?: 'authority' | 'hostname' | 'port',
): string {
  if (binding.startsWith('literal:')) return binding.slice('literal:'.length);
  const value = values[binding];
  if (value === undefined) throw new Error(`Local environment binding ${binding} was not resolved.`);
  const serialized = String(value);
  if (transform === 'authority' || transform === 'hostname' || transform === 'port') {
    try {
      const url = new URL(serialized);
      const host = runtime === 'container' && isLoopbackHost(url.hostname) ? 'host.docker.internal' : url.hostname;
      return transform === 'hostname' ? host : transform === 'port' ? url.port : `${host}:${url.port}`;
    } catch {
      const [host, port] = serialized.split(':');
      const normalizedHost = runtime === 'container' && host && isLoopbackHost(host) ? 'host.docker.internal' : host;
      return transform === 'hostname' ? String(normalizedHost) : transform === 'port' ? String(port) : `${normalizedHost}:${port}`;
    }
  }
  if (runtime === 'container') {
    try {
      const url = new URL(serialized);
      if (isLoopbackHost(url.hostname)) url.hostname = 'host.docker.internal';
      return url.toString().replace(/\/$/u, '');
    } catch {
      return serialized;
    }
  }
  return serialized;
}

function resolveEnvironment(
  environment: LocalSupervisorEnvironment,
  values: Readonly<Record<string, string | number>>,
  runtime: 'process' | 'container',
): string {
  if ('binding' in environment) return resolveEnvironmentBinding(environment.binding, values, runtime);
  return environment.template.map((segment) => segment.kind === 'literal'
    ? segment.value
    : resolveEnvironmentBinding(segment.binding, values, runtime, segment.transform)).join('');
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function mergeResolvedBindings(
  plan: LocalSupervisorPlan,
  resource: LocalSupervisorResource,
  resolved: Readonly<Record<string, string | number>>,
  allBindings: Record<string, string | number>,
  publicBindings: Record<string, string | number>,
): void {
  for (const [bindingId, value] of Object.entries(resolved)) {
    const declaration = plan.bindings.find(({ id }) => id === bindingId);
    if (!declaration || declaration.owner !== resource.id) throw new Error(`Local target lifecycle resolved undeclared binding ${bindingId} for ${resource.id}.`);
    allBindings[bindingId] = value;
    if (declaration.sensitivity === 'public') publicBindings[bindingId] = value;
  }
}

function topologicalLocalResources(resources: readonly LocalSupervisorResource[]): readonly LocalSupervisorResource[] {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: LocalSupervisorResource[] = [];
  const visit = (resource: LocalSupervisorResource): void => {
    if (visited.has(resource.id)) return;
    if (visiting.has(resource.id)) throw new Error(`Local supervisor dependency cycle includes ${resource.id}.`);
    visiting.add(resource.id);
    for (const dependency of resource.dependsOn) {
      const target = byId.get(dependency);
      if (!target) throw new Error(`Local resource ${resource.id} depends on missing ${dependency}.`);
      visit(target);
    }
    visiting.delete(resource.id);
    visited.add(resource.id);
    ordered.push(resource);
  };
  for (const resource of [...resources].sort((left, right) => left.id.localeCompare(right.id))) visit(resource);
  return ordered;
}

function nodeLocalSupervisorDriver(io: LocalSupervisorIo): LocalSupervisorDriver {
  return {
    async startProcess(resource, environment) {
      const args = environment.PORT && resource.command === 'bun' && resource.args[0] === 'run'
        ? [...resource.args, '--port', environment.PORT]
        : [...resource.args];
      const child = spawn(resource.command, args, { cwd: resource.cwd, env: { ...process.env, ...environment }, stdio: 'inherit' });
      if (!child.pid) throw new Error(`Local process ${resource.id} failed to start.`);
      return { resourceId: resource.id, runtimeId: String(child.pid), kind: 'process', pid: child.pid };
    },
    async startContainer(resource, environment, ports, identity) {
      const name = `applik8s-${identity}`;
      await runCommand('docker', ['rm', '-f', name], io.cwd, true);
      const args = ['run', '--detach', '--name', name, '--label', `dev.applik8s.identity=${identity}`, '--add-host', 'host.docker.internal:host-gateway'];
      for (const port of resource.ports) args.push('--publish', `127.0.0.1:${ports[port.name]}:${port.containerPort}`);
      for (const [key, value] of Object.entries(environment)) args.push('--env', `${key}=${value}`);
      for (const volume of resource.volumes) args.push('--volume', `${volume.hostPath ?? `${name}-${volume.name}`}:${volume.mountPath}`);
      args.push(resource.image, ...(resource.command ?? []));
      const runtimeId = (await runCommand('docker', args, io.cwd)).trim();
      return { resourceId: resource.id, runtimeId: runtimeId || name, kind: 'container' };
    },
    async resolveBindings(resource, runtime) {
      const resolved: Record<string, string> = {};
      for (const output of resource.readyOutputs ?? []) {
        const value = (await runCommand('docker', ['exec', runtime.runtimeId, ...output.command], io.cwd)).trim();
        if (!value) throw new Error(`Local resource ${resource.id} returned an empty value for ${output.binding}.`);
        resolved[output.binding] = value;
      }
      return resolved;
    },
    async stop(resource) {
      if (resource.kind === 'process') {
        if (resource.pid && processIsAlive(resource.pid)) process.kill(resource.pid, 'SIGTERM');
        return;
      }
      await runCommand('docker', ['stop', '--time', '10', resource.runtimeId], io.cwd, true);
    },
    async remove(resource) {
      if (resource.kind === 'container') await runCommand('docker', ['rm', '-f', resource.runtimeId], io.cwd, true);
    },
    async waitHealthy(resource, bindings) {
      const deadline = Date.now() + resource.health.timeoutMs;
      let last: unknown;
      while (Date.now() < deadline) {
        try {
          if (resource.health.kind === 'process') return;
          const endpoint = resource.health.portBinding ? healthEndpoint(resource, bindings) : undefined;
          if (!endpoint) return;
          if (resource.health.kind === 'http') {
            const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) return;
            last = new Error(`HTTP ${response.status}`);
          } else if (resource.health.kind === 'tcp') {
            await connectTcp(endpoint);
            return;
          }
        } catch (cause) { last = cause; }
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      }
      throw new Error(`Local resource ${resource.id} did not become healthy within ${resource.health.timeoutMs}ms: ${errorMessage(last)}`);
    },
  };
}

function healthEndpoint(resource: LocalSupervisorResource, bindings: Readonly<Record<string, string | number>>): string | undefined {
  const value = resource.health.portBinding ? bindings[resource.health.portBinding] : undefined;
  if (typeof value === 'number') return resource.health.kind === 'http' ? `http://127.0.0.1:${value}${resource.health.path ?? '/'}` : `127.0.0.1:${value}`;
  if (typeof value !== 'string') return undefined;
  if (resource.health.kind === 'http') return `${value.replace(/\/$/, '')}${resource.health.path ?? '/'}`;
  try { const url = new URL(value); return `${url.hostname}:${url.port}`; } catch { return value; }
}

async function connectTcp(endpoint: string): Promise<void> {
  const [host, portText] = endpoint.split(':');
  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid local TCP health endpoint ${endpoint}.`);
  }
  await new Promise<void>((resolveConnection, reject) => {
    const socket = new Socket();
    socket.setTimeout(1_000);
    socket.once('connect', () => { socket.destroy(); resolveConnection(); });
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TCP health timeout')); });
    socket.connect(port, host);
  });
}

async function availablePort(): Promise<number> {
  const server: TcpServer = createTcpServer();
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListening());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise<void>((resolveClose, reject) => server.close((cause) => cause ? reject(cause) : resolveClose()));
  if (!port) throw new Error('Local port broker did not allocate a TCP port.');
  return port;
}

async function stopRecordedResources(resources: readonly LocalSupervisorDriverResource[], driver: LocalSupervisorDriver, io: LocalSupervisorIo): Promise<void> {
  for (const resource of [...resources].reverse()) {
    await driver.stop(resource).catch((cause) => io.stderr(`Local stop warning for ${resource.resourceId}: ${errorMessage(cause)}`));
  }
}

async function readSupervisorState(path: string): Promise<LocalSupervisorState | undefined> {
  const state = await readJson<LocalSupervisorState>(path);
  return state?.apiVersion === 'applik8s.localSupervisorState/v1alpha1' ? state : undefined;
}

async function writeSupervisorState(path: string, state: LocalSupervisorState): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

async function writeFileAtomic(path: string, content: string, mode: number): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  if (!await access(path).then(() => true).catch(() => false)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function runCommand(command: string, args: readonly string[], cwd: string, ignoreFailure = false): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || ignoreFailure) resolveOutput(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`${command} ${args.join(' ')} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
    });
  });
}

function localRuntimeIdentity(plan: LocalSupervisorPlan, resourceId: string): string {
  return createHash('sha256').update(`${plan.application}\0${plan.target}\0${plan.projectDigest}\0${resourceId}`).digest('hex').slice(0, 20);
}

function protocolForProvider(image: string): string {
  if (image.includes('postgres')) return 'postgres';
  if (image.includes('valkey')) return 'redis';
  if (image.includes('nats')) return 'nats';
  return 'tcp';
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function safePathSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function isFileExistsError(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && Reflect.get(cause, 'code') === 'EEXIST';
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
