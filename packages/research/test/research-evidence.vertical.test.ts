import { app, applicationGraphFor } from '@applik8s/applik8s';
import { canonicalJsonV1String } from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  ApplicationResearchEvidenceConflictError,
  LocalResearchEvidence,
  PostgresResearchEvidence,
  ResearchEvidence,
} from '../src/index.js';

const baseCommit = {
  principalScope: 'workspace:one',
  runId: 'run-1',
  queryId: 'query-1',
  retrievalId: 'retrieval-1',
  canonicalUrl: 'https://example.test/source#ignored',
  searchReceipt: { provider: 'fixture', rank: 1 },
  retrievedAt: new Date(0).toISOString(),
  contentDigest: `sha256:${'a'.repeat(64)}` as const,
  snapshotPolicy: 'digest-only' as const,
  citations: [{ start: 0, end: 8, quote: 'Evidence' }],
  visibility: { workspace: 'one' },
};

describe('durable research evidence', () => {
  it('adopts an identical retry and versions changed page content append-only', async () => {
    const provider = LocalResearchEvidence.deterministic({ clock: () => new Date(0) });
    const first = await provider.commit(baseCommit);
    const retry = await provider.commit(baseCommit);
    expect(retry).toEqual(first);
    const changed = await provider.commit({
      ...baseCommit,
      contentDigest: `sha256:${'b'.repeat(64)}`,
      citations: [{ start: 9, end: 20 }],
    });
    expect(changed.id).not.toBe(first.id);
    expect(changed.version).toBeGreaterThan(first.version);
    await expect(provider.list({ principalScope: baseCommit.principalScope, runId: baseCommit.runId }))
      .resolves.toMatchObject({ values: [first, changed] });
  });

  it('rejects conflicting retries and cross-scope artifact linkage', async () => {
    const provider = LocalResearchEvidence.deterministic({ clock: () => new Date(0) });
    const evidence = await provider.commit(baseCommit);
    await expect(provider.commit({ ...baseCommit, canonicalUrl: 'https://example.test/different' }))
      .rejects.toBeInstanceOf(ApplicationResearchEvidenceConflictError);
    await expect(provider.linkArtifact({
      principalScope: 'workspace:other',
      runId: baseCommit.runId,
      artifactId: 'artifact-1',
      evidenceIds: [evidence.id],
      claims: [{ claim: 'Supported claim', evidenceIds: [evidence.id] }],
    })).rejects.toBeInstanceOf(ApplicationResearchEvidenceConflictError);
  });

  it('links only committed evidence and adopts the same artifact receipt', async () => {
    const provider = LocalResearchEvidence.deterministic({ clock: () => new Date(0) });
    const evidence = await provider.commit(baseCommit);
    const input = {
      principalScope: baseCommit.principalScope,
      runId: baseCommit.runId,
      artifactId: 'artifact-1',
      evidenceIds: [evidence.id],
      claims: [{ claim: 'Supported claim', evidenceIds: [evidence.id] }],
    };
    const first = await provider.linkArtifact(input);
    const retry = await provider.linkArtifact(input);
    expect(retry).toEqual(first);
    expect(canonicalJsonV1String(first.claims)).toContain('Supported claim');
  });

  it('records qualified local and PostgreSQL providers without embedding a database URL', () => {
    const Evidence = ResearchEvidence.named('research');
    const application = app('research-evidence-proof', {
      spec: type({ profile: "'starter' | 'dedicated' | 'external'" }),
      status: type({ ready: 'boolean' }),
    });
    application.profile(application.installation.spec, 'profile')
      .provide(Evidence)
      .starter(() => LocalResearchEvidence.deterministic())
      .dedicated(() => PostgresResearchEvidence.create({
        connectionEnvName: 'RESEARCH_DATABASE_URL',
        connectionSecret: { name: 'research-db-app', namespace: 'research-system', key: 'uri' },
        schema: 'research',
      }))
      .external(() => PostgresResearchEvidence.create({ connectionEnvName: 'EXTERNAL_RESEARCH_DATABASE_URL', schema: 'research' }))
      .exhaustive();
    const evidence = application.inject(Evidence);
    expect(typeof evidence.commit).toBe('function');
    const graph = applicationGraphFor(application.composition);
    const node = graph?.nodes.find((candidate) => candidate.kind === 'provider' && candidate.interface === 'ResearchEvidence');
    expect(node).toMatchObject({
      kind: 'provider',
      interface: 'ResearchEvidence',
      config: expect.objectContaining({
        profile: expect.objectContaining({
          branches: expect.arrayContaining([
            expect.objectContaining({ variant: 'starter', implementation: 'research-evidence-memory' }),
            expect.objectContaining({ variant: 'dedicated', implementation: 'research-evidence-postgres' }),
          ]),
        }),
      }),
    });
    expect(JSON.stringify(node)).not.toContain('postgres://');
    expect(JSON.stringify(node)).toContain('research-db-app');
    expect(JSON.stringify(node)).toContain('RESEARCH_DATABASE_URL');
  });

  it('fails closed on malformed retained snapshots and citation spans', async () => {
    const provider = LocalResearchEvidence.deterministic();
    await expect(provider.commit({ ...baseCommit, snapshotPolicy: 'retained-snapshot' }))
      .rejects.toThrow(/snapshotArtifactId/u);
    await expect(provider.commit({ ...baseCommit, citations: [{ start: 5, end: 5 }] }))
      .rejects.toThrow(/non-empty/u);
  });
});
