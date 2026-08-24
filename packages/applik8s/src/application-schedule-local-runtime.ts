// typecast-file-boundary: Persisted schedule admissions are decoded and validated at this local-runtime boundary.

import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  type CanonicalJsonV1Policy,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';
import {
  type ApplicationFixedScheduleHandle,
  type ApplicationScheduleAdmissionRunner,
  type ApplicationScheduleRuntimeSnapshot,
  createDeterministicApplicationScheduleRuntime,
  installApplicationScheduleRuntimeResolver,
  registerFixedApplicationSchedule,
} from './application-schedule.js';

export interface LocalApplicationScheduleRuntimeSession {
  readonly runtime: ReturnType<typeof createDeterministicApplicationScheduleRuntime>;
  stop(): Promise<void>;
}

/**
 * Named Canonical JSON policy for the durable local scheduler files. This
 * preserves the v1alpha1 writer's historical JSON-compatible handling of
 * optional object fields while moving byte ownership to Runtime Integrity.
 */
export const localApplicationScheduleCanonicalJsonPolicy: CanonicalJsonV1Policy = Object.freeze({
  ...canonicalJsonCompatibleV1Policy,
  name: 'application-schedule-local-persistence',
});

/**
 * Installs the maintained durable local Scheduler provider for exported fixed
 * schedules. Dynamic definitions bind through their ordinary `.schedule()`
 * calls and share the same runtime authority.
 */
export async function installLocalApplicationScheduleRuntime(options: {
  readonly applicationId: string;
  /** Exact provider graph identity owned by this runtime. */
  readonly schedulerNodeId?: string;
  readonly environmentId?: string;
  readonly schedules: readonly ApplicationFixedScheduleHandle<unknown>[];
  readonly statePath?: string;
  readonly tickIntervalMs?: number;
  readonly now?: () => Date;
  readonly onError?: (error: unknown) => void;
  readonly admissionRunner?: ApplicationScheduleAdmissionRunner;
}): Promise<LocalApplicationScheduleRuntimeSession> {
  const environmentId = options.environmentId ?? 'local';
  const statePath = resolve(options.statePath ?? process.env.APPLIK8S_SCHEDULE_STATE_PATH ?? '.applik8s/local/schedules.json');
  const lease = await acquireScheduleLease({ path: `${statePath}.lock`, applicationId: options.applicationId, environmentId });
  let store: Awaited<ReturnType<typeof openScheduleStore>>;
  try {
    store = await openScheduleStore({ path: statePath, applicationId: options.applicationId, environmentId });
  } catch (error) {
    await lease.release();
    throw error;
  }
  const now = options.now ?? (() => new Date());
  const runtime = createDeterministicApplicationScheduleRuntime({
    applicationId: options.applicationId,
    environmentId,
    now,
    ...(store.snapshot ? { snapshot: store.snapshot } : {}),
    persist: store.persist,
    ...(options.admissionRunner ? { admissionRunner: options.admissionRunner } : {}),
  });
  const schedulerNodeId = options.schedulerNodeId ?? 'provider.scheduler';
  const disposeResolver = installApplicationScheduleRuntimeResolver(
    (requestedSchedulerNodeId) => requestedSchedulerNodeId === schedulerNodeId
      ? runtime
      : undefined,
  );
  try {
    for (const schedule of [...options.schedules].sort((left, right) => left.definition.id.localeCompare(right.definition.id))) {
      await registerFixedApplicationSchedule(runtime, schedule);
    }
  } catch (error) {
    disposeResolver();
    await lease.release();
    throw error;
  }
  let stopped = false;
  let active: Promise<unknown> | undefined;
  const tick = (): void => {
    if (stopped || active) return;
    active = runtime.tick(now()).catch((error) => options.onError?.(error)).finally(() => { active = undefined; });
  };
  tick();
  const timer = setInterval(tick, options.tickIntervalMs ?? 1_000);
  timer.unref?.();
  return {
    runtime,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await active;
      disposeResolver();
      await lease.release();
    },
  };
}

interface LocalScheduleLeaseRecord {
  readonly schemaVersion: 'applik8s.scheduleLease/v1alpha1';
  readonly applicationId: string;
  readonly environmentId: string;
  readonly ownerPid: number;
  readonly token: string;
  readonly acquiredAt: string;
}

async function acquireScheduleLease(options: {
  readonly path: string;
  readonly applicationId: string;
  readonly environmentId: string;
}): Promise<{ release(): Promise<void> }> {
  await mkdir(dirname(options.path), { recursive: true });
  const record: LocalScheduleLeaseRecord = {
    schemaVersion: 'applik8s.scheduleLease/v1alpha1',
    applicationId: options.applicationId,
    environmentId: options.environmentId,
    ownerPid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(options.path, 'wx', 0o600);
      try {
        await handle.writeFile(`${canonicalScheduleJson(record)}\n`, { encoding: 'utf8' });
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        async release() {
          const current = await readLease(options.path);
          if (!current || current.token !== record.token) {
            throw new Error(`Local schedule lease ${options.path} is no longer owned by this runtime.`);
          }
          await unlink(options.path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readLease(options.path);
      if (!current) continue;
      if (processIsAlive(current.ownerPid)) {
        throw new Error(
          `Local Scheduler authority for ${options.applicationId}/${options.environmentId} is already held by process ${current.ownerPid}. Stop that runtime before starting another one.`,
        );
      }
      const stillCurrent = await readLease(options.path);
      if (stillCurrent?.token === current.token) {
        await unlink(options.path).catch((unlinkError: NodeJS.ErrnoException) => {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        });
      }
    }
  }
  throw new Error(`Local Scheduler authority for ${options.applicationId}/${options.environmentId} could not acquire its lease.`);
}

async function readLease(path: string): Promise<LocalScheduleLeaseRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as LocalScheduleLeaseRecord;
    if (value.schemaVersion !== 'applik8s.scheduleLease/v1alpha1'
      || !Number.isSafeInteger(value.ownerPid)
      || value.ownerPid < 1
      || typeof value.token !== 'string'
      || !value.token) {
      throw new Error(`Local schedule lease ${path} is malformed and must be inspected before recovery.`);
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function openScheduleStore(options: {
  readonly path: string;
  readonly applicationId: string;
  readonly environmentId: string;
}): Promise<{
  readonly snapshot?: ApplicationScheduleRuntimeSnapshot;
  persist(snapshot: ApplicationScheduleRuntimeSnapshot): Promise<void>;
}> {
  const initial = await readSnapshot(options.path);
  if (initial && (initial.applicationId !== options.applicationId || initial.environmentId !== options.environmentId)) {
    throw new Error(`Local schedule state ${options.path} belongs to another application or environment.`);
  }
  let revision = initial?.revision ?? 0;
  let serialized = initial ? canonicalScheduleJson(initial) : undefined;
  return {
    ...(initial ? { snapshot: initial } : {}),
    async persist(snapshot) {
      validateSnapshot(snapshot, options);
      const next = canonicalScheduleJson(snapshot);
      if (snapshot.revision < revision) throw new Error(`Local schedule state revision ${snapshot.revision} is stale; persisted revision is ${revision}.`);
      if (snapshot.revision === revision) {
        if (next !== serialized) throw new Error(`Local schedule state revision ${revision} conflicts with different content.`);
        return;
      }
      await writeAtomic(options.path, `${next}\n`);
      revision = snapshot.revision;
      serialized = next;
    },
  };
}

async function readSnapshot(path: string): Promise<ApplicationScheduleRuntimeSnapshot | undefined> {
  if (!await access(path).then(() => true).catch(() => false)) return undefined;
  const value = JSON.parse(await readFile(path, 'utf8')) as ApplicationScheduleRuntimeSnapshot;
  validateSnapshot(value);
  return value;
}

function validateSnapshot(
  value: ApplicationScheduleRuntimeSnapshot,
  expected?: { readonly applicationId: string; readonly environmentId: string },
): void {
  if (value.schemaVersion !== 'applik8s.scheduleRuntime/v1alpha1' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.instances) || !Array.isArray(value.occurrences)) {
    throw new Error('Local schedule state is not a valid v1alpha1 runtime snapshot.');
  }
  if (expected && (value.applicationId !== expected.applicationId || value.environmentId !== expected.environmentId)) {
    throw new Error('Local schedule state attempted to cross its application/environment boundary.');
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function canonicalScheduleJson(value: unknown): string {
  return canonicalJsonV1String(value, localApplicationScheduleCanonicalJsonPolicy);
}
