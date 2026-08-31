// typecast-file-boundary: the deterministic evidence provider validates stored protocol records before returning typed immutable evidence.
import { canonicalJsonV1String } from '@applik8s/core';
import {
  ApplicationResearchEvidenceConflictError,
  type ApplicationResearchArtifactLink,
  type ApplicationResearchArtifactLinkInput,
  type ApplicationResearchEvidenceCommit,
  type ApplicationResearchEvidenceListInput,
  type ApplicationResearchEvidenceProvider,
  type ApplicationResearchEvidenceRecord,
} from './contracts.js';
import {
  artifactLinkRecord,
  evidenceRecord,
  normalizeResearchArtifactLinkInput,
  normalizeResearchEvidenceCommit,
  normalizeResearchEvidenceListInput,
  researchArtifactLinkId,
  researchEvidenceId,
} from './validation.js';

export interface DeterministicResearchEvidenceOptions {
  readonly clock?: () => Date;
  readonly provider?: string;
  readonly storeIdentity?: string;
}

export function createDeterministicResearchEvidenceProvider(
  options: DeterministicResearchEvidenceOptions = {},
): ApplicationResearchEvidenceProvider & {
  readonly inspectEvidence: () => readonly ApplicationResearchEvidenceRecord[];
  readonly inspectArtifactLinks: () => readonly ApplicationResearchArtifactLink[];
} {
  const clock = options.clock ?? (() => new Date());
  const evidence = new Map<string, ApplicationResearchEvidenceRecord>();
  const links = new Map<string, ApplicationResearchArtifactLink>();
  let version = 0;
  return Object.freeze({
    provider: options.provider ?? 'local-deterministic',
    kind: 'research-evidence-memory',
    mode: 'deterministic',
    storeIdentity: options.storeIdentity ?? 'memory:default',
    async commit(value: ApplicationResearchEvidenceCommit) {
      const input = normalizeResearchEvidenceCommit(value);
      const id = researchEvidenceId(input);
      const existing = evidence.get(id);
      if (existing) {
        if (canonicalJsonV1String(withoutCommitMetadata(existing)) !== canonicalJsonV1String(input)) {
          throw new ApplicationResearchEvidenceConflictError(`Research evidence ${id} was already committed with different immutable content.`);
        }
        return structuredClone(existing);
      }
      const record = evidenceRecord(input, ++version, clock().toISOString());
      evidence.set(id, record);
      return structuredClone(record);
    },
    async list(value: ApplicationResearchEvidenceListInput) {
      const input = normalizeResearchEvidenceListInput(value);
      const values = [...evidence.values()]
        .filter((record) => record.principalScope === input.principalScope && record.runId === input.runId && record.version > input.afterVersion)
        .sort((left, right) => left.version - right.version)
        .slice(0, input.limit);
      return Object.freeze({
        values: Object.freeze(structuredClone(values)),
        ...(values.length === input.limit ? { nextVersion: values.at(-1)!.version } : {}),
      });
    },
    async linkArtifact(value: ApplicationResearchArtifactLinkInput) {
      const input = normalizeResearchArtifactLinkInput(value);
      for (const id of input.evidenceIds) {
        const record = evidence.get(id);
        if (!record || record.principalScope !== input.principalScope || record.runId !== input.runId) {
          throw new ApplicationResearchEvidenceConflictError(`Artifact ${input.artifactId} references absent or inaccessible evidence ${id}.`);
        }
      }
      const id = researchArtifactLinkId(input);
      const existing = links.get(id);
      if (existing) {
        if (canonicalJsonV1String(withoutLinkMetadata(existing)) !== canonicalJsonV1String(input)) {
          throw new ApplicationResearchEvidenceConflictError(`Research artifact link ${id} already exists with different immutable content.`);
        }
        return structuredClone(existing);
      }
      const link = artifactLinkRecord(input, clock().toISOString());
      links.set(id, link);
      return structuredClone(link);
    },
    inspectEvidence: () => Object.freeze(structuredClone([...evidence.values()])),
    inspectArtifactLinks: () => Object.freeze(structuredClone([...links.values()])),
  });
}

function withoutCommitMetadata(record: ApplicationResearchEvidenceRecord) {
  const { apiVersion: _apiVersion, id: _id, version: _version, committedAt: _committedAt, ...input } = record;
  return input;
}

function withoutLinkMetadata(record: ApplicationResearchArtifactLink) {
  const { apiVersion: _apiVersion, id: _id, linkedAt: _linkedAt, ...input } = record;
  return input;
}
