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
});
