import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { agents, applicationAgentProfiles } from '../src/index.js';

describe('maintained agents module', () => {
  it('owns revisioned application agent profiles and enforced execution-policy fields', () => {
    expect(getTableName(applicationAgentProfiles)).toBe('agent_profiles');
    expect(applicationAgentProfiles.version.notNull).toBe(true);
    expect(applicationAgentProfiles.revision.notNull).toBe(true);
    expect(applicationAgentProfiles.maximumTurns.notNull).toBe(true);
    expect(applicationAgentProfiles.maximumToolCalls.notNull).toBe(true);
    expect(applicationAgentProfiles.principalScope.hasDefault).toBe(true);
    expect(isApplicationRelationalModel(applicationAgentProfiles)).toBe(true);
    expect(typeof agents).toBe('function');
  });
});
