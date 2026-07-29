import { describe, expect, it } from 'vitest';
import {
  ApplicationKubernetesSnapshotBoundError,
  ApplicationKubernetesSnapshotWatchAuthority,
  type ApplicationKubernetesSnapshotWatchClient,
  type ApplicationKubernetesWatchEvent,
} from '../src/kubernetes-query-authority.js';

interface Entry { readonly metadata: { readonly name: string } }
interface Query { readonly namespace: string }

describe('Kubernetes snapshot/watch query authority', () => {
  it('paginates one consistent list snapshot and resumes from its resourceVersion', async () => {
    const watchEvents: ApplicationKubernetesWatchEvent<Entry>[] = [
      { type: 'BOOKMARK', resourceVersion: '12' },
      { type: 'MODIFIED', resourceVersion: '13', object: { metadata: { name: 'ada' } } },
    ];
    const client: ApplicationKubernetesSnapshotWatchClient<Entry, Query> = {
      async list(query) {
        return query.continueToken
          ? { items: [{ metadata: { name: 'grace' } }], resourceVersion: '11' }
          : { items: [{ metadata: { name: 'ada' } }], resourceVersion: '11', continueToken: 'next' };
      },
      async *watch(query) {
        expect(query).toMatchObject({ namespace: 'guestbook', resourceVersion: '11', allowBookmarks: true });
        yield* watchEvents;
      },
    };
    const authority = new ApplicationKubernetesSnapshotWatchAuthority(client, { pageSize: 1 });
    await expect(authority.snapshot({ namespace: 'guestbook' })).resolves.toEqual({
      items: [{ metadata: { name: 'ada' } }, { metadata: { name: 'grace' } }],
      resourceVersion: '11',
      pages: 2,
    });
    const events: unknown[] = [];
    await expect(authority.watch({ namespace: 'guestbook' }, '11', (event) => events.push(event))).rejects.toThrow(/ended before cancellation/);
    expect(events).toEqual([
      { kind: 'bookmark', resourceVersion: '12' },
      { kind: 'invalidate', resourceVersion: '13' },
    ]);
  });

  it('converts Kubernetes 410 compaction into an explicit reset', async () => {
    const client: ApplicationKubernetesSnapshotWatchClient<Entry, Query> = {
      async list() { return { items: [], resourceVersion: '20' }; },
      async *watch() { yield { type: 'ERROR', code: 410, message: 'too old resource version' }; },
    };
    const events: unknown[] = [];
    const authority = new ApplicationKubernetesSnapshotWatchAuthority(client);
    await authority.watch({ namespace: 'guestbook' }, '20', (event) => events.push(event));
    expect(events).toEqual([{ kind: 'reset', reason: 'resourceVersionExpired', message: 'too old resource version' }]);
  });

  it('fails closed on inconsistent pagination and bounded resource exhaustion', async () => {
    let calls = 0;
    const client: ApplicationKubernetesSnapshotWatchClient<Entry, Query> = {
      async list() {
        calls += 1;
        return { items: [{ metadata: { name: String(calls) } }], resourceVersion: String(calls), continueToken: 'more' };
      },
      async *watch() {},
    };
    const authority = new ApplicationKubernetesSnapshotWatchAuthority(client, { maxPages: 2, maxItems: 2 });
    await expect(authority.snapshot({ namespace: 'guestbook' })).rejects.toThrow(/changed resourceVersion/);

    const bounded = new ApplicationKubernetesSnapshotWatchAuthority({
      ...client,
      async list() { return { items: [{ metadata: { name: '1' } }, { metadata: { name: '2' } }], resourceVersion: '1' }; },
    }, { maxItems: 1 });
    await expect(bounded.snapshot({ namespace: 'guestbook' })).rejects.toBeInstanceOf(ApplicationKubernetesSnapshotBoundError);
  });
});
