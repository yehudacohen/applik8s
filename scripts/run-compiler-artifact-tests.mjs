import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ComponentizeJS and full application discovery intentionally exercise large
// compiler graphs. V8 retains compiled script data for the life of one test
// worker, so running this historical monolith in one process can exceed the
// pointer-compressed heap even though each case is bounded. Keep the source
// fixture intact, but execute small deterministic name groups in fresh workers.
const file = 'packages/compiler/test/compiler-artifacts.vertical.test.ts';
const source = await readFile(resolve(file), 'utf8');
const names = [...source.matchAll(/^\s+it\('([^']+)'/gmu)].map((match) => match[1]);
if (names.length === 0) throw new Error(`${file} contains no statically named tests.`);
if (new Set(names).size !== names.length) throw new Error(`${file} contains duplicate test names.`);

const chunkSize = 8;
const vitest = resolve('node_modules/vitest/vitest.mjs');
for (let offset = 0; offset < names.length; offset += chunkSize) {
  const chunk = names.slice(offset, offset + chunkSize);
  const pattern = `(?:${chunk.map(escapeRegex).join('|')})$`;
  process.stdout.write(`\nCompiler artifact group ${Math.floor(offset / chunkSize) + 1}/${Math.ceil(names.length / chunkSize)} (${chunk.length} tests)\n`);
  const code = await run(process.execPath, [
    '--max-old-space-size=8192',
    vitest,
    'run',
    file,
    '--maxWorkers=1',
    '--testNamePattern',
    pattern,
  ]);
  if (code !== 0) process.exit(code);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
        reject(new Error(`Compiler artifact test group terminated by ${signal}.`));
        return;
      }
      resolveCode(code ?? 1);
    });
  });
}
