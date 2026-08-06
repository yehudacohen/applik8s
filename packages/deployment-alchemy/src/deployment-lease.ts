import type { ApplicationAlchemyStackIdentity } from "./identity.js";
import {
  type ApplicationAlchemyLease,
  acquireApplicationAlchemyLease,
} from "./lease.js";

export interface ApplicationAlchemyLeaseOptions {
  readonly stateRoot: string;
  readonly owner?: string;
  readonly leaseTtlMs?: number;
}

export async function withDeploymentLease<T>(
  options: ApplicationAlchemyLeaseOptions,
  stack: ApplicationAlchemyStackIdentity,
  operation: () => Promise<T>,
): Promise<T> {
  const ttlMs = options.leaseTtlMs ?? 60_000;
  const lease = await acquireApplicationAlchemyLease(options.stateRoot, stack, {
    owner: options.owner ?? `pid-${process.pid}`,
    ttlMs,
    acquireTimeoutMs: 10_000,
  });
  return runWithHeartbeat(lease, ttlMs, operation);
}

async function runWithHeartbeat<T>(
  lease: ApplicationAlchemyLease,
  ttlMs: number,
  operation: () => Promise<T>,
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
    await lease.release();
  }
}
