// typecast-file-boundary: Persisted supervisor records and driver output are validated at this process boundary.

import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer, Socket, type Server as TcpServer } from 'node:net';
import { join, resolve } from 'node:path';
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
  readonly volumes?: readonly { readonly id: string; readonly retained: boolean }[];
}

export interface LocalSupervisorDriver {
  startProcess(resource: LocalSupervisorProcess, environment: Readonly<Record<string, string>>): Promise<LocalSupervisorDriverResource>;
  startContainer(resource: LocalSupervisorContainer, environment: Readonly<Record<string, string>>, ports: Readonly<Record<string, number>>, identity: string): Promise<LocalSupervisorDriverResource>;
  stop(resource: LocalSupervisorDriverResource): Promise<void>;
  remove(resource: LocalSupervisorDriverResource, options?: { readonly removeRetainedVolumes?: boolean }): Promise<void>;
  waitHealthy(resource: LocalSupervisorResource, bindings: Readonly<Record<string, string | number>>): Promise<void>;
  /** Resolves declared post-readiness outputs without exposing them through logs. */
  resolveBindings?(resource: LocalSupervisorContainer, runtime: LocalSupervisorDriverResource): Promise<Readonly<Record<string, string | number>>>;
  /** Resolves when a supervised runtime exits for any reason. */
  waitForExit?(resource: LocalSupervisorDriverResource): Promise<void>;
}

export interface LocalSupervisorOptions {
  readonly stateRoot?: string;
  readonly driver?: LocalSupervisorDriver;
  readonly signal?: AbortSignal;
  readonly stopOnAbort?: boolean;
  readonly allocatePort?: () => Promise<number>;
  readonly lifecycle?: LocalSupervisorLifecycle;
  /**
   * Operation-host environment used only to resolve explicitly declared
   * hostEnvironment bindings and the minimal child toolchain environment.
   * Defaults to process.env; undeclared names are never forwarded.
   */
  readonly hostEnvironment?: Readonly<Record<string, string | undefined>>;
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
  /** Resolves only when bounded automatic recovery is exhausted. */
  readonly failed: Promise<Error>;
  /** Restarts process resources in the selected reload groups without churning providers. */
  reload(reloadGroups?: readonly string[]): Promise<LocalSupervisorState>;
  /** Reconciles a newly compiled plan under the existing lease and retained bindings. */
  reconcile(plan: LocalSupervisorPlan): Promise<LocalSupervisorState>;
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
  let activePlan = plan;
  const hostEnvironment = options.hostEnvironment ?? process.env;
  const hostEnvironmentValues = resolveHostEnvironmentBindings(plan, hostEnvironment);
  const stateDirectory = options.stateRoot
    ?? resolve(io.cwd, '.applik8s', 'local', plan.target, safePathSegment(plan.projectDigest));
  await mkdir(stateDirectory, { recursive: true });
  const lease = await acquireLocalSupervisorLease(stateDirectory);
  const driver = options.driver ?? nodeLocalSupervisorDriver(io, hostEnvironment);
  const statePath = join(stateDirectory, 'state.json');
  const secretsPath = join(stateDirectory, 'credentials.json');
  const prior = await readSupervisorState(statePath);
  if (prior) await stopRecordedResources(prior.resources, driver, io);

  const secretValues = await resolveSecretBindings(plan.bindings, secretsPath);
  const allocatePort = options.allocatePort ?? availablePort;
  const publicBindings = await resolvePublicBindings(plan, allocatePort, prior?.bindings);
  const allBindings: Record<string, string | number> = { ...publicBindings, ...secretValues, ...hostEnvironmentValues };
  const runtimeByResourceId = new Map<string, LocalSupervisorDriverResource>();
  const generationByResourceId = new Map<string, number>();
  const startedAt = new Date().toISOString();
  let stopped = false;
  let operation = Promise.resolve();
  let failSession!: (error: Error) => void;
  const failed = new Promise<Error>((resolveFailure) => { failSession = resolveFailure; });

  const currentRecords = (): LocalSupervisorDriverResource[] => topologicalLocalResources(activePlan.resources)
    .flatMap((resource) => {
      const runtime = runtimeByResourceId.get(resource.id);
      return runtime ? [runtime] : [];
    });
  const writeCurrentState = async (): Promise<LocalSupervisorState> => {
    const next = supervisorState(activePlan, lease, startedAt, publicBindings, currentRecords());
    await writeSupervisorState(statePath, next);
    return next;
  };
  const startResource = async (resource: LocalSupervisorResource): Promise<LocalSupervisorDriverResource | undefined> => {
    if (resource.kind === 'external') return undefined;
    const environment = {
      ...Object.fromEntries(resource.environment.map((entry) => [entry.name, resolveEnvironment(entry, allBindings, resource.kind)])),
      ...(resource.kind === 'process' ? {
        APPLIK8S_APPLICATION_NAME: activePlan.application,
        APPLIK8S_DEPLOYMENT_TARGET: activePlan.target,
        APPLIK8S_ENVIRONMENT_ID: `${activePlan.target}:${activePlan.profile}`,
        APPLIK8S_LOCAL_STATE_DIRECTORY: stateDirectory,
        APPLIK8S_SCHEDULE_STATE_PATH: join(stateDirectory, 'schedules.json'),
      } : {}),
    };
    const record = resource.kind === 'process'
      ? await driver.startProcess(resource, environment)
      : await driver.startContainer(resource, environment, containerPorts(resource, publicBindings), localRuntimeIdentity(activePlan, resource.id));
    runtimeByResourceId.set(resource.id, record);
    try {
      await driver.waitHealthy(resource, publicBindings);
      const driverBindings = resource.kind === 'container'
        ? await driver.resolveBindings?.(resource, record)
        : undefined;
      if (driverBindings) mergeResolvedBindings(activePlan, resource, driverBindings, allBindings, publicBindings);
      const resolved = await options.lifecycle?.resourceReady?.(resource, {
        stateDirectory,
        bindings: allBindings,
      });
      if (resolved) mergeResolvedBindings(activePlan, resource, resolved, allBindings, publicBindings);
      await writeCredentialBindings(secretsPath, activePlan, allBindings);
      await writeCurrentState();
      io.stdout(`Local ${resource.kind} ready: ${resource.id}`);
      return record;
    } catch (cause) {
      runtimeByResourceId.delete(resource.id);
      await driver.stop(record).catch((stopCause) => io.stderr(`Local failed-start cleanup warning for ${resource.id}: ${errorMessage(stopCause)}`));
      throw cause;
    }
  };
  const monitor = (resource: LocalSupervisorResource, record: LocalSupervisorDriverResource): void => {
    if (!driver.waitForExit) return;
    const generation = generationByResourceId.get(resource.id) ?? 0;
    void driver.waitForExit(record).then(() => {
      operation = operation.then(async () => {
        if (stopped || generationByResourceId.get(resource.id) !== generation) return;
        if (runtimeByResourceId.get(resource.id)?.runtimeId !== record.runtimeId) return;
        runtimeByResourceId.delete(resource.id);
        await writeCurrentState();
        let last: unknown;
        for (let attempt = 1; attempt <= 5 && !stopped; attempt += 1) {
          try {
            if (attempt > 1) await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(2_000, 100 * (2 ** (attempt - 2)))));
            const restarted = await startResource(resource);
            if (restarted) {
              state = await writeCurrentState();
              io.stderr(`Local ${resource.kind} ${resource.id} exited unexpectedly and recovered on attempt ${attempt}.`);
              monitor(resource, restarted);
            }
            return;
          } catch (cause) {
            last = cause;
            io.stderr(`Local recovery attempt ${attempt}/5 failed for ${resource.id}: ${errorMessage(cause)}`);
          }
        }
        if (!stopped) failSession(new Error(`Local resource ${resource.id} exhausted automatic recovery: ${errorMessage(last)}`));
      }).catch((cause) => {
        if (!stopped) failSession(cause instanceof Error ? cause : new Error(String(cause)));
      });
    }).catch((cause) => {
      if (!stopped) failSession(new Error(`Local runtime monitor failed for ${resource.id}: ${errorMessage(cause)}`));
    });
  };
  try {
    for (const resource of topologicalLocalResources(activePlan.resources)) {
      generationByResourceId.set(resource.id, 0);
      await startResource(resource);
    }
  } catch (cause) {
    await stopRecordedResources(currentRecords(), driver, io);
    await releaseLocalSupervisorLease(stateDirectory, lease.leaseId);
    throw cause;
  }

  let state = await writeCurrentState();
  for (const resource of topologicalLocalResources(activePlan.resources)) {
    const record = runtimeByResourceId.get(resource.id);
    if (record) monitor(resource, record);
  }
  const reload = async (reloadGroups?: readonly string[]): Promise<LocalSupervisorState> => {
    if (stopped) throw new Error('Cannot reload a stopped local supervisor.');
    const selected = topologicalLocalResources(activePlan.resources).filter((resource): resource is LocalSupervisorProcess =>
      resource.kind === 'process' && (!reloadGroups || reloadGroups.includes(resource.reloadGroup)));
    if (selected.length === 0) return state;
    operation = operation.then(async () => {
      for (const resource of [...selected].reverse()) {
        generationByResourceId.set(resource.id, (generationByResourceId.get(resource.id) ?? 0) + 1);
        const current = runtimeByResourceId.get(resource.id);
        if (current) await driver.stop(current);
        runtimeByResourceId.delete(resource.id);
      }
      for (const resource of selected) {
        const record = await startResource(resource);
        if (record) monitor(resource, record);
      }
      state = await writeCurrentState();
      io.stdout(`Reloaded local groups: ${[...new Set(selected.map(({ reloadGroup }) => reloadGroup))].join(', ')}`);
    });
    try {
      await operation;
    } catch (cause) {
      operation = Promise.resolve();
      throw cause;
    }
    return state;
  };
  const reconcile = async (nextPlan: LocalSupervisorPlan): Promise<LocalSupervisorState> => {
    if (stopped) throw new Error('Cannot reconcile a stopped local supervisor.');
    const nextValidation = validateLocalSupervisorPlan(nextPlan);
    if (!nextValidation.valid) {
      throw new Error(nextValidation.diagnostics.map(({ code, message }) => `${code}: ${message}`).join('\n'));
    }
    if (nextPlan.application !== activePlan.application
      || nextPlan.target !== activePlan.target
      || nextPlan.profile !== activePlan.profile
      || nextPlan.projectDigest !== activePlan.projectDigest) {
      throw new Error('Local supervisor reconciliation cannot change application, target, profile, or project identity under an active lease.');
    }
    operation = operation.then(async () => {
      const previousPlan = activePlan;
      const previousBindings = { ...allBindings };
      const previousPublicBindings = { ...publicBindings };
      const nextSecrets = await resolveSecretBindings(nextPlan.bindings, secretsPath);
      const nextPublicBindings = await resolvePublicBindings(nextPlan, allocatePort, publicBindings);
      const nextHostEnvironment = resolveHostEnvironmentBindings(nextPlan, hostEnvironment);
      const nextBindings: Record<string, string | number> = {
        ...nextPublicBindings,
        ...nextSecrets,
        ...nextHostEnvironment,
      };
      for (const binding of nextPlan.bindings.filter(({ kind }) => kind === 'targetOutput')) {
        const retained = allBindings[binding.id];
        if (retained !== undefined) nextBindings[binding.id] = retained;
      }
      const affected = affectedLocalResources(previousPlan, nextPlan, previousBindings, nextBindings);
      const previousResources = new Map(previousPlan.resources.map((resource) => [resource.id, resource]));
      const nextResources = new Map(nextPlan.resources.map((resource) => [resource.id, resource]));
      const stopAffected = async (planToStop: LocalSupervisorPlan): Promise<void> => {
        for (const resource of [...topologicalLocalResources(planToStop.resources)].reverse()) {
          if (!affected.has(resource.id)) continue;
          generationByResourceId.set(resource.id, (generationByResourceId.get(resource.id) ?? 0) + 1);
          const runtime = runtimeByResourceId.get(resource.id);
          if (!runtime) continue;
          await driver.stop(runtime);
          await driver.remove(runtime, { removeRetainedVolumes: !nextResources.has(resource.id) });
          runtimeByResourceId.delete(resource.id);
        }
      };
      const startAffected = async (planToStart: LocalSupervisorPlan): Promise<void> => {
        for (const resource of topologicalLocalResources(planToStart.resources)) {
          if (!affected.has(resource.id) || resource.kind === 'external') continue;
          const record = await startResource(resource);
          if (record) monitor(resource, record);
        }
      };
      await stopAffected(previousPlan);
      activePlan = nextPlan;
      replaceBindingValues(allBindings, nextBindings);
      replaceBindingValues(publicBindings, nextPublicBindings);
      for (const resourceId of nextResources.keys()) {
        if (!generationByResourceId.has(resourceId)) generationByResourceId.set(resourceId, 0);
      }
      try {
        await startAffected(nextPlan);
        state = await writeCurrentState();
        io.stdout(`Reconciled local supervisor plan (${affected.size} affected resource${affected.size === 1 ? '' : 's'}).`);
      } catch (cause) {
        await stopAffected(nextPlan).catch((cleanupCause) => io.stderr(`Local reconcile cleanup warning: ${errorMessage(cleanupCause)}`));
        activePlan = previousPlan;
        replaceBindingValues(allBindings, previousBindings);
        replaceBindingValues(publicBindings, previousPublicBindings);
        try {
          await startAffected(previousPlan);
          state = await writeCurrentState();
          await writeCredentialBindings(secretsPath, previousPlan, allBindings);
          throw new Error(`Local plan reconciliation failed and the previous healthy plan was restored: ${errorMessage(cause)}`);
        } catch (rollbackCause) {
          if (rollbackCause instanceof Error && rollbackCause.message.startsWith('Local plan reconciliation failed and')) throw rollbackCause;
          const failure = new Error(`Local plan reconciliation failed and rollback could not restore the previous plan: ${errorMessage(cause)}; rollback: ${errorMessage(rollbackCause)}`);
          failSession(failure);
          throw failure;
        }
      }
      for (const resourceId of previousResources.keys()) {
        if (!nextResources.has(resourceId)) generationByResourceId.delete(resourceId);
      }
    });
    try {
      await operation;
    } catch (cause) {
      operation = Promise.resolve();
      throw cause;
    }
    return state;
  };
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await operation.catch(() => undefined);
    await stopRecordedResources(currentRecords(), driver, io);
    await releaseLocalSupervisorLease(stateDirectory, lease.leaseId);
  };
  const reset = async (): Promise<void> => {
    await options.lifecycle?.beforeReset?.({ stateDirectory, bindings: allBindings });
    await stop();
    for (const resource of [...currentRecords()].reverse()) await driver.remove(resource, { removeRetainedVolumes: true }).catch((cause) => io.stderr(`Local cleanup warning for ${resource.resourceId}: ${errorMessage(cause)}`));
    await rm(stateDirectory, { recursive: true, force: true });
  };
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      if (options.stopOnAbort !== false) void stop();
    }, { once: true });
  }
  return { stateDirectory, get state() { return state; }, failed, reload, reconcile, stop, reset };
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
      await driver.remove(resource, { removeRetainedVolumes: true });
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

function resolveHostEnvironmentBindings(
  plan: LocalSupervisorPlan,
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const referenced = new Set(plan.resources.flatMap((resource) =>
    resource.kind === 'external'
      ? []
      : resource.environment.flatMap((entry) => 'binding' in entry
        ? [entry.binding]
        : entry.template.flatMap((segment) => segment.kind === 'binding' ? [segment.binding] : []))));
  for (const binding of plan.bindings.filter(({ kind, id }) => kind === 'hostEnvironment' && referenced.has(id))) {
    const source = binding.sourceEnvironment;
    const raw = source ? environment[source] : undefined;
    let value = raw;
    if (typeof raw === 'string' && binding.sourceProperty) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const candidate = parsed && typeof parsed === 'object'
          ? Reflect.get(parsed, binding.sourceProperty)
          : undefined;
        value = typeof candidate === 'string' ? candidate : undefined;
      } catch {
        value = undefined;
      }
    }
    if (!source || typeof value !== 'string' || value.length === 0) {
      throw new Error(`Required host environment variable ${source ?? '<invalid>'} for local binding ${binding.id} is unavailable.`);
    }
    resolved[binding.id] = value;
  }
  return resolved;
}

async function writeCredentialBindings(
  path: string,
  plan: LocalSupervisorPlan,
  bindings: Readonly<Record<string, string | number>>,
): Promise<void> {
  const sensitive = Object.fromEntries(plan.bindings
    .filter(({ sensitivity, kind }) => sensitivity === 'sensitive' && kind !== 'hostEnvironment')
    .flatMap(({ id }) => typeof bindings[id] === 'string' ? [[id, bindings[id]]] : []));
  await writeFileAtomic(path, `${JSON.stringify(sensitive, null, 2)}\n`, 0o600);
}

async function resolvePublicBindings(
  plan: LocalSupervisorPlan,
  allocatePort: () => Promise<number>,
  prior: Readonly<Record<string, string | number>> = {},
): Promise<Record<string, string | number>> {
  const result: Record<string, string | number> = {};
  const resources = new Map(plan.resources.map((resource) => [resource.id, resource]));
  for (const binding of plan.bindings.filter(({ sensitivity }) => sensitivity === 'public')) {
    if (binding.value !== undefined && !String(binding.value).startsWith('applik8s-local://')) {
      result[binding.id] = binding.value;
      continue;
    }
    if (binding.kind === 'port') {
      const retainedPort = prior[binding.id];
      result[binding.id] = typeof retainedPort === 'number' ? retainedPort : await allocatePort();
      continue;
    }
    if (binding.kind === 'endpoint') {
      const owner = resources.get(binding.owner);
      const portName = binding.id.split(':').at(-1);
      if (owner?.kind === 'container') {
        const port = owner.ports.find(({ name }) => name === portName) ?? owner.ports[0];
        if (!port) throw new Error(`Local endpoint ${binding.id} has no container port.`);
        const portBinding = `port:${binding.owner.replace(/^provider:/, '')}:${port.name}`;
        const hostPort = typeof result[portBinding] === 'number'
          ? result[portBinding]
          : typeof prior[portBinding] === 'number'
            ? prior[portBinding]
            : await allocatePort();
        result[portBinding] = hostPort;
        const authority = `127.0.0.1:${hostPort}`;
        result[binding.id] = binding.format === 'authority'
          ? authority
          : `${port.protocol === 'http' ? 'http' : protocolForProvider(owner.image)}://${authority}`;
      } else {
        const portBinding = `port:${binding.owner.replace(/^process:/, '')}:${portName ?? 'http'}`;
        const hostPort = typeof result[portBinding] === 'number'
          ? result[portBinding]
          : typeof prior[portBinding] === 'number'
            ? prior[portBinding]
            : await allocatePort();
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
  transform?: 'authority' | 'hostname' | 'port' | 'uriComponent',
): string {
  if (binding.startsWith('literal:')) return binding.slice('literal:'.length);
  const value = values[binding];
  if (value === undefined) throw new Error(`Local environment binding ${binding} was not resolved.`);
  const serialized = String(value);
  if (transform === 'uriComponent') return encodeURIComponent(serialized);
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

function affectedLocalResources(
  previous: LocalSupervisorPlan,
  next: LocalSupervisorPlan,
  previousBindings: Readonly<Record<string, string | number>>,
  nextBindings: Readonly<Record<string, string | number>>,
): Set<string> {
  const affected = new Set<string>();
  const previousResources = new Map(previous.resources.map((resource) => [resource.id, resource]));
  const nextResources = new Map(next.resources.map((resource) => [resource.id, resource]));
  for (const resourceId of new Set([...previousResources.keys(), ...nextResources.keys()])) {
    if (canonicalLocalValue(previousResources.get(resourceId)) !== canonicalLocalValue(nextResources.get(resourceId))) affected.add(resourceId);
  }
  const previousBindingDeclarations = new Map(previous.bindings.map((binding) => [binding.id, binding]));
  const nextBindingDeclarations = new Map(next.bindings.map((binding) => [binding.id, binding]));
  const changedBindings = new Set<string>();
  for (const bindingId of new Set([...previousBindingDeclarations.keys(), ...nextBindingDeclarations.keys()])) {
    if (canonicalLocalValue(previousBindingDeclarations.get(bindingId)) !== canonicalLocalValue(nextBindingDeclarations.get(bindingId))
      || previousBindings[bindingId] !== nextBindings[bindingId]) changedBindings.add(bindingId);
  }
  for (const resource of [...previous.resources, ...next.resources]) {
    if (resource.kind === 'external') continue;
    const consumed = resource.environment.flatMap((environment) => 'binding' in environment
      ? [environment.binding]
      : environment.template.flatMap((segment) => segment.kind === 'binding' ? [segment.binding] : []));
    if (consumed.some((binding) => changedBindings.has(binding))) affected.add(resource.id);
  }
  let widened = true;
  while (widened) {
    widened = false;
    for (const resource of [...previous.resources, ...next.resources]) {
      if (!affected.has(resource.id) && resource.dependsOn.some((dependency) => affected.has(dependency))) {
        affected.add(resource.id);
        widened = true;
      }
    }
  }
  return affected;
}

function replaceBindingValues(
  target: Record<string, string | number>,
  source: Readonly<Record<string, string | number>>,
): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function canonicalLocalValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLocalValue).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalLocalValue(entry)}`)
    .join(',')}}`;
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

function nodeLocalSupervisorDriver(
  io: LocalSupervisorIo,
  hostEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): LocalSupervisorDriver {
  const processExits = new Map<string, Promise<void>>();
  return {
    async startProcess(resource, environment) {
      const args = environment.PORT && resource.command === 'bun' && resource.args[0] === 'run'
        ? [...resource.args, '--port', environment.PORT]
        : [...resource.args];
      const child = spawn(resource.command, args, {
        cwd: resource.cwd,
        env: { ...localProcessToolchainEnvironment(hostEnvironment), ...environment },
        stdio: 'inherit',
      });
      if (!child.pid) throw new Error(`Local process ${resource.id} failed to start.`);
      const runtimeId = String(child.pid);
      processExits.set(runtimeId, new Promise<void>((resolveExit) => {
        child.once('exit', () => {
          processExits.delete(runtimeId);
          resolveExit();
        });
      }));
      return { resourceId: resource.id, runtimeId, kind: 'process', pid: child.pid };
    },
    async startContainer(resource, environment, ports, identity) {
      const name = `applik8s-${identity}`;
      await runCommand('docker', ['rm', '-f', name], io.cwd, true);
      const args = ['run', '--detach', '--name', name, '--label', `dev.applik8s.identity=${identity}`, '--add-host', 'host.docker.internal:host-gateway'];
      for (const port of resource.ports) args.push('--publish', `127.0.0.1:${ports[port.name]}:${port.containerPort}`);
      for (const [key, value] of Object.entries(environment)) args.push('--env', `${key}=${value}`);
      const volumes = resource.volumes.flatMap((volume) => volume.hostPath
        ? []
        : [{ id: `${name}-${volume.name}`, retained: volume.retained }]);
      for (const volume of resource.volumes) args.push('--volume', `${volume.hostPath ?? `${name}-${volume.name}`}:${volume.mountPath}`);
      args.push(resource.image, ...(resource.command ?? []));
      const runtimeId = (await runCommand('docker', args, io.cwd)).trim();
      return { resourceId: resource.id, runtimeId: runtimeId || name, kind: 'container', ...(volumes.length > 0 ? { volumes } : {}) };
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
        if (resource.pid && processIsAlive(resource.pid)) {
          process.kill(resource.pid, 'SIGTERM');
          const exit = processExits.get(resource.runtimeId);
          if (exit) {
            const completed = await Promise.race([
              exit.then(() => true),
              new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
            ]);
            if (!completed && processIsAlive(resource.pid)) {
              process.kill(resource.pid, 'SIGKILL');
              await processExits.get(resource.runtimeId);
            }
          } else {
            const deadline = Date.now() + 5_000;
            while (processIsAlive(resource.pid) && Date.now() < deadline) {
              await new Promise((resolveWait) => setTimeout(resolveWait, 25));
            }
            if (processIsAlive(resource.pid)) process.kill(resource.pid, 'SIGKILL');
          }
        }
        return;
      }
      await runCommand('docker', ['stop', '--time', '10', resource.runtimeId], io.cwd, true);
    },
    async remove(resource, options) {
      if (resource.kind !== 'container') return;
      await runCommand('docker', ['rm', '-f', resource.runtimeId], io.cwd, true);
      for (const volume of resource.volumes ?? []) {
        if (volume.retained && !options?.removeRetainedVolumes) continue;
        await runCommand('docker', ['volume', 'rm', '-f', volume.id], io.cwd, true);
      }
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
    async waitForExit(resource) {
      if (resource.kind === 'process') {
        await processExits.get(resource.runtimeId);
        return;
      }
      await runCommand('docker', ['wait', resource.runtimeId], io.cwd, true);
    },
  };
}

const localProcessToolchainEnvironmentNames = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
] as const;

function localProcessToolchainEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(localProcessToolchainEnvironmentNames.flatMap((name) => {
    const value = environment[name];
    return typeof value === 'string' ? [[name, value]] : [];
  }));
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
