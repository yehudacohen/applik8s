import { describe, expect, it } from 'vitest';
import { generatedCallbackFactoryModule } from '../src/application-callback-module.js';

describe('generated callback capability bindings', () => {
  it('replaces captured imports and simple aliases with admitted runtime handles', () => {
    const source = generatedCallbackFactoryModule({
      source: `async () => {
        AccountChanged.emit({ accountId: "one" });
        await CreateCredentialLink({ accountId: "one" });
      }`,
      dependencies: {
        source: `
          import { AccountChanged, unrelated } from "./events.js";
          const CreateCredentialLink = CredentialLink.create;
          const keep = unrelated;
        `,
        resolveDir: '/workspace/application',
      },
      injectedIdentifiers: ['AccountChanged', 'CreateCredentialLink'],
      exportName: 'createCallback',
    });

    expect(source).not.toContain('import { AccountChanged');
    expect(source).not.toContain('CredentialLink.create');
    expect(source).not.toContain('unrelated');
    expect(source).toContain(
      'const AccountChanged = __applik8sBindings["AccountChanged"]',
    );
    expect(source).toContain(
      'const CreateCredentialLink = __applik8sBindings["CreateCredentialLink"]',
    );
  });

  it('overlays admitted nested handles without hiding maintained module functions', async () => {
    const source = generatedCallbackFactoryModule({
      source: `async () => {
        const checkout = await Billing.startCheckout({ plan: "team" });
        const subscriptions = await Billing.Subscription.find({ limit: 1 });
        return { checkout, subscriptions };
      }`,
      dependencies: {
        source: 'import { Billing } from "./modules.js";',
        resolveDir: '/workspace/application',
      },
      injectedIdentifiers: ['Billing'],
      injectedBindingPaths: ['Billing.Subscription.find'],
      exportName: 'createCallback',
    });

    expect(source).toContain(
      'import { Billing as __applik8sCapturedBilling } from "/workspace/application/modules.js"',
    );
    expect(source).toContain(
      'const Billing = __applik8sMergeCapturedBinding(__applik8sCapturedBilling, __applik8sBindings["Billing"])',
    );
    expect(source).toContain('Billing.startCheckout');
    expect(source).toContain('Billing.Subscription.find');

    const executable = source
      .replace(
        'import { Billing as __applik8sCapturedBilling } from "/workspace/application/modules.js";',
        `const __applik8sCapturedBilling = Object.freeze({
          startCheckout: async input => ({ mode: "simulated", plan: input.plan }),
          Subscription: Object.freeze({ authored: true }),
        });`,
      )
      .replace('export function createCallback', 'function createCallback');
    // typecast: dynamically evaluated generated factory is narrowed to its emitted contract.
    const createCallback = Function(`${executable}\nreturn createCallback;`)() as (
      bindings: Readonly<Record<string, unknown>>,
    ) => () => Promise<unknown>;
    const callback = createCallback({
      Billing: {
        Subscription: {
          find: async () => [{ value: { planId: 'team' } }],
        },
      },
    });
    await expect(callback()).resolves.toEqual({
      checkout: { mode: 'simulated', plan: 'team' },
      subscriptions: [{ value: { planId: 'team' } }],
    });
  });

  it('places recursive helpers inside the admitted runtime binding scope', async () => {
    const source = generatedCallbackFactoryModule({
      source: 'async input => helper(input)',
      dependencies: {
        source: `
          async function helper(input) {
            await workflow.emitSignal(DecisionSignal, { input });
            return FinalizeDecision(input);
          }
        `,
        resolveDir: '/workspace/application',
      },
      injectedIdentifiers: [
        'workflow',
        'DecisionSignal',
        'FinalizeDecision',
      ],
      exportName: 'createCallback',
    });

    // The test evaluates generated source dynamically.
    // typecast: narrow its known factory contract to assert runtime binding behavior.
    const createCallback = Function(
      `${source.replace('export function createCallback', 'function createCallback')}\nreturn createCallback;`,
    )() as (bindings: Readonly<Record<string, unknown>>) =>
      (input: { readonly id: string }) => Promise<unknown>;
    const issued: unknown[] = [];
    const callback = createCallback({
      workflow: {
        async emitSignal(signal: unknown, options: unknown) {
          issued.push({ signal, options });
        },
      },
      DecisionSignal: { id: 'decision.v1' },
      FinalizeDecision: (input: unknown) => ({ finalized: input }),
    });

    await expect(callback({ id: 'review-1' })).resolves.toEqual({
      finalized: { id: 'review-1' },
    });
    expect(issued).toEqual([
      {
        signal: { id: 'decision.v1' },
        options: { input: { id: 'review-1' } },
      },
    ]);
  });

  it('retains only the transitive helper slice instead of executing the authoring module', () => {
    const source = generatedCallbackFactoryModule({
      source: 'async input => normalize(input)',
      dependencies: {
        source: `
          import { type } from "arktype";
          import { module, application } from "@applik8s/applik8s";
          import { normalizeText, unusedHelper } from "./helpers.js";
          const unusedContract = type({ id: "string" });
          const feature = module("documents", current => {
            current.task("background", unusedHelper);
          });
          const { Document } = application.include(feature);
          function normalize(input) {
            return normalizeText(input);
          }
        `,
        resolveDir: '/workspace/application',
      },
      injectedIdentifiers: [],
      exportName: 'createCallback',
    });

    expect(source).toContain('import { normalizeText }');
    expect(source).toContain('function normalize');
    expect(source).not.toContain('unusedHelper');
    expect(source).not.toContain('unusedContract');
    expect(source).not.toContain('application.include');
    expect(source).not.toContain('module("documents"');
  });

  it('narrows the public DSL schema re-export to ArkType in deployed callbacks', () => {
    const source = generatedCallbackFactoryModule({
      source: 'async input => Payload.assert(input)',
      dependencies: {
        source: `
          import { event, type as defineType } from '@applik8s/applik8s/dsl';
          const Payload = defineType({ id: 'string' });
          const unused = event('unused.v1', Payload);
        `,
        resolveDir: '/workspace/application',
      },
      injectedIdentifiers: [],
      exportName: 'createCallback',
    });

    expect(source).toContain("import { type as defineType } from \"arktype\"");
    expect(source).not.toContain('@applik8s/applik8s/dsl');
    expect(source).not.toContain('event');
    expect(source).not.toContain('unused');
  });

  it('continues to fail closed for an executable helper collision', () => {
    expect(() =>
      generatedCallbackFactoryModule({
        source: `async () => helper()`,
        dependencies: {
          source: `function helper() { return "module-local"; }`,
          resolveDir: '/workspace/application',
        },
        injectedIdentifiers: ['helper'],
        exportName: 'createCallback',
      }),
    ).toThrow(/cannot bind helper/);
  });

  it('removes a provenance-proven authoring facade without replaying its setup', () => {
    const source = generatedCallbackFactoryModule({
      source: 'async input => helper(input)',
      dependencies: {
        source: `
          const application = createApplication();
          const { acquire } = application.include(acquisition);
          async function helper(input) {
            return acquire(input);
          }
        `,
        resolveDir: '/workspace/application',
      },
      injectedIdentifiers: ['acquire'],
      replacedCapturedIdentifiers: ['acquire'],
      exportName: 'createCallback',
    });

    expect(source).toContain('function helper');
    expect(source).toContain(
      'const acquire = __applik8sBindings["acquire"]',
    );
    expect(source).not.toContain('application.include');
    expect(source).not.toContain('createApplication');
  });

  it('fails closed when a retained dependency tries to reconstruct an application handle', () => {
    expect(() =>
      generatedCallbackFactoryModule({
        source: 'async () => RecentSubscriptions({})',
        dependencies: {
          source: `
            const RecentSubscriptions = Billing.Subscription.view(
              { input: Input, output: Output, database },
              async (_input, context) => context.database(database).select(),
            );
          `,
          resolveDir: '/workspace/application',
        },
        injectedIdentifiers: ['Billing'],
        exportName: 'createCallback',
      }),
    ).toThrow(/cannot reconstruct module-local application handle RecentSubscriptions declared with \.view\(\)/);
  });
});
