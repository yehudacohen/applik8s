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
    '@applik8s/applik8s/reactive-runtime': fileURLToPath(new URL('./packages/applik8s/src/reactive-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/structured-generation': fileURLToPath(new URL('./packages/applik8s/src/structured-generation.ts', import.meta.url)),
    '@applik8s/applik8s/structured-generation-runtime': fileURLToPath(new URL('./packages/applik8s/src/structured-generation-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/task-operation-runtime': fileURLToPath(new URL('./packages/applik8s/src/task-operation-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/task-query-runtime': fileURLToPath(new URL('./packages/applik8s/src/task-query-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/workflow-runtime-hatchet': fileURLToPath(new URL('./packages/applik8s/src/workflow-runtime-hatchet.ts', import.meta.url)),
    '@applik8s/applik8s/factories/simple': fileURLToPath(new URL('./packages/applik8s/src/factories/simple.ts', import.meta.url)),
    '@applik8s/applik8s/factories': fileURLToPath(new URL('./packages/applik8s/src/factories.ts', import.meta.url)),
    '@applik8s/applik8s/operator': fileURLToPath(new URL('./packages/applik8s/src/operator.ts', import.meta.url)),
    '@applik8s/applik8s/typekro': fileURLToPath(new URL('./packages/applik8s/src/typekro.ts', import.meta.url)),
    '@applik8s/applik8s/dns': fileURLToPath(new URL('./packages/applik8s/src/dns.ts', import.meta.url)),
    '@applik8s/applik8s/dsl': fileURLToPath(new URL('./packages/applik8s/src/dsl.ts', import.meta.url)),
    '@applik8s/applik8s/drizzle': fileURLToPath(new URL('./packages/applik8s/src/drizzle.ts', import.meta.url)),
    '@applik8s/applik8s': fileURLToPath(new URL('./packages/applik8s/src/index.ts', import.meta.url)),
    '@applik8s/client': fileURLToPath(new URL('./packages/client/src/index.ts', import.meta.url)),
    '@applik8s/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
    '@applik8s/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
    '@applik8s/vite': fileURLToPath(new URL('./packages/vite/src/index.ts', import.meta.url)),
    '@applik8s/tanstack-start/server': fileURLToPath(new URL('./packages/tanstack-start/src/server.ts', import.meta.url)),
    '@applik8s/tanstack-start/vite': fileURLToPath(new URL('./packages/tanstack-start/src/vite.ts', import.meta.url)),
    '@applik8s/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@applik8s/sdk/schema-runtime': fileURLToPath(new URL('./packages/sdk/src/schema-runtime.ts', import.meta.url)),
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
