import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Vitest 4 retains the transformed Nitro/Vite module graph between cases.
// Every case is independently valuable, but one worker running the whole file
// grows beyond Node's heap ceiling. Execute small deterministic groups in
// fresh workers so the release gate remains bounded and reproducible.
const file = 'packages/vite/test/vite.vertical.test.ts';
const source = await readFile(resolve(file), 'utf8');
const names = [...source.matchAll(/^\s+it\('([^']+)'/gmu)].map(match => match[1]);
if (names.length === 0) throw new Error(`${file} contains no statically named tests.`);
if (new Set(names).size !== names.length) throw new Error(`${file} contains duplicate test names.`);

const chunkSize = 2;
const vitest = resolve('node_modules/vitest/vitest.mjs');
for (let offset = 0; offset < names.length; offset += chunkSize) {
  const chunk = names.slice(offset, offset + chunkSize);
  const pattern = `(?:${chunk.map(escapeRegex).join('|')})$`;
  process.stdout.write(
    `\nVite integration group ${Math.floor(offset / chunkSize) + 1}/${Math.ceil(names.length / chunkSize)} (${chunk.length} tests)\n`,
  );
  const code = await run(process.execPath, [
    '--max-old-space-size=8192',
    vitest,
    'run',
    file,
    '--maxWorkers=1',
    '--testNamePattern', pattern,
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
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptionsWithMemoryLimit(process.env.NODE_OPTIONS, 8_192),
        TYPEKRO_LOG_LEVEL: process.env.TYPEKRO_LOG_LEVEL ?? 'fatal',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Vite integration test group terminated by ${signal}.`));
        return;
      }
      resolveCode(code ?? 1);
    });
  });
}

function nodeOptionsWithMemoryLimit(existing, memoryMb) {
  const withoutExistingLimit = (existing ?? '')
    .replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+(?=\s|$)/gu, ' ')
    .trim();
  return [withoutExistingLimit, `--max-old-space-size=${memoryMb}`]
    .filter(Boolean)
    .join(' ');
}
