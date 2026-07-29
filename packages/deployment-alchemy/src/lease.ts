import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ApplicationAlchemyStackIdentity } from "./identity.js";

export interface ApplicationAlchemyLeaseOptions {
  readonly owner: string;
  readonly ttlMs?: number;
  readonly acquireTimeoutMs?: number;
  readonly retryIntervalMs?: number;
  readonly now?: () => number;
}

export interface ApplicationAlchemyLease {
  readonly identity: ApplicationAlchemyStackIdentity;
  readonly owner: string;
  readonly token: string;
  readonly acquiredAt: string;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}

interface PersistedLease {
  readonly version: 1;
  readonly stackKey: string;
  readonly identityDigest: string;
  readonly owner: string;
  readonly token: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export async function acquireApplicationAlchemyLease(
  root: string,
  identity: ApplicationAlchemyStackIdentity,
  options: ApplicationAlchemyLeaseOptions,
): Promise<ApplicationAlchemyLease> {
  if (!options.owner.trim()) throw new Error("Alchemy lease owner must be non-empty.");
  const ttlMs = positiveDuration(options.ttlMs ?? 30_000, "lease ttl");
  const acquireTimeoutMs = positiveDuration(
    options.acquireTimeoutMs ?? 10_000,
    "lease acquisition timeout",
  );
  const retryIntervalMs = positiveDuration(
    options.retryIntervalMs ?? 100,
    "lease retry interval",
  );
  const now = options.now ?? Date.now;
  const path = join(root, "leases", `${identity.key}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const startedAt = now();
  let blockingLease: PersistedLease | undefined;
  while (now() - startedAt <= acquireTimeoutMs) {
    const token = randomUUID();
    const acquiredAt = new Date(now()).toISOString();
    const persisted: PersistedLease = {
      version: 1,
      stackKey: identity.key,
      identityDigest: identity.digest,
      owner: options.owner,
      token,
      acquiredAt,
      expiresAt: new Date(now() + ttlMs).toISOString(),
    };
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(persisted));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return leaseHandle(path, identity, persisted, ttlMs, now);
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") throw cause;
    }
    const current = await readLease(path);
    if (
      current &&
      current.stackKey === identity.key &&
      current.identityDigest !== identity.digest
    ) {
      throw new Error(
        `Alchemy lease ${identity.key} belongs to a different full deployment identity.`,
      );
    }
    if (current && Date.parse(current.expiresAt) > now()) {
      blockingLease = current;
      if (now() - startedAt + retryIntervalMs >= acquireTimeoutMs) {
        throw new Error(
          `Alchemy Stack ${identity.key} is locked by ${current.owner} until ${current.expiresAt}.`,
        );
      }
      await delay(retryIntervalMs);
      continue;
    }
    await retireExpiredLease(path);
  }
  if (blockingLease) {
    throw new Error(
      `Alchemy Stack ${identity.key} is locked by ${blockingLease.owner} until ${blockingLease.expiresAt}.`,
    );
  }
  throw new Error(`Timed out acquiring Alchemy Stack lease ${identity.key}.`);
}

function leaseHandle(
  path: string,
  identity: ApplicationAlchemyStackIdentity,
  persisted: PersistedLease,
  ttlMs: number,
  now: () => number,
): ApplicationAlchemyLease {
  let released = false;
  return {
    identity,
    owner: persisted.owner,
    token: persisted.token,
    acquiredAt: persisted.acquiredAt,
    async heartbeat() {
      if (released) throw new Error(`Alchemy Stack lease ${identity.key} is released.`);
      const current = await requiredOwnedLease(path, persisted);
      await atomicWriteLease(path, {
        ...current,
        expiresAt: new Date(now() + ttlMs).toISOString(),
      });
    },
    async release() {
      if (released) return;
      await requiredOwnedLease(path, persisted);
      await rm(path, { force: true });
      released = true;
    },
  };
}

async function requiredOwnedLease(
  path: string,
  expected: PersistedLease,
): Promise<PersistedLease> {
  const current = await readLease(path);
  if (!current || current.token !== expected.token || current.owner !== expected.owner) {
    throw new Error(`Alchemy Stack lease ${expected.stackKey} ownership was lost.`);
  }
  return current;
}

async function readLease(path: string): Promise<PersistedLease | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Reflect.get(value, "version") !== 1 ||
      typeof Reflect.get(value, "stackKey") !== "string" ||
      typeof Reflect.get(value, "identityDigest") !== "string" ||
      typeof Reflect.get(value, "owner") !== "string" ||
      typeof Reflect.get(value, "token") !== "string" ||
      typeof Reflect.get(value, "acquiredAt") !== "string" ||
      typeof Reflect.get(value, "expiresAt") !== "string"
    ) {
      throw new Error(`Alchemy lease ${path} is corrupt.`);
    }
    // typecast: the exhaustive persisted lease checks above establish the exact wire shape.
    return value as unknown as PersistedLease;
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return undefined;
    throw cause;
  }
}

async function retireExpiredLease(path: string): Promise<void> {
  try {
    await stat(path);
    await rename(path, `${path}.expired.${randomUUID()}`);
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") throw cause;
  }
}

async function atomicWriteLease(path: string, lease: PersistedLease): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(lease), { mode: 0o600 });
  await rename(temporary, path);
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Alchemy ${label} must be a positive integer.`);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(cause: unknown): string | undefined {
  return cause && typeof cause === "object"
    ? String(Reflect.get(cause, "code") ?? "")
    : undefined;
}
