// typecast-file-boundary: provider-neutral doubles erase provider generics so runtime dispatch can be exercised.
import { ApplicationModelContextBoundaryError, ApplicationModelReferenceMissingError, app, createApplicationModelContext, createApplicationRelationalContext, trustedContext, type ApplicationKubernetesModelReader } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, test, vi } from 'vitest';

describe('provider-neutral application model context', () => {
  test('reads relational and Kubernetes models through one snapshot contract and enforces namespace context', async () => {
    const accounts = pgTable('accounts', { id: text('id').primaryKey(), organizationId: text('organization_id').notNull(), revision: text('revision').notNull() });
    const OrganizationId = trustedContext('organizationId', { schema: type('string') });
    const catalog = app('model-context');
    const Database = catalog.database.postgres('catalog', { schema: { accounts } });
    const Account = catalog.model(accounts, { name: 'Account', database: Database });
    const Tenant = catalog.crd(entity('Tenant', { spec: type({ accountId: Account.$model.ref() }), status: type({ phase: 'string' }) }), {
      apiVersion: 'catalog.example/v1alpha1',
      access: { context: OrganizationId, namespaceLabel: 'catalog.example/organization-id' },
    });
    const relational = createApplicationRelationalContext({
      databases: [{ binding: Database, db: relationalDatabase([{ id: 'account-1', organizationId: 'organization-1', revision: 'revision-1' }]) }],
      admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'digest-secret' },
    });
    const kubernetes = {
      namespaceLabels: vi.fn(async () => ({ 'catalog.example/organization-id': 'organization-1' })),
      get: vi.fn(async () => ({ apiVersion: Tenant.apiVersion, kind: Tenant.kind, metadata: { name: 'tenant-1', namespace: 'organization-1', resourceVersion: '22' }, spec: { accountId: 'account-1' } })),
    } as unknown as ApplicationKubernetesModelReader;
    const context = createApplicationModelContext({ relational, kubernetes, admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'digest-secret' } });

    await expect(context.get(Account, 'account-1')).resolves.toEqual({ identity: 'account-1', value: { id: 'account-1', organizationId: 'organization-1', revision: 'revision-1' }, revision: 'revision-1' });
    await expect(context.get(Tenant, { name: 'tenant-1', namespace: 'organization-1' })).resolves.toEqual({ identity: 'tenant-1', value: { accountId: 'account-1' }, revision: '22' });
    expect(kubernetes.namespaceLabels).toHaveBeenCalledWith('organization-1');
  });

  test('fails closed across contexts and reports missing references as a typed diagnostic', async () => {
    const OrganizationId = trustedContext('organizationId', { schema: type('string') });
    const catalog = app('model-context-errors');
    const Tenant = catalog.crd(entity('Tenant', { spec: type({ name: 'string' }) }), { apiVersion: 'catalog.example/v1alpha1', access: { context: OrganizationId, namespaceLabel: 'organization-id' } });
    const denied = createApplicationModelContext({ admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'digest-secret' }, kubernetes: { namespaceLabels: async () => ({ 'organization-id': 'organization-2' }), get: async () => undefined } });
    await expect(denied.get(Tenant, { name: 'tenant-1', namespace: 'tenant-system' })).rejects.toBeInstanceOf(ApplicationModelContextBoundaryError);
    const missing = createApplicationModelContext({ admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'digest-secret' }, kubernetes: { namespaceLabels: async () => ({ 'organization-id': 'organization-1' }), get: async () => undefined } });
    await expect(missing.require(Tenant, { name: 'tenant-1', namespace: 'tenant-system' })).rejects.toBeInstanceOf(ApplicationModelReferenceMissingError);
  });
});

function relationalDatabase(rows: readonly object[]) {
  const select = () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) });
  const transaction = async <T>(handler: (tx: object) => Promise<T>) => handler({ select, execute: async () => [] });
  return { select, transaction } as never;
}
