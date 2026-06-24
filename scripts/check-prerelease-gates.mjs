import { spawn } from 'node:child_process';

const liveEnabled = process.env.APPLIK8S_RELEASE_LIVE_E2E === '1';
const allowSkipLive = process.env.APPLIK8S_RELEASE_ALLOW_SKIP_LIVE_E2E === '1';

const localGates = [
  ['bun', ['run', 'check:local']],
  ['bun', ['run', 'check:release']],
];

const liveGates = [
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/generated-artifacts.e2e.test.ts']],
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/crd-schema-acceptance.e2e.test.ts']],
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/live-reconcile.e2e.test.ts']],
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/typekro-operation-target.e2e.test.ts']],
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/typekro-deploy.e2e.test.ts']],
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/live-adversarial-suite.e2e.test.ts']],
  ['bunx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/live-partial-operation-failure.e2e.test.ts']],
];

for (const [command, args] of localGates) {
  const code = await run(command, args, process.env);
  if (code !== 0) {
    process.exitCode = code;
    process.exit();
  }
}

if (!liveEnabled) {
  const message = 'Pre-release live E2E gates require APPLIK8S_RELEASE_LIVE_E2E=1 and APPLIK8S_E2E_CONTEXT=<context>.';
  if (allowSkipLive) {
    console.warn(`${message} Skipping because APPLIK8S_RELEASE_ALLOW_SKIP_LIVE_E2E=1.`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

if (!process.env.APPLIK8S_E2E_CONTEXT) {
  console.error('APPLIK8S_E2E_CONTEXT must name the Kubernetes context used for v0.1 pre-release validation.');
  process.exit(1);
}

const liveEnv = { ...process.env, APPLIK8S_E2E: '1', APPLIK8S_E2E_LIVE: '1', APPLIK8S_E2E_TYPEKRO: '1' };
for (const [command, args] of liveGates) {
  const code = await run(command, args, liveEnv);
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}

function run(command, args, env) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
