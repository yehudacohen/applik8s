import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applicationIntegrationConnections, integrations } from '../src/index.js';

describe('maintained integrations module', () => {
  it('owns provider-neutral connection intent without credential fields', () => {
    expect(getTableName(applicationIntegrationConnections)).toBe('integration_connections');
    expect(applicationIntegrationConnections.provider.notNull).toBe(false);
    expect(applicationIntegrationConnections.principalScope.hasDefault).toBe(true);
    expect('secret' in applicationIntegrationConnections).toBe(false);
    expect('credential' in applicationIntegrationConnections).toBe(false);
    expect(isApplicationRelationalModel(applicationIntegrationConnections)).toBe(true);
    expect(typeof integrations).toBe('function');
  });
});
