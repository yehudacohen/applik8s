import { spawnSync } from 'node:child_process';

const shards = [
  [
    'packages/core/test/application-telemetry.vertical.test.ts',
    'packages/applik8s/test/application-observability.vertical.test.ts',
    'packages/applik8s/test/application-actors.vertical.test.ts',
    'packages/applik8s/test/application-workflows.vertical.test.ts',
    'packages/applik8s/test/command-gateway.vertical.test.ts',
    'packages/applik8s/test/query-gateway.vertical.test.ts',
    'packages/applik8s/test/event-log-runtime.vertical.test.ts',
    'packages/applik8s/test/application-lakehouse.vertical.test.ts',
    'packages/applik8s/test/stream-processor-runtime.vertical.test.ts',
    'packages/applik8s/test/stream-runtime-postgres.vertical.test.ts',
    'packages/applik8s/test/task-operation-runtime.vertical.test.ts',
  ],
  [
    'packages/server/test/kubernetes-gateway.vertical.test.ts',
    'packages/runtime-celld/test/runtime-celld.vertical.test.ts',
    'packages/runtime-hatchet/test/runtime.vertical.test.ts',
    'packages/runtime-nats/test/command-processor.vertical.test.ts',
    'packages/runtime-nats/test/event-consumer.vertical.test.ts',
    'packages/runtime-aws/test/runtime.vertical.test.ts',
    'packages/runtime-otel/test/runtime.vertical.test.ts',
    'packages/runtime-otel/test/custom-trust-live.vertical.test.ts',
  ],
  [
    'packages/deployment-compiler/test/local-supervisor-plan.vertical.test.ts',
    'packages/deployment-compiler/test/aws-deployment-plan.vertical.test.ts',
    'packages/deployment-typekro/test/deployment-typekro.vertical.test.ts',
    'packages/deployment-alchemy/test/aws-native-resources.vertical.test.ts',
  ],
  [
    'packages/compiler/test/application-fetch-gateway.vertical.test.ts',
    'packages/compiler/test/application-http.vertical.test.ts',
  ],
  ['packages/compiler/test/application-reactive.vertical.test.ts'],
  [
    'packages/compiler/test/application-lakehouse-publications.vertical.test.ts',
    'packages/compiler/test/application-workflows.vertical.test.ts',
    'packages/core/test/application-foundation.vertical.test.ts',
  ],
  [
    'packages/ai/test/runtime.vertical.test.ts',
    'packages/runtime-ai/test/agent-gateway.vertical.test.ts',
    'packages/runtime-ai/test/operation-executor.vertical.test.ts',
    'packages/runtime-ai/test/runtime.vertical.test.ts',
    'packages/compiler/test/application-agents.vertical.test.ts',
  ],
];

for (const [index, files] of shards.entries()) {
  console.log(`\n[v0.8 observability] shard ${index + 1}/${shards.length}: ${files.length} file(s)`);
  const result = spawnSync(
    'bunx',
    ['vitest', 'run', '--maxWorkers=1', ...files],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
