import { type ApplicationInstallationTransport, app } from '@applik8s/applik8s';
import type { ResourceObject } from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

interface InstallationSpec {
  readonly name: string;
  readonly replicas: number;
}

interface InstallationStatus {
  readonly ready: boolean;
}

describe('typed Application installation client', () => {
  it('supports create/get/require/list/update/watch and TypeKro-owned deletion through one typed contract', async () => {
    const application = app('managed-site', {
      controlPlaneNamespace: 'sites-control',
      apiVersion: 'applications.example.test/v1alpha1',
      kind: 'SiteInstallation',
      spec: type({ name: 'string', replicas: 'number.integer >= 1' }),
      status: type({ ready: 'boolean' }),
    });
    const objects = new Map<string, ResourceObject<InstallationSpec, InstallationStatus>>();
    const deletions: string[] = [];
    const transport: ApplicationInstallationTransport<InstallationSpec, InstallationStatus> = {
      async create(object) {
        const stored = { ...object, metadata: { ...object.metadata, resourceVersion: '1' }, status: { ready: false } };
        objects.set(`${stored.metadata.namespace}/${stored.metadata.name}`, stored);
        return stored;
      },
      async get(reference) {
        return objects.get(`${reference.namespace}/${reference.name}`);
      },
      async list(options) {
        return { items: [...objects.values()].filter((object) => object.metadata.namespace === options.namespace) };
      },
      async replace(object) {
        const stored = { ...object, metadata: { ...object.metadata, resourceVersion: '2' } };
        objects.set(`${stored.metadata.namespace}/${stored.metadata.name}`, stored);
        return stored;
      },
      async deleteInstance(reference) {
        deletions.push(`${reference.namespace}/${reference.name}`);
        objects.delete(`${reference.namespace}/${reference.name}`);
      },
      async *watch(options) {
        yield {
          type: 'ADDED',
          object: application.installation.instance({ name: 'watched', namespace: options.namespace, spec: { name: 'watched', replicas: 1 } }),
        };
      },
    };
    const client = await application.installation.connect({ transport });
    const created = await client.create({ name: 'community', spec: { name: 'community', replicas: 1 } });
    expect(created.metadata).toMatchObject({ name: 'community', namespace: 'sites-control', resourceVersion: '1' });
    expect(await client.get({ name: 'community' })).toEqual(created);
    expect(await client.require({ name: 'community' })).toEqual(created);
    expect((await client.list()).items).toHaveLength(1);
    const updated = await client.update({ name: 'community' }, (current) => ({ ...current.spec, replicas: 3 }));
    expect(updated).toMatchObject({ metadata: { resourceVersion: '2' }, spec: { replicas: 3 } });
    const watched = await client.watch({ bufferSize: 1 })[Symbol.asyncIterator]().next();
    expect(watched.value).toMatchObject({ type: 'ADDED', object: { metadata: { name: 'watched' } } });
    expect(() => client.watch({ bufferSize: 0 })).toThrow(/between 1 and 10000/);
    await expect(client.require({ name: 'missing' })).rejects.toThrow(/was not found/);
    await expect(client.create({ name: 'invalid', spec: { name: 'invalid', replicas: 0 } })).rejects.toThrow(/spec is invalid/);
    expect(await client.delete({ name: 'community' })).toEqual({
      deleted: true,
      ref: {
        apiVersion: 'applications.example.test/v1alpha1',
        kind: 'SiteInstallation',
        name: 'community',
        namespace: 'sites-control',
      },
    });
    expect(deletions).toEqual(['sites-control/community']);
  });
});
