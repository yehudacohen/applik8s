import type { ApplicationAlchemyStackIdentity } from "./identity.js";
import {
  type ApplicationAlchemyLease,
  acquireApplicationAlchemyLease,
} from "./lease.js";

export interface ApplicationAlchemyLeaseOptions {
  readonly stateRoot: string;
  readonly owner?: string;
  readonly leaseTtlMs?: number;
  /** Existing operation-wide lease held by a migration coordinator. */
  readonly lease?: ApplicationAlchemyLease;
}

export async function withDeploymentLease<T>(
  options: ApplicationAlchemyLeaseOptions,
  stack: ApplicationAlchemyStackIdentity,
  operation: () => Promise<T>,
): Promise<T> {
  const ttlMs = options.leaseTtlMs ?? 60_000;
  if (options.lease) {
    assertLeaseIdentity(options.lease, stack);
    return runWithHeartbeat(options.lease, ttlMs, operation, false);
  }
  const lease = await acquireApplicationAlchemyLease(options.stateRoot, stack, {
    owner: options.owner ?? `pid-${process.pid}`,
    ttlMs,
    acquireTimeoutMs: 10_000,
  });
  return runWithHeartbeat(lease, ttlMs, operation, true);
}

/**
 * Holds one stack lease across planning, migration fencing, apply, readiness,
 * and legacy-state retirement. Nested deployment operations borrow the lease.
 */
export async function withApplicationAlchemyDeploymentLease<T>(
  options: Omit<ApplicationAlchemyLeaseOptions, 'lease'>,
  stack: ApplicationAlchemyStackIdentity,
  operation: (lease: ApplicationAlchemyLease) => Promise<T>,
): Promise<T> {
  const ttlMs = options.leaseTtlMs ?? 60_000;
  const lease = await acquireApplicationAlchemyLease(options.stateRoot, stack, {
    owner: options.owner ?? `pid-${process.pid}`,
    ttlMs,
    acquireTimeoutMs: 10_000,
  });
  return runWithHeartbeat(lease, ttlMs, () => operation(lease), true);
}

async function runWithHeartbeat<T>(
  lease: ApplicationAlchemyLease,
  ttlMs: number,
  operation: () => Promise<T>,
  release: boolean,
): Promise<T> {
  let heartbeatFailure: unknown;
  const interval = setInterval(() => {
    lease.heartbeat().catch((cause: unknown) => {
      heartbeatFailure = cause;
    });
  }, Math.max(100, Math.floor(ttlMs / 3)));
  try {
    const result = await operation();
    if (heartbeatFailure) throw heartbeatFailure;
    return result;
  } finally {
    clearInterval(interval);
    if (release) await lease.release();
  }
}

function assertLeaseIdentity(
  lease: ApplicationAlchemyLease,
  stack: ApplicationAlchemyStackIdentity,
): void {
  if (lease.identity.key !== stack.key || lease.identity.digest !== stack.digest) {
    throw new Error(
      `Alchemy Stack lease ${lease.identity.key} cannot authorize deployment ${stack.key}.`,
    );
  }
}
