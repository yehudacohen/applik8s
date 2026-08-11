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
    expect(source).toContain('import { unrelated }');
    expect(source).toContain(
      'const AccountChanged = __applik8sBindings["AccountChanged"]',
    );
    expect(source).toContain(
      'const CreateCredentialLink = __applik8sBindings["CreateCredentialLink"]',
    );
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
});
