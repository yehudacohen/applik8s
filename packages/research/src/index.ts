import { defineApplicationProvider } from '@applik8s/applik8s';
import type {
  ApplicationResearchEvidenceProvider,
} from './contracts.js';
import {
  createDeterministicResearchEvidenceProvider,
  type DeterministicResearchEvidenceOptions,
} from './memory.js';
import {
  createPostgresResearchEvidenceProvider,
  type PostgresResearchEvidenceOptions,
} from './postgres.js';
import {
  bindResearchEvidenceRuntime,
  researchEvidenceRuntime,
} from './runtime-contract.js';

export * from './contracts.js';
export * from './research-agent.js';
export type { DeterministicResearchEvidenceOptions } from './memory.js';
export type { PostgresResearchEvidenceOptions } from './postgres.js';
export { createDeterministicResearchEvidenceProvider } from './memory.js';
export { createPostgresResearchEvidenceProvider } from './postgres.js';

export const ResearchEvidence = defineApplicationProvider<ApplicationResearchEvidenceProvider>({
  interface: 'ResearchEvidence',
  version: 'v1alpha1',
  description: 'Append-only research source evidence and artifact citation linkage.',
  requirements: [
    'logical retrieval and content digest commits are idempotent and immutable',
    'evidence visibility is scoped by admitted principal authority',
    'artifact claims reference committed evidence from the same run and scope',
  ],
  guarantees: [
    'mutable source pages create new content-addressed evidence versions',
    'transport loss never fabricates an empty successful evidence record',
    'artifact linkage is append-safe and inspectable independently from synthesis',
  ],
  runtime: {
    operations: {
      commit: {
        module: '@applik8s/research/runtime',
        export: 'commitResearchEvidence',
        access: { kind: 'provider', operations: ['model.write'] },
      },
      list: {
        module: '@applik8s/research/runtime',
        export: 'listResearchEvidence',
        access: { kind: 'provider', operations: ['model.read'] },
      },
      linkArtifact: {
        module: '@applik8s/research/runtime',
        export: 'linkResearchArtifactEvidence',
        access: { kind: 'provider', operations: ['model.read', 'model.write'] },
      },
    },
    bind(implementation) {
      const runtime = researchEvidenceRuntime(implementation);
      if (!runtime) throw new Error(`ResearchEvidence provider ${implementation.kind} has no portable managed-worker runtime binding.`);
      return runtime;
    },
  },
  accepts(value): value is ApplicationResearchEvidenceProvider {
    return Boolean(
      value
      && typeof value === 'object'
      && typeof Reflect.get(value, 'provider') === 'string'
      && typeof Reflect.get(value, 'storeIdentity') === 'string'
      && (Reflect.get(value, 'mode') === 'deterministic' || Reflect.get(value, 'mode') === 'durable')
      && typeof Reflect.get(value, 'commit') === 'function'
      && typeof Reflect.get(value, 'list') === 'function'
      && typeof Reflect.get(value, 'linkArtifact') === 'function',
    );
  },
});

export const LocalResearchEvidence = Object.freeze({
  deterministic(options: DeterministicResearchEvidenceOptions = {}) {
    const provider = createDeterministicResearchEvidenceProvider(options);
    return Object.freeze(bindResearchEvidenceRuntime({ ...provider }, {
      env: { APPLIK8S_RESEARCH_EVIDENCE_KIND: 'memory' },
    }));
  },
});

export const PostgresResearchEvidence = Object.freeze({
  create(options: Omit<PostgresResearchEvidenceOptions, 'sql'> = {}) {
    const provider = createPostgresResearchEvidenceProvider(options);
    return Object.freeze(bindResearchEvidenceRuntime({ ...provider }, {
      env: {
        APPLIK8S_RESEARCH_EVIDENCE_KIND: 'postgres',
        APPLIK8S_RESEARCH_EVIDENCE_CONNECTION_ENV: provider.connectionEnvName,
        APPLIK8S_RESEARCH_EVIDENCE_SCHEMA: provider.schema,
      },
    }));
  },
});
