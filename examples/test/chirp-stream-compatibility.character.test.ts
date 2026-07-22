import { normalizeSchema } from '@applik8s/sdk';
import { describe, expect, it } from 'vitest';
import { AutomationScheduleChanged } from '../chirp-start/src/domain/events';

describe('Chirp durable stream compatibility', () => {
  it('keeps the v1 automation schedule contract replayable after optional generation metadata was added', () => {
    const payload = normalizeSchema(AutomationScheduleChanged.payload, AutomationScheduleChanged.id);
    expect(payload.validate({
      automationId: 'automation:demo-user:chirp-ops',
      ownerId: 'demo-user',
      accountId: 'chirp-ops',
      schedule: '0 */6 * * *',
      state: 'active',
      changedAt: '2026-07-20T13:05:32.429Z',
    }).ok).toBe(true);
    expect(payload.validate({
      automationId: 'automation:demo-user:chirp-ops',
      ownerId: 'demo-user',
      accountId: 'chirp-ops',
      schedule: '0 */6 * * *',
      state: 'active',
      changedAt: '2026-07-20T13:05:32.429Z',
      persona: 'Release engineer',
      instructions: 'Report deployment health.',
      generationProfile: 'deterministic-safe',
      maxPostsPerDay: '6',
      maxUnitsPerDay: '1000',
    }).ok).toBe(true);
  });
});
