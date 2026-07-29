import { fileURLToPath, URL } from 'node:url';

/**
 * Resolve workspace packages to source consistently in every Vitest profile.
 *
 * Public subpaths must precede their umbrella package so adding a new entrypoint
 * cannot work in vertical tests while failing in character or live tests.
 */
export function workspaceAliases(): Record<string, string> {
  return {
    '@applik8s/applik8s/deployment-registry': fileURLToPath(new URL('./packages/applik8s/src/deployment-registry.ts', import.meta.url)),
    '@applik8s/applik8s/processor-runtime': fileURLToPath(new URL('./packages/applik8s/src/processor-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/event-log-runtime': fileURLToPath(new URL('./packages/applik8s/src/event-log-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/postgres-runtime-contract': fileURLToPath(new URL('./packages/applik8s/src/postgres-runtime-contract.ts', import.meta.url)),
    '@applik8s/applik8s/reactive-runtime': fileURLToPath(new URL('./packages/applik8s/src/reactive-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/structured-generation': fileURLToPath(new URL('./packages/applik8s/src/structured-generation.ts', import.meta.url)),
    '@applik8s/applik8s/structured-generation-runtime': fileURLToPath(new URL('./packages/applik8s/src/structured-generation-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/task-operation-runtime': fileURLToPath(new URL('./packages/applik8s/src/task-operation-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/task-query-runtime': fileURLToPath(new URL('./packages/applik8s/src/task-query-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/factories/simple': fileURLToPath(new URL('./packages/applik8s/src/factories/simple.ts', import.meta.url)),
    '@applik8s/applik8s/factories': fileURLToPath(new URL('./packages/applik8s/src/factories.ts', import.meta.url)),
    '@applik8s/applik8s/operator': fileURLToPath(new URL('./packages/applik8s/src/operator.ts', import.meta.url)),
    '@applik8s/applik8s/typekro': fileURLToPath(new URL('./packages/applik8s/src/typekro.ts', import.meta.url)),
    '@applik8s/applik8s/dns': fileURLToPath(new URL('./packages/applik8s/src/dns.ts', import.meta.url)),
    '@applik8s/applik8s/dsl': fileURLToPath(new URL('./packages/applik8s/src/dsl.ts', import.meta.url)),
    '@applik8s/applik8s/drizzle': fileURLToPath(new URL('./packages/applik8s/src/drizzle.ts', import.meta.url)),
    '@applik8s/applik8s': fileURLToPath(new URL('./packages/applik8s/src/index.ts', import.meta.url)),
    '@applik8s/cli': fileURLToPath(new URL('./packages/cli/src/cli.ts', import.meta.url)),
    '@applik8s/client': fileURLToPath(new URL('./packages/client/src/index.ts', import.meta.url)),
    '@applik8s/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
    '@applik8s/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
    '@applik8s/vite': fileURLToPath(new URL('./packages/vite/src/index.ts', import.meta.url)),
    '@applik8s/tanstack-start/server': fileURLToPath(new URL('./packages/tanstack-start/src/server.ts', import.meta.url)),
    '@applik8s/tanstack-start/vite': fileURLToPath(new URL('./packages/tanstack-start/src/vite.ts', import.meta.url)),
    '@applik8s/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@applik8s/deployment-contract': fileURLToPath(new URL('./packages/deployment-contract/src/index.ts', import.meta.url)),
    '@applik8s/deployment-compiler': fileURLToPath(new URL('./packages/deployment-compiler/src/index.ts', import.meta.url)),
    '@applik8s/deployment-typekro': fileURLToPath(new URL('./packages/deployment-typekro/src/index.ts', import.meta.url)),
    '@applik8s/deployment-provider-harbor': fileURLToPath(new URL('./packages/deployment-provider-harbor/src/index.ts', import.meta.url)),
    '@applik8s/deployment-provider-kubernetes': fileURLToPath(new URL('./packages/deployment-provider-kubernetes/src/index.ts', import.meta.url)),
    '@applik8s/deployment-provider-oci': fileURLToPath(new URL('./packages/deployment-provider-oci/src/index.ts', import.meta.url)),
    '@applik8s/deployment-alchemy': fileURLToPath(new URL('./packages/deployment-alchemy/src/index.ts', import.meta.url)),
    '@applik8s/sdk/schema-runtime': fileURLToPath(new URL('./packages/sdk/src/schema-runtime.ts', import.meta.url)),
    '@applik8s/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    '@applik8s/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    '@applik8s/compiler/diagnostics': fileURLToPath(new URL('./packages/compiler/src/diagnostics/index.ts', import.meta.url)),
    '@applik8s/compiler/kubernetes-schema': fileURLToPath(new URL('./packages/compiler/src/kubernetes-schema/index.ts', import.meta.url)),
    '@applik8s/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
    '@applik8s/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    '@applik8s/runtime-s3': fileURLToPath(new URL('./packages/runtime-s3/src/index.ts', import.meta.url)),
    '@applik8s/runtime-hatchet': fileURLToPath(new URL('./packages/runtime-hatchet/src/index.ts', import.meta.url)),
    '@applik8s/runtime-nats/event-log': fileURLToPath(new URL('./packages/runtime-nats/src/event-log.ts', import.meta.url)),
    '@applik8s/runtime-nats/command-processor': fileURLToPath(new URL('./packages/runtime-nats/src/command-processor.ts', import.meta.url)),
    '@applik8s/runtime-nats': fileURLToPath(new URL('./packages/runtime-nats/src/index.ts', import.meta.url)),
    '@applik8s/runtime-kubernetes': fileURLToPath(new URL('./packages/runtime-kubernetes/src/index.ts', import.meta.url)),
    '@applik8s/runtime-postgres': fileURLToPath(new URL('./packages/runtime-postgres/src/index.ts', import.meta.url)),
    '@applik8s/runtime-contract': fileURLToPath(new URL('./packages/runtime-contract/src/index.ts', import.meta.url)),
    '@applik8s/typekro-adapter': fileURLToPath(new URL('./packages/typekro-adapter/src/index.ts', import.meta.url)),
    '@applik8s/typetainer': fileURLToPath(new URL('./packages/typetainer/src/index.ts', import.meta.url)),
  };
}
