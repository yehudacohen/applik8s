import { describe, expect, it } from 'vitest';

import { assertSafeManagedPostgresClusterUpdate } from '../src/application-postgres-contract.js';
import type { ApplicationPostgresClusterSpec } from '../src/application-providers.js';

const desired: ApplicationPostgresClusterSpec = {
  instances: 3,
  storage: { size: '20Gi' },
  bootstrap: { initdb: { database: 'chirp', owner: 'app' } },
  backup: {
    retentionPolicy: '14d',
    target: 'prefer-standby',
    barmanObjectStore: {
      destinationPath: 's3://chirp/database-backups',
      s3Credentials: {
        accessKeyId: { name: 'chirp', key: 'AWS_ACCESS_KEY_ID' },
        secretAccessKey: { name: 'chirp', key: 'AWS_SECRET_ACCESS_KEY' },
      },
      data: { compression: 'gzip', jobs: 2, immediateCheckpoint: true },
      wal: { compression: 'gzip', maxParallel: 2 },
    },
  },
};

describe('managed PostgreSQL reconciliation contract', () => {
  it('allows operational reconciliation and storage growth', () => {
    expect(() => assertSafeManagedPostgresClusterUpdate({
      instances: 1,
      bootstrap: { initdb: { database: 'chirp', owner: 'app', encoding: 'UTF8' } },
      storage: { size: '10240Mi', resizeInUseVolumes: true },
    }, desired, 'CloudNativePG Cluster chirp/chirp')).not.toThrow();
  });

  it('rejects database identity and owner changes', () => {
    expect(() => assertSafeManagedPostgresClusterUpdate({
      bootstrap: { initdb: { database: 'legacy', owner: 'app' } },
      storage: { size: '20Gi' },
    }, desired, 'CloudNativePG Cluster chirp/chirp')).toThrow(/initialized value "chirp"/);
    expect(() => assertSafeManagedPostgresClusterUpdate({
      bootstrap: { initdb: { database: 'chirp', owner: 'legacy' } },
      storage: { size: '20Gi' },
    }, desired, 'CloudNativePG Cluster chirp/chirp')).toThrow(/initialized value "app"/);
  });

  it('rejects storage-class changes and volume shrinkage', () => {
    expect(() => assertSafeManagedPostgresClusterUpdate({
      bootstrap: desired.bootstrap,
      storage: { size: '20Gi', storageClass: 'local-path' },
    }, desired, 'CloudNativePG Cluster chirp/chirp')).toThrow(/storageClass cannot change implicitly/);
    expect(() => assertSafeManagedPostgresClusterUpdate({
      bootstrap: desired.bootstrap,
      storage: { size: '20Gi' },
    }, { ...desired, storage: { size: '19Gi' } }, 'CloudNativePG Cluster chirp/chirp')).toThrow(/cannot shrink implicitly/);
  });

  it('fails closed for storage quantities it cannot compare', () => {
    expect(() => assertSafeManagedPostgresClusterUpdate({
      bootstrap: desired.bootstrap,
      storage: { size: 'twenty-gibibytes' },
    }, desired, 'CloudNativePG Cluster chirp/chirp')).toThrow(/cannot be safely compared/);
  });
});
