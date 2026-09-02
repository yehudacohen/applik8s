import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

describe('Kubernetes cluster capability compiler lowering', () => {
  it('hydrates direct named-handle syntax through the host runtime without serializing credentials', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.tmp-applik8s-kubernetes-cluster-'));
    directories.push(directory);
    const entrypoint = join(directory, 'entrypoint.ts');
    await mkdir(join(directory, 'migrations'));
    await writeFile(join(directory, 'migrations', '0000_records.sql'), 'create table cluster_capability_records (id text primary key);\n');
    await writeFile(entrypoint, `
import { Database, IdentityProvider, KubernetesCluster, TransactionalDatabase, app, sdk } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';

const application = app('cluster-capability', { namespace: 'cluster-capability' });
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter', application: 'cluster-capability', subject: 'alice',
  audience: ['cluster-capability'], catalogRevision: 'catalog-v1', authorityRevision: 'authority-v1',
}));
application.provide(TransactionalDatabase, Database.postgres({
  name: 'cluster-capability-db', namespace: 'cluster-capability', database: 'cluster_capability',
}));
const records = pgTable('cluster_capability_records', { id: text('id').primaryKey() });
const database = application.database.postgres('main', { schema: { records }, migrations: { path: './migrations' } });
application.model(records, { name: 'ClusterCapabilityRecord', database });
export const Destination = KubernetesCluster.named('destination');
application.provide(Destination, KubernetesCluster.current({ namespace: 'apps' }));
const api = application.http('api');
api.post('deployment', '/deployment', {
  input: type({ namespace: 'string', name: 'string' }),
  output: type({ name: 'string' }),
}, async ({ input }) => ({
  name: (await Destination.resources(sdk.kubernetes.Deployment).get(input)).metadata.name,
})).public();
export const clusterCapabilityStack = application.composition;
`);

    const result = await compileTypeKroComposition({
      entrypoint,
      compositionName: 'clusterCapabilityStack',
      outDir: join(directory, 'dist'),
      runtimeVersionRange: '^0.9.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: {
        deterministicBuild: true,
        allowEnvironmentAccess: false,
        allowFilesystemAccess: false,
        allowNetworkAccess: true,
        allowedHostImports: [],
        sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
      },
    });
    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) return;
    const artifact = result.value.artifacts.httpArtifacts.find(candidate =>
      candidate.serverId === 'server.api');
    if (!artifact) throw new Error('Expected generated cluster capability server.');
    const source = await readFile(artifact.sourcePath, 'utf8');
    expect(source).toContain('resourcesApplicationKubernetesCluster');
    expect(source).toContain('provider.kubernetes-cluster.v1alpha1.destination');
    expect(source).toContain('deployments');
    expect(source).not.toContain('DESTINATION_');
  }, 120_000);
});
