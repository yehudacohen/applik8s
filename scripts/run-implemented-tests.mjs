import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Compiler integration files deliberately exercise full ComponentizeJS and TypeKro pipelines. Keep
// each release-gate process small and sequential so those suites cannot accumulate near Node's heap
// ceiling merely because they happened to hash into the same concurrent shard.
const shards = boundedInteger(process.env.APPLIK8S_TEST_SHARDS, 16, 'APPLIK8S_TEST_SHARDS');
const workers = boundedInteger(process.env.APPLIK8S_TEST_MAX_WORKERS, 1, 'APPLIK8S_TEST_MAX_WORKERS');
const startShard = boundedInteger(
  process.env.APPLIK8S_TEST_START_SHARD,
  1,
  'APPLIK8S_TEST_START_SHARD',
);
if (startShard > shards) {
  throw new Error('APPLIK8S_TEST_START_SHARD cannot exceed APPLIK8S_TEST_SHARDS.');
}
const maxOldSpaceSizeMb = boundedMemoryMb(
  process.env.APPLIK8S_TEST_MAX_OLD_SPACE_MB,
  8_192,
  'APPLIK8S_TEST_MAX_OLD_SPACE_MB',
);
const vitest = resolve('node_modules/vitest/vitest.mjs');

for (let shard = startShard; shard <= shards; shard += 1) {
  process.stdout.write(`\nImplemented test shard ${shard}/${shards} (${workers} workers)\n`);
  const code = await run(process.execPath, [
    `--max-old-space-size=${maxOldSpaceSizeMb}`,
    vitest,
    'run',
    `--shard=${shard}/${shards}`,
    `--maxWorkers=${workers}`,
    '--exclude=packages/compiler/test/application-workflows.vertical.test.ts',
    '--passWithNoTests',
  ]);
  if (code !== 0) process.exit(code);
}

const workflowCompilerCode = await run(process.execPath, [
  resolve('scripts/run-workflow-compiler-tests.mjs'),
]);
if (workflowCompilerCode !== 0) process.exit(workflowCompilerCode);

function boundedInteger(raw, fallback, name) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error(`${name} must be an integer between 1 and 32.`);
  }
  return value;
}

function boundedMemoryMb(raw, fallback, name) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 16_384) {
    throw new Error(`${name} must be an integer between 1024 and 16384.`);
  }
  return value;
}

function run(command, args) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, TYPEKRO_LOG_LEVEL: process.env.TYPEKRO_LOG_LEVEL ?? 'fatal' },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Implemented test shard terminated by ${signal}.`));
        return;
      }
      resolveCode(code ?? 1);
    });
  });
}
