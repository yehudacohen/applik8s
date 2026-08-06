import { describe, expect, it } from 'vitest';
import { applicationCallbackSourceMatchesRuntime } from '../src/application-callback-source-equivalence';
import { analyzeApplicationServerRouteSource, applicationRouteSourceDependencies, extractApplicationCallArgumentSource, extractApplicationCallObjectFunctionSource, unsupportedRouteFreeIdentifiers } from '../src/application-route-source';

const sourceRegistrar = {
  register(_options: unknown) {
    return extractApplicationCallObjectFunctionSource('register', 0, 'deployment.authenticate');
  },
};

function workflowSource(
  _id: string,
  _contract: object,
  _options: object,
  _handler: (...args: never[]) => unknown,
) {
  return extractApplicationCallArgumentSource('workflowSource', 3);
}

describe('application callback lexical analysis', () => {
  it('keeps local array/object destructuring and standard collection use inside the generated closure', () => {
    const source = `async ({ context, input }) => {
      const [followed, blocked, muted] = await Promise.all([load(input)]);
      const hidden = new Set([...blocked, ...muted].map(({ id }) => id));
      const counts = new Map(followed.map(({ id }) => [id, 1]));
      const weak = new WeakMap();
      const seen = new WeakSet();
      const authors = followed.map(({ id: accountId }) => accountId).filter((id) => !hidden.has(id));
      return context.read(authors, counts, weak, seen);
    }`;
    expect(unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), new Set())).toEqual(['load']);
  });

  it('treats dynamic import as syntax rather than a captured identifier', () => {
    const source = `async request => {
      const runtime = await import('@applik8s/start-agentic/identity-runtime');
      return runtime.authenticateAgenticProfileRequest(request, 'dedicated');
    }`;
    expect(
      unsupportedRouteFreeIdentifiers(
        analyzeApplicationServerRouteSource(source),
        new Set(),
      ),
    ).toEqual([]);
  });

  it('captures typed transitive helpers whose function signatures contain object defaults', () => {
    const source = 'async (request) => authenticateWithHelpers(request)';
    const dependencies = applicationRouteSourceDependencies({
      id: 'identity', method: 'POST', path: '/IdentityProvider/authenticate',
      handlerSource: source,
      handlerSourceKind: 'source',
      handlerSourceLocation: {
        file: new URL('./fixtures/identity-provider-helpers.ts', import.meta.url).pathname,
        line: 6,
        column: 1,
      },
    }, ['authenticateWithHelpers'], new Set());

    expect(dependencies?.source).toContain('async function authenticateWithHelpers(request, options = {})');
    expect(dependencies?.source).toContain('async function fetchIdentity');
    expect(dependencies?.source).toContain('function normalizeIdentity');
    expect(dependencies?.source).toContain('AbortSignal.timeout');
    expect(dependencies?.source).not.toContain('IdentityOptions');
    expect(dependencies?.resolveDir).toBe(new URL('./fixtures', import.meta.url).pathname.replace(/\/$/, ''));
  });

  it('extracts function-valued properties nested inside registrar options', () => {
    const extracted = sourceRegistrar.register({
      deployment: {
        authenticate: async (request: Request) => ({ principal: request.headers.get('x-principal') }),
      },
    });

    expect(extracted?.source).toContain('async (request) =>');
    expect(extracted?.source).toContain("request.headers.get(\"x-principal\")");
    expect(extracted?.location.file).toBe(import.meta.filename);
  });

  it('extracts the fourth-argument handler from an unqualified function-native registrar', () => {
    const extracted = workflowSource(
      'timeline.rebuild.v1',
      {},
      { retries: 3 },
      async ({ generation }: { generation: string }) => ({ generation }),
    );

    expect(extracted?.source).toContain('async ({ generation }) =>');
    expect(extracted?.source).toContain('({ generation })');
    expect(extracted?.location.file).toBe(import.meta.filename);
  });

  it('matches Vite SSR import wrappers to the exact authored imported export', () => {
    const authored = 'async input => HomeTimeline.rebuild(input)';
    const runtime = 'async input => __vite_ssr_import_2__.HomeTimeline.rebuild(input)';

    expect(applicationCallbackSourceMatchesRuntime(authored, runtime)).toBe(true);
    expect(applicationCallbackSourceMatchesRuntime(
      authored,
      'async input => __vite_ssr_import_2__.OtherTimeline.rebuild(input)',
    )).toBe(false);
  });
});
