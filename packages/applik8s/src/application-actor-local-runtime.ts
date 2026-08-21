// typecast-file-boundary: Actor persistence records cross an erased schema boundary and are revalidated before use.
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createDeterministicApplicationActorRuntime,
  type ApplicationActorOutboxEvent,
  type ApplicationActorRuntimeSnapshot,
  type DeterministicApplicationActorRuntime,
} from './application-actors.js';

/** Durable single-process actor reference provider used by `applik8s dev`. */
export async function createPersistentLocalApplicationActorRuntime(options: {
  readonly path: string;
  readonly deliverEvent?: (event: ApplicationActorOutboxEvent) => void | Promise<void>;
}): Promise<DeterministicApplicationActorRuntime> {
  const snapshot = await readSnapshot(options.path);
  const runtime = createDeterministicApplicationActorRuntime({
    ...(snapshot ? { snapshot } : {}),
    persist: (next) => writeSnapshot(options.path, next),
    ...(options.deliverEvent ? { deliverEvent: options.deliverEvent } : {}),
  });
  await runtime.drainEffects();
  return runtime;
}

async function readSnapshot(path: string): Promise<ApplicationActorRuntimeSnapshot | undefined> {
  try {
    const candidate = JSON.parse(await readFile(path, 'utf8')) as ApplicationActorRuntimeSnapshot;
    if (candidate.apiVersion !== 'applik8s.actorRuntimeSnapshot/v1alpha1') throw new Error(`Actor state ${path} has an unsupported schema version.`);
    return candidate;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && Reflect.get(cause, 'code') === 'ENOENT') return undefined;
    throw cause;
  }
}

async function writeSnapshot(path: string, snapshot: ApplicationActorRuntimeSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
