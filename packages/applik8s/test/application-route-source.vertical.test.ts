import { describe, expect, it } from 'vitest';
import { serializeApplicationCallback as AliasedSerializeCallback } from '../src/application-callback';
import { applicationCallbackSourceMatchesRuntime } from '../src/application-callback-source-equivalence';
import { analyzeApplicationServerRouteSource, applicationRouteSourceDependencies, extractApplicationCallArgumentSource, extractApplicationCallObjectFunctionSource, transpileApplicationCallbackExpression, unsupportedRouteFreeIdentifiers } from '../src/application-route-source';

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
  it('accepts only the intrinsic Error constructor normalization', () => {
    const authored = 'async input => { if (!input.ok) throw new Error("missing"); return input; }';
    const runtime = 'async input => { if (!input.ok) throw Error("missing"); return input; }';

    expect(applicationCallbackSourceMatchesRuntime(authored, runtime)).toBe(true);
    expect(applicationCallbackSourceMatchesRuntime(
      authored.replace('new Error', 'new Date'),
      runtime.replace('Error', 'Date'),
    )).toBe(false);
    expect(applicationCallbackSourceMatchesRuntime(
      authored.replace('new Error', 'new DomainError'),
      runtime.replace('Error', 'DomainError'),
    )).toBe(false);
  });

  it('does not invoke a build-tool transform for already-valid runtime JavaScript', () => {
    expect(transpileApplicationCallbackExpression(
      'async input => ({ id: input.id })',
    )).toBe('async input => ({ id: input.id })');
  });

  it('erases authored TypeScript callback annotations on the authoring host', () => {
    const transpiled = transpileApplicationCallbackExpression(
      'async (input: { id: string }): Promise<string> => input.id',
    );
    expect(transpiled).toContain('async');
    expect(transpiled).toContain('input.id');
    expect(transpiled).not.toContain(': string');
    expect(() => Function(`return (${transpiled});`)).not.toThrow();
  });

  it('treats captured class members and constructor parameters as declarations', () => {
    const analysis = analyzeApplicationServerRouteSource(`
class DeliveryError extends Error {
  outcome;
  constructor(outcome, message, options) {
    super(message, options);
    this.name = 'DeliveryError';
    this.outcome = outcome;
  }
}
`);

    expect(unsupportedRouteFreeIdentifiers(analysis, new Set())).toEqual([]);
  });

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

  it('keeps parameters of nested function declarations inside captured handle registrations', () => {
    const source = `const finalize = workflow(
      'review.finalize.v1',
      {},
      async function persistDecision(input, { receipt }) {
        return { id: input.id, receipt };
      },
    );`;

    expect(
      unsupportedRouteFreeIdentifiers(
        analyzeApplicationServerRouteSource(source),
        new Set(),
      ),
    ).toEqual(['workflow']);
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

  it('recovers later top-level helpers without promoting template or regex text', () => {
    const file = new URL(
      './fixtures/application-route-late-helper.ts',
      import.meta.url,
    ).pathname;
    const dependencies = applicationRouteSourceDependencies({
      id: 'late-helper',
      method: 'POST',
      path: '/late-helper',
      handlerSource: 'async input => routeCallback(input)',
      handlerSourceKind: 'source',
      handlerSourceLocation: { file, line: 6, column: 1 },
    }, ['routeCallback'], new Set());

    expect(dependencies?.source).toContain('function routeCallback');
    expect(dependencies?.source).toContain('function lateHelper');
    expect(dependencies?.source).not.toContain('function notARealHelper');
    expect(dependencies?.source).not.toContain('function alsoNotARealHelper');
  });

  it('keeps direct workflow and signal handles executable without attributing child effects to orchestration', () => {
    const dependencies = applicationRouteSourceDependencies({
      id: 'review',
      method: 'POST',
      path: '/workflow/review',
      handlerSource: 'async input => workflowCallback(input)',
      handlerSourceKind: 'source',
      handlerSourceLocation: {
        file: new URL(
          './fixtures/application-workflow-helper-dependencies.ts',
          import.meta.url,
        ).pathname,
        line: 27,
        column: 1,
      },
    }, ['workflowCallback'], new Set());

    expect(dependencies?.source).toContain('const Review = workflow.signal');
    expect(dependencies?.source).toContain('const persist = workflow(');
    expect(dependencies?.source).toContain('toISOString()');
    expect(dependencies?.analysisSource).toContain('async function coordinate');
    expect(dependencies?.analysisSource).not.toContain('toISOString()');
    expect(dependencies?.analysisSource).not.toContain('database');
  });

  it('preserves a maintained module provider prerequisite independent of its local name', () => {
    const dependencies = applicationRouteSourceDependencies({
      id: 'billing-usage',
      method: 'POST',
      path: '/billing/usage',
      handlerSource: 'async input => Billing.reportUsage(input)',
      handlerSourceKind: 'source',
      handlerSourceLocation: {
        file: new URL(
          './fixtures/application-module-prerequisites.ts',
          import.meta.url,
        ).pathname,
        line: 6,
        column: 1,
      },
    }, ['Billing'], new Set());

    expect(dependencies?.source).toMatch(
      /import \{ providers \} from ['"]\.\/application-provider-profile['"]/,
    );
    expect(dependencies?.source).toContain(
      'const primaryStore = providers.database',
    );
    expect(dependencies?.source).toContain(
      'const Billing = application.include(billing)',
    );
  });

  it('replays only the exhaustive profile setup required by an injected provider operation', () => {
    const dependencies = applicationRouteSourceDependencies({
      id: 'provider-operation',
      method: 'POST',
      path: '/provider/acquire',
      handlerSource: 'async input => acquire(input)',
      handlerSourceKind: 'source',
      handlerSourceLocation: {
        file: new URL(
          './fixtures/application-provider-callback-dependencies.ts',
          import.meta.url,
        ).pathname,
        line: 74,
        column: 1,
      },
    }, ['acquire'], new Set(), [
      'provider.primary-provider.v1alpha1.active',
    ]);

    const source = dependencies?.source ?? '';
    expect(source).toMatch(
      /const deployment = application\.profile\(application\.installation\.spec, ['"]profile['"]\)/,
    );
    expect(source).toContain('.provide(PrimaryProvider)');
    expect(source).toMatch(/primaryImplementation\(['"]dedicated['"]\)/);
    expect(source).toContain('const primary = application.inject(PrimaryProvider)');
    expect(source.indexOf('.provide(PrimaryProvider)')).toBeLessThan(
      source.indexOf('application.inject(PrimaryProvider)'),
    );
    expect(source).not.toContain('.provide(SecondaryProvider)');
    expect(source).not.toContain('secondary-dedicated');
  });

  it('extracts function-valued properties nested inside registrar options', () => {
    const extracted = sourceRegistrar.register({
      deployment: {
        authenticate: async (request: Request) => ({ principal: request.headers.get('x-principal') }),
      },
    });

    expect(extracted?.source).toMatch(/async\s*\(request\)\s*=>/);
    expect(extracted?.source).toMatch(/request\.headers\.get\(['"]x-principal['"]\)/);
    expect(extracted?.location.file).toBe(import.meta.filename);
  });

  it('extracts the fourth-argument handler from an unqualified function-native registrar', () => {
    const extracted = workflowSource(
      'timeline.rebuild.v1',
      {},
      { retries: 3 },
      async ({ generation }: { generation: string }) => ({ generation }),
    );

    expect(extracted?.source).toMatch(/async\s*\(\{ generation \}\)\s*=>/);
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

  it('normalizes Vite SSR import wrappers before closure discovery', () => {
    const analysis = analyzeApplicationServerRouteSource(
      'async () => __vite_ssr_import_7__.ArtifactObjects.head("source")',
    );
    expect(analysis.freeIdentifiers).toContain('ArtifactObjects');
    expect(analysis.freeIdentifiers).not.toContain('__vite_ssr_import_7__');
    expect(analysis.memberCalls).toContainEqual({
      objectName: 'ArtifactObjects',
      methodName: 'head',
    });
  });

  it('recovers authored aliases from Vite SSR named-import wrappers', () => {
    void AliasedSerializeCallback;
    expect(applicationCallbackSourceMatchesRuntime(
      'async input => AliasedSerializeCallback(input)',
      'async input => __vite_ssr_import_9__.serializeApplicationCallback(input)',
      import.meta.filename,
    )).toBe(true);
  });

  it('does not persist compiler discovery scratch paths as callback provenance', () => {
    const callback = async (input: string) => input;
    Object.defineProperty(
      callback,
      Symbol.for('applik8s.applicationCallbackSource'),
      {
        value: {
          file: 'file:///workspace/.applik8s-tmp/discovery-42-1234/entrypoint.mjs?applik8s=5678',
          line: 10,
          column: 4,
          source: 'async input => input',
        },
      },
    );

    const serialized = AliasedSerializeCallback({
      registrar: 'IdentityProvider',
      argumentIndex: 0,
      property: 'authenticate',
      label: 'temporary discovery callback',
      callback,
    });
    expect(serialized.location).toBeUndefined();
    expect(serialized.source).toContain('async');
  });
});
