// typecast-file-boundary: router adapters expose distinct context generics reconciled only inside this portability fixture.
import { ApplicationQueryClient, installApplicationQueryClientResolver, queryInputKey, type ApplicationQuerySnapshot, type ApplicationQueryTransport } from '@applik8s/client';
import { Applik8sProvider, ApplicationQueryClientProvider, useApplicationQuery } from '@applik8s/react';
import { hydrateApplicationQueries, preloadApplicationQuery, type ApplicationQueryLoaderResult } from '@applik8s/client';
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, createStaticHandler, RouterProvider, type HydrationState, type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

describe('router-independent React query integration', () => {
  it('hydrates a TanStack Start loader snapshot without a duplicate browser fetch', async () => {
    let snapshotCalls = 0;
    const transport: ApplicationQueryTransport = {
      async snapshot<TInput, TValue>(query: string, input: TInput) {
        snapshotCalls += 1;
        // typecast: this deterministic test transport serves the one registered cards query whose TValue is asserted by the consuming hook.
        return snapshot(query, input, [{ id: 'card-1', name: 'First' }]) as ApplicationQuerySnapshot<TValue>;
      },
      subscribe() {},
    };
    const serverClient = new ApplicationQueryClient(transport);
    const rootRoute = createRootRouteWithContext<{ readonly queryClient: ApplicationQueryClient }>()({});
    const cardsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      loader: ({ context }) => preloadApplicationQuery(context.queryClient, 'cards.for-set.v1', { setId: 'set-1' }),
    });
    const router = createRouter({ routeTree: rootRoute.addChildren([cardsRoute]), context: { queryClient: serverClient }, history: createMemoryHistory({ initialEntries: ['/'] }) });
    await router.load();
    // typecast: the concrete root route loader above is the sole data-bearing route in this in-memory router fixture.
    const loaderData = router.state.matches.find((match) => match.routeId === cardsRoute.id)?.loaderData as ApplicationQueryLoaderResult;
    const browserClient = new ApplicationQueryClient(transport);
    hydrateApplicationQueries(browserClient, loaderData);

    const html = renderToString(createElement(ApplicationQueryClientProvider, { client: browserClient }, createElement(CardList)));

    expect(html).toContain('First');
    expect(snapshotCalls).toBe(1);
  });

  it('renders the same hook and component through React Router static-loader hydration', async () => {
    let loaderCalls = 0;
    const serverClient = new ApplicationQueryClient({
      async snapshot<TInput, TValue>(query: string, input: TInput) {
        loaderCalls += 1;
        // typecast: the fixture transport serves the one cards query declared by the route and component.
        return snapshot(query, input, [{ id: 'card-1', name: 'Portable' }]) as ApplicationQuerySnapshot<TValue>;
      },
      subscribe() {},
    });
    const browserTransport: ApplicationQueryTransport = { async snapshot() { throw new Error('React Router hydration must prevent a duplicate initial fetch'); }, subscribe() {} };
    const browserClient = new ApplicationQueryClient(browserTransport);
    const routes: RouteObject[] = [{ id: 'cards', path: '/', loader: () => preloadApplicationQuery(serverClient, 'cards.for-set.v1', { setId: 'set-1' }), element: createElement(ApplicationQueryClientProvider, { client: browserClient }, createElement(CardList)) }];
    const handler = createStaticHandler(routes);
    const queried = await handler.query(new Request('https://catalog.test/'));
    if (queried instanceof Response) throw new Error(`React Router fixture returned ${queried.status} instead of loader context.`);
    // typecast: React Router's static handler context is its documented hydrationData input; the public types model these equivalent structures separately.
    const router = createMemoryRouter(routes, { initialEntries: ['/'], hydrationData: queried as HydrationState });
    const hydration = queried.loaderData.cards as ApplicationQueryLoaderResult;
    hydrateApplicationQueries(browserClient, hydration);

    const html = renderToString(createElement(RouterProvider, { router }));

    expect(html).toContain('Portable');
    expect(loaderCalls).toBe(1);
  });

  it('reuses an adapter-provided request client for SSR without route-level hydration ceremony', () => {
    const requestClient = new ApplicationQueryClient({
      async snapshot() { throw new Error('SSR must reuse the already hydrated request client.'); },
      subscribe() {},
    });
    requestClient.hydrate([snapshot('cards.for-set.v1', { setId: 'set-1' }, [{ id: 'card-1', name: 'Request scoped' }])]);
    const dispose = installApplicationQueryClientResolver(() => requestClient);
    try {
      const html = renderToString(createElement(Applik8sProvider, undefined, createElement(CardList)));
      expect(html).toContain('Request scoped');
    } finally {
      dispose();
    }
  });
});

function CardList() {
  const state = useApplicationQuery<{ readonly setId: string }, readonly { readonly id: string; readonly name: string }[]>('cards.for-set.v1', { setId: 'set-1' });
  return createElement('ul', undefined, ...(state.value ?? []).map((card) => createElement('li', { key: card.id }, card.name)));
}

function snapshot<TInput, TValue>(query: string, input: TInput, value: TValue): ApplicationQuerySnapshot<TValue> {
  return {
    kind: 'snapshot',
    protocol: 'applik8s.query/v1alpha1',
    query,
    inputKey: queryInputKey(input),
    value,
    cursor: 'cursor-1',
    capability: 'resumableInvalidation',
    generatedAt: '2026-07-15T00:00:00.000Z',
  };
}
