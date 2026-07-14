import { fileURLToPath, URL } from 'node:url';

/**
 * Resolve workspace packages to source consistently in every Vitest profile.
 *
 * Public subpaths must precede their umbrella package so adding a new entrypoint
 * cannot work in vertical tests while failing in character or live tests.
 */
export function workspaceAliases(): Record<string, string> {
  return {
    '@applik8s/applik8s/processor-runtime': fileURLToPath(new URL('./packages/applik8s/src/processor-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/factories/simple': fileURLToPath(new URL('./packages/applik8s/src/factories/simple.ts', import.meta.url)),
    '@applik8s/applik8s/factories': fileURLToPath(new URL('./packages/applik8s/src/factories.ts', import.meta.url)),
    '@applik8s/applik8s/operator': fileURLToPath(new URL('./packages/applik8s/src/operator.ts', import.meta.url)),
    '@applik8s/applik8s/typekro': fileURLToPath(new URL('./packages/applik8s/src/typekro.ts', import.meta.url)),
    '@applik8s/applik8s/dns': fileURLToPath(new URL('./packages/applik8s/src/dns.ts', import.meta.url)),
    '@applik8s/applik8s/dsl': fileURLToPath(new URL('./packages/applik8s/src/dsl.ts', import.meta.url)),
    '@applik8s/applik8s': fileURLToPath(new URL('./packages/applik8s/src/index.ts', import.meta.url)),
    '@applik8s/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@applik8s/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    '@applik8s/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    '@applik8s/compiler/kubernetes-schema': fileURLToPath(new URL('./packages/compiler/src/kubernetes-schema/index.ts', import.meta.url)),
    '@applik8s/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
    '@applik8s/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    '@applik8s/runtime-contract': fileURLToPath(new URL('./packages/runtime-contract/src/index.ts', import.meta.url)),
    '@applik8s/typekro-adapter': fileURLToPath(new URL('./packages/typekro-adapter/src/index.ts', import.meta.url)),
    '@applik8s/typetainer': fileURLToPath(new URL('./packages/typetainer/src/index.ts', import.meta.url)),
    'typekro/advanced': fileURLToPath(new URL('../typekro/src/advanced/index.ts', import.meta.url)),
  };
}
