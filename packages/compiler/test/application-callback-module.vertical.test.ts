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
