import type { ApplicationProcessorOptions } from '@applik8s/applik8s';
import { app, capacity } from '../app';
import { databaseProvider } from '../providers';
import { chirpSchema } from '../schema/index';

/** One horizontally scalable command pool; handlers retain per-key ordering and transaction isolation. */
export const ChirpCommandProcessor = {
  group: 'chirp-commands',
  replicas: capacity.commandReplicas,
  concurrency: capacity.commandConcurrency,
  resources: {
    requests: { cpu: capacity.commandCpuRequest, memory: capacity.commandMemoryRequest },
    limits: { cpu: capacity.commandCpuLimit, memory: capacity.commandMemoryLimit },
  },
} satisfies ApplicationProcessorOptions;

/**
 * PostgreSQL is Chirp's authoritative model store. Provider-specific CNPG and
 * Rook backup coordinates stay in this infrastructure module; domain models
 * import only the resulting typed database capability.
 */
export const Database = app.database.bind('chirp', {
  provider: databaseProvider,
  schema: chirpSchema,
  processor: ChirpCommandProcessor,
  migrations: { path: '../drizzle' },
});
