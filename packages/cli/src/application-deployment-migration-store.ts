// typecast-file-boundary: persisted migration JSON is untrusted until this store validates its stable discriminants; nested state is revalidated by the core transition machine.
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type ApplicationDeploymentMigrationRun,
  type ApplicationDeploymentMigrationRunStore,
  applicationDeploymentMigrationRunVersion,
} from '@applik8s/core';

/**
 * File-backed migration state for the local deployment authority. Writes use
 * an exclusive directory lease and atomic rename; stale revisions never win.
 */
export function createFileApplicationDeploymentMigrationRunStore(input: {
  readonly root: string;
  readonly lockTimeoutMs?: number;
  /** A crashed writer's lock is recoverable only after this bounded lease. */
  readonly staleLockMs?: number;
}): ApplicationDeploymentMigrationRunStore {
  const root = resolve(input.root);
  const lockTimeoutMs = input.lockTimeoutMs ?? 10_000;
  const staleLockMs = input.staleLockMs ?? Math.max(60_000, lockTimeoutMs * 6);
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1) {
    throw new TypeError('Migration lockTimeoutMs must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(staleLockMs) || staleLockMs < 1) {
    throw new TypeError('Migration staleLockMs must be a positive safe integer.');
  }
  return {
    read: id => readRun(pathFor(root, id)),
    create: run => withLock(root, run.id, lockTimeoutMs, staleLockMs, async () => {
      const path = pathFor(root, run.id);
      if (await readRun(path)) throw new Error(`Migration run ${run.id} already exists.`);
      await atomicWrite(path, run);
      return run;
    }),
    compareAndSwap: input => withLock(root, input.id, lockTimeoutMs, staleLockMs, async () => {
      const path = pathFor(root, input.id);
      const current = await readRun(path);
      if (!current || current.revision !== input.expectedRevision) return undefined;
      if (input.next.id !== input.id || input.next.revision !== input.expectedRevision + 1) {
        throw new Error(`Migration CAS for ${input.id} received an invalid successor revision.`);
      }
      await atomicWrite(path, input.next);
      return input.next;
    }),
  };
}

function pathFor(root: string, id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(id)) {
    throw new TypeError(`Migration run ID ${JSON.stringify(id)} is not filesystem-safe.`);
  }
  return join(root, `${id}.json`);
}

async function readRun(path: string): Promise<ApplicationDeploymentMigrationRun | undefined> {
  const source = await readFile(path, 'utf8').catch((cause: unknown) => {
    if (isNotFound(cause)) return undefined;
    throw cause;
  });
  if (source === undefined) return undefined;
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Migration state ${path} is not a JSON object.`);
  }
  const candidate = parsed as Partial<ApplicationDeploymentMigrationRun>;
  if (
    candidate.schemaVersion !== applicationDeploymentMigrationRunVersion
    || typeof candidate.id !== 'string'
    || typeof candidate.deployment !== 'string'
    || typeof candidate.proposalDigest !== 'string'
    || typeof candidate.phase !== 'string'
    || !Number.isSafeInteger(candidate.revision)
    || !Array.isArray(candidate.receipts)
    || !Array.isArray(candidate.handoffs)
  ) {
    throw new Error(`Migration state ${path} does not satisfy ${applicationDeploymentMigrationRunVersion}.`);
  }
  // typecast: the stable discriminants and collection roots above are checked;
  // core transition validation checks every consumed nested receipt and identity.
  return candidate as ApplicationDeploymentMigrationRun;
}

async function atomicWrite(path: string, run: ApplicationDeploymentMigrationRun): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function withLock<T>(
  root: string,
  id: string,
  timeoutMs: number,
  staleLockMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(root, { recursive: true });
  const lock = join(root, `${id}.lock`);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const acquired = await mkdir(lock).then(() => true).catch((cause: unknown) => {
      if (isAlreadyExists(cause)) return false;
      throw cause;
    });
    if (acquired) {
      await writeFile(join(lock, 'owner.json'), `${JSON.stringify({
        version: 1,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      })}\n`, { mode: 0o600 });
      break;
    }
    if (await retireStaleLock(lock, staleLockMs)) continue;
    if (Date.now() >= deadline) throw new Error(`Timed out acquiring migration state lock for ${id}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function retireStaleLock(path: string, staleLockMs: number): Promise<boolean> {
  const age = await stat(path)
    .then(({ mtimeMs }) => Date.now() - mtimeMs)
    .catch((cause: unknown) => {
      if (isNotFound(cause)) return undefined;
      throw cause;
    });
  if (age === undefined || age < staleLockMs) return false;
  const retired = `${path}.stale.${process.pid}.${crypto.randomUUID()}`;
  const claimed = await rename(path, retired).then(() => true).catch((cause: unknown) => {
    if (isNotFound(cause)) return false;
    throw cause;
  });
  if (!claimed) return false;
  await rm(retired, { recursive: true, force: true });
  return true;
}

function isNotFound(cause: unknown): boolean {
  return Boolean(cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT');
}

function isAlreadyExists(cause: unknown): boolean {
  return Boolean(cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'EEXIST');
}
