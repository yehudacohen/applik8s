// typecast-file-boundary: adversarial store fixtures deliberately construct narrowed migration-state variants to exercise persistence and CAS validation.
import { mkdir, mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApplicationDeploymentMigrationRun,
  applicationDeploymentMigrationRunVersion,
} from '@applik8s/core';
import { createFileApplicationDeploymentMigrationRunStore } from '../src/application-deployment-migration-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(id = 'upgrade-v071-v09', revision = 0): ApplicationDeploymentMigrationRun {
  return {
    schemaVersion: applicationDeploymentMigrationRunVersion,
    id,
    deployment: 'application/production',
    proposalDigest: `sha256:${'a'.repeat(64)}`,
    proposal: {
      schemaVersion: 'applik8s.deploymentMigrationProposal/v1alpha1',
      mode: 'read-only',
      source: {
        baseline: {
          release: '0.7.1', gitTag: 'v0.7.1', commit: '3d482707d70e868c9e20267650c9ebfda573bc98',
          applicationArtifactSchema: 'applik8s.appGraph/v1alpha1', applicationPlanSchema: 'applik8s.applicationPlan/absent-v0.7.1',
          providerCatalogDigest: `sha256:${'b'.repeat(64)}`, runtimeProtocolVersions: ['applik8s.runtime/v1alpha1'], evidenceManifestDigest: `sha256:${'c'.repeat(64)}`,
        },
        application: 'application', deploymentStateIdentity: 'alchemy://application',
        applicationArtifactDigest: `sha256:${'d'.repeat(64)}`, planDigest: `sha256:${'e'.repeat(64)}`,
      },
      target: {
        release: '0.9.0', application: 'application', profile: 'production',
        applicationArtifactDigest: `sha256:${'f'.repeat(64)}`, applicationPlanSchema: 'applik8s.applicationPlan/v1alpha1',
        providerCatalogDigest: `sha256:${'1'.repeat(64)}`, planDigest: `sha256:${'2'.repeat(64)}`,
      },
      mappings: [], diagnostics: [], status: 'ready', mutationAuthorized: false,
    },
    phase: 'proposed',
    revision,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    receipts: [], handoffs: [],
  };
}

describe('file application deployment migration store', () => {
  it('persists private state and rejects stale compare-and-swap writers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-migration-store-'));
    roots.push(root);
    const store = createFileApplicationDeploymentMigrationRunStore({ root });
    const created = await store.create(fixture());
    const next = { ...created, revision: 1, phase: 'sourceVerified' as const };
    expect(await store.compareAndSwap({ id: created.id, expectedRevision: 0, next })).toEqual(next);
    expect(await store.compareAndSwap({ id: created.id, expectedRevision: 0, next })).toBeUndefined();
    expect(await store.read(created.id)).toEqual(next);
    expect(await readFile(join(root, `${created.id}.json`), 'utf8')).toContain('"sourceVerified"');
  });

  it('rejects path traversal and conflicting creation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-migration-store-'));
    roots.push(root);
    const store = createFileApplicationDeploymentMigrationRunStore({ root });
    await expect(Promise.resolve().then(() => store.read('../escape'))).rejects.toThrow(/filesystem-safe/u);
    await store.create(fixture());
    await expect(store.create(fixture())).rejects.toThrow(/already exists/u);
  });

  it('recovers a crashed writer lock only after its bounded stale lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-migration-store-'));
    roots.push(root);
    const lock = join(root, 'upgrade-v071-v09.lock');
    await mkdir(lock, { recursive: true });
    const expired = new Date(Date.now() - 5_000);
    await utimes(lock, expired, expired);
    const store = createFileApplicationDeploymentMigrationRunStore({
      root,
      lockTimeoutMs: 100,
      staleLockMs: 1_000,
    });
    await expect(store.create(fixture())).resolves.toMatchObject({ phase: 'proposed' });
  });
});
