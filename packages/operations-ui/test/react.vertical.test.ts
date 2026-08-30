// typecast-file-boundary: the fixture implements the public callable query
// contract narrowly enough to render the maintained React surface.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applicationOperationsOverviewSnapshot,
  type ApplicationOperationsSnapshotOperation,
} from '../src/index.js';
import { ApplicationOperationsControlCenter } from '../src/react.js';

describe('maintained operations React surface', () => {
  it('inherits host theme tokens without introducing a nested main landmark', () => {
    const snapshot = (() => ({
      useQuery: () => ({
        phase: 'success',
        data: applicationOperationsOverviewSnapshot([], [], []),
      }),
    })) as unknown as ApplicationOperationsSnapshotOperation;

    const html = renderToStaticMarkup(createElement(
      ApplicationOperationsControlCenter,
      { snapshot, title: 'Example operations' },
    ));

    expect(html).toContain('<section');
    expect(html).not.toContain('<main');
    expect(html).toContain('--applik8s-operations-text');
    expect(html).toContain('var(--surface');
    expect(html).toContain('aria-label="Example operations"');
    expect(html).toContain('Example operations');
  });

  it('keeps declared topology out of incident attention until evidence exists', () => {
    const snapshot = (() => ({
      useQuery: () => ({
        phase: 'success',
        data: applicationOperationsOverviewSnapshot([], [], [{
          category: 'workflow',
          id: 'graph:workflow.example',
          label: 'ExampleWorkflow',
          state: 'unknown',
          authority: 'inferred',
        }]),
      }),
    })) as unknown as ApplicationOperationsSnapshotOperation;

    const html = renderToStaticMarkup(createElement(
      ApplicationOperationsControlCenter,
      { snapshot, title: 'Example operations' },
    ));

    expect(html).toContain('Compiled topology');
    expect(html).toContain('Topology declarations');
    expect(html).toContain('ExampleWorkflow');
    expect(html).toContain('No observed failures, blocked work, degraded providers, or unresolved runtime waits.');
  });

  it('renders application-owned objectives with missing evidence as Unknown and retains their runbook', () => {
    const snapshot = (() => ({
      useQuery: () => ({
        phase: 'success',
        data: applicationOperationsOverviewSnapshot([], [], []),
      }),
    })) as unknown as ApplicationOperationsSnapshotOperation;

    const html = renderToStaticMarkup(createElement(
      ApplicationOperationsControlCenter,
      {
        snapshot,
        objectives: () => [{
          id: 'durable-work',
          title: 'Durable work completes',
          description: 'Accepted work reaches a terminal state.',
          state: 'missing' as const,
          evidence: 'No workflow observation is available.',
          authority: 'workflow runtime observations',
          window: '15 minutes',
          owner: 'application operator',
          runbook: {
            title: 'Recover durable work',
            steps: ['Inspect the workflow provider.', 'Retry only from the retained receipt.'],
          },
        }],
      },
    ));

    expect(html).toContain('Application objectives');
    expect(html).toContain('Durable work completes');
    expect(html).toContain('Unknown');
    expect(html).not.toContain('>Verified<');
    expect(html).toContain('Recover durable work');
    expect(html).toContain('Retry only from the retained receipt.');
  });

  it('renders observed objective failure as Degraded with accountable evidence', () => {
    const snapshot = (() => ({
      useQuery: () => ({
        phase: 'success',
        data: applicationOperationsOverviewSnapshot([], [], []),
      }),
    })) as unknown as ApplicationOperationsSnapshotOperation;

    const html = renderToStaticMarkup(createElement(
      ApplicationOperationsControlCenter,
      {
        snapshot,
        objectives: () => [{
          id: 'provider-health',
          title: 'Provider calls remain available',
          description: 'The configured inference provider accepts admitted work.',
          state: 'degraded' as const,
          evidence: 'Two current-generation provider failures were observed.',
          authority: 'provider accounting observations',
          window: '10 minutes',
          owner: 'application operator',
          runbook: {
            title: 'Restore provider service',
            steps: ['Inspect the named provider receipt.', 'Repair credentials before retrying.'],
          },
        }],
      },
    ));

    expect(html).toContain('Provider calls remain available');
    expect(html).toContain('Degraded');
    expect(html).toContain('Two current-generation provider failures were observed.');
    expect(html).toContain('provider accounting observations');
    expect(html).toContain('Repair credentials before retrying.');
  });
});
