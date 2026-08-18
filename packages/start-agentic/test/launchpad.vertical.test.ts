import { describe, expect, it } from 'vitest';
import {
  agenticLaunchpadEvidenceState,
  summarizeAgenticLaunchpadEvidence,
} from '../src/launchpad.js';

describe('Agentic Start Launchpad evidence', () => {
  it('includes deployment evidence in counts and recommended action', () => {
    const summary = summarizeAgenticLaunchpadEvidence([
      {
        name: 'Current deployment',
        verification: 'Publish deployment evidence.',
        records: [],
      },
      {
        name: 'AI runtime',
        verification: 'Run the assistant.',
        records: [{ state: 'ready', authority: 'provider' }],
      },
    ]);

    expect(summary).toMatchObject({
      ready: 1,
      actionRequired: 0,
      needsVerification: 1,
      next: {
        name: 'Current deployment',
        state: 'Needs verification',
      },
    });
  });

  it('prioritizes actionable failures over missing evidence', () => {
    const summary = summarizeAgenticLaunchpadEvidence([
      { name: 'Deployment', verification: 'Publish.', records: [] },
      {
        name: 'Database',
        verification: 'Repair.',
        records: [{ state: 'degraded', authority: 'provider' }],
      },
    ]);
    expect(summary.next).toMatchObject({
      name: 'Database',
      state: 'Action required',
    });
  });

  it('never treats inferred intent as verified runtime evidence', () => {
    expect(agenticLaunchpadEvidenceState([
      { state: 'ready', authority: 'inferred' },
    ])).toBe('Needs verification');
  });
});
