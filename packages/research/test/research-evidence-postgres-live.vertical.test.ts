// typecast-file-boundary: live evidence tests inspect versioned PostgreSQL records after exercising provider validation and replacement.
import { describe, expect, it } from 'vitest';
import {
  ApplicationResearchEvidenceConflictError,
  PostgresResearchEvidence,
} from '../src/index.js';

const connectionEnvName = 'APPLIK8S_V09_RESEARCH_DATABASE_URL';
const run = process.env[connectionEnvName] ? it : it.skip;

const baseCommit = {
  principalScope: 'workspace:research-live',
  runId: 'run-live-1',
  queryId: 'query-live-1',
  retrievalId: 'retrieval-live-1',
  canonicalUrl: 'https://example.test/live-source',
  searchReceipt: { provider: 'live-fixture', rank: 1 },
  retrievedAt: new Date(0).toISOString(),
  contentDigest: `sha256:${'a'.repeat(64)}` as const,
  snapshotPolicy: 'digest-only' as const,
  citations: [{ start: 0, end: 12, claim: 'Live claim' }],
  visibility: { principalScope: 'workspace:research-live' },
};

describe('PostgreSQL research evidence live lifecycle', () => {
  run('survives provider replacement, adopts retries, and commits artifact links atomically', async () => {
    const schema = `research_${process.pid}`;
    const first = PostgresResearchEvidence.create({ connectionEnvName, schema });
    try {
      const committed = await first.commit(baseCommit);
      expect(committed.version).toBeGreaterThan(0);
      await first.close();

      const replacement = PostgresResearchEvidence.create({ connectionEnvName, schema });
      try {
        const [retry, concurrent] = await Promise.all([
          replacement.commit(baseCommit),
          replacement.commit(baseCommit),
        ]);
        expect(retry).toEqual(committed);
        expect(concurrent).toEqual(committed);
        const listed = await replacement.list({
          principalScope: baseCommit.principalScope,
          runId: baseCommit.runId,
          limit: 10,
        });
        expect(listed.values).toEqual([committed]);

        await expect(replacement.linkArtifact({
          principalScope: baseCommit.principalScope,
          runId: baseCommit.runId,
          artifactId: 'artifact-live-1',
          evidenceIds: [committed.id, 'missing-evidence'],
          claims: [{ claim: 'Live claim', evidenceIds: [committed.id] }],
        })).rejects.toBeInstanceOf(ApplicationResearchEvidenceConflictError);

        const linked = await replacement.linkArtifact({
          principalScope: baseCommit.principalScope,
          runId: baseCommit.runId,
          artifactId: 'artifact-live-1',
          evidenceIds: [committed.id],
          claims: [{ claim: 'Live claim', evidenceIds: [committed.id] }],
        });
        await expect(replacement.linkArtifact({
          principalScope: baseCommit.principalScope,
          runId: baseCommit.runId,
          artifactId: 'artifact-live-1',
          evidenceIds: [committed.id],
          claims: [{ claim: 'Live claim', evidenceIds: [committed.id] }],
        })).resolves.toEqual(linked);
      } finally {
        await replacement.close();
      }
    } finally {
      await first.close();
    }
  }, 30_000);
});
