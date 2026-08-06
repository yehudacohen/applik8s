import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Every case imports a different generated application bundle. Native ESM
// retains those modules for the lifetime of its process, so running the whole
// file in one worker makes memory proportional to the number of fixtures
// rather than to one compiler invocation. Process isolation is the bounded
// test contract; increasing Node's heap would only move the failure threshold.
const file = 'packages/compiler/test/application-workflows.vertical.test.ts';
const cases = [
  'delegates Hatchet infrastructure and emits only the production worker lifecycle',
  'lowers workflow.emitSignal as a compiler-known durable capability without bundling the application registrar',
  'uses the provisioned Hatchet chart worker-token Secret by default',
  'lowers a typed online-projection rebuild into the workflow worker',
  'rejects external effects hidden in module-scope workflow helpers',
  'fails closed when KEDA task-stat scaling cannot name a Hatchet tenant',
  'binds an externally managed Hatchet runtime without generating provider infrastructure',
];
const vitest = resolve('node_modules/vitest/vitest.mjs');

for (const name of cases) {
  process.stdout.write(`\nWorkflow compiler case: ${name}\n`);
  const code = await run(process.execPath, [
    vitest,
    'run',
    file,
    '--maxWorkers=1',
    '--testNamePattern',
    escapeRegularExpression(name),
  ]);
  if (code !== 0) process.exit(code);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function run(command, args) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TYPEKRO_LOG_LEVEL: process.env.TYPEKRO_LOG_LEVEL ?? 'fatal',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Workflow compiler test terminated by ${signal}.`));
        return;
      }
      resolveCode(code ?? 1);
    });
  });
}
