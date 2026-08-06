import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const packageRoot = join(root, 'packages');
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'applik8s-typecheck-'));
const configuredWorkers = Number.parseInt(
  process.env.APPLIK8S_TYPECHECK_WORKERS ?? '',
  10,
);
const workers =
  Number.isSafeInteger(configuredWorkers) && configuredWorkers > 0
    ? configuredWorkers
    : Math.min(2, availableParallelism());
const maximumHeapMegabytes = 6_144;
const unitFilter = process.env.APPLIK8S_TYPECHECK_FILTER?.trim();

try {
  const packages = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const scriptFiles = await collectTypeScriptFiles(join(root, 'scripts'));
  const scriptShards = partition(scriptFiles, 4);
  const allUnits = [
    ...packages.map((name) => ({
      name: `package:${name}`,
      include: [join(root, 'packages', name, '**/*.ts')],
    })),
    ...scriptShards.map((files, index) => ({
      name: `scripts:${index + 1}`,
      files,
    })),
    {
      name: 'workspace-config',
      files: [
        join(root, 'vitest.config.ts'),
        join(root, 'vitest.character.config.ts'),
        join(root, 'vitest.e2e.config.ts'),
      ],
    },
  ];
  const units = unitFilter
    ? allUnits.filter((unit) => unit.name.includes(unitFilter))
    : allUnits;
  if (units.length === 0) {
    throw new Error(
      `APPLIK8S_TYPECHECK_FILTER=${JSON.stringify(unitFilter)} matched no units.`,
    );
  }

  const failures = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, units.length) }, async () => {
      while (cursor < units.length) {
        const index = cursor++;
        const unit = units[index];
        if (!unit) continue;
        const configPath = join(
          temporaryRoot,
          `${String(index).padStart(3, '0')}.json`,
        );
        const config = {
          extends: join(root, 'tsconfig.json'),
          compilerOptions: {
            noEmit: true,
            typeRoots: [join(root, 'node_modules/@types')],
          },
          ...(unit.files
            ? {
                files: unit.files.map((path) =>
                  relative(temporaryRoot, path)),
              }
            : {
                include: unit.include.map((path) =>
                  relative(temporaryRoot, path)),
              }),
        };
        await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
        const result = await runTypeScript(configPath);
        if (result.code !== 0) {
          const failure = {
            name: unit.name,
            output: `${result.stdout}${result.stderr}`,
          };
          failures.push(failure);
          console.error(
            `[typecheck] ${unit.name} failed\n${failure.output.trim()}`,
          );
        } else {
          console.log(
            `[typecheck] ${unit.name} (${result.durationMilliseconds}ms)`,
          );
        }
      }
    }),
  );

  if (failures.length > 0) {
    throw new Error(
      `Workspace typecheck failed in ${failures.length} unit(s):\n${failures
        .map(
          ({ name, output }) =>
            `\n--- ${name} ---\n${output.trim() || 'TypeScript exited without diagnostics.'}`,
        )
        .join('\n')}`,
    );
  }
  console.log(
    `Workspace typecheck passed for ${packages.length} packages, ` +
      `${scriptShards.length} script shards, and the root TypeScript configs.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function collectTypeScriptFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await collectTypeScriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      output.push(path);
    }
  }
  return output.sort();
}

function partition(values, count) {
  const shards = Array.from({ length: Math.min(count, values.length) }, () => []);
  for (const [index, value] of values.entries()) {
    shards[index % shards.length].push(value);
  }
  return shards;
}

function runTypeScript(configPath) {
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${maximumHeapMegabytes}`,
        tsc,
        '--project',
        configPath,
        '--pretty',
        'false',
      ],
      {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('exit', (code, signal) => {
      resolveResult({
        code: code ?? (signal ? 1 : 0),
        stdout,
        durationMilliseconds: Date.now() - startedAt,
        stderr: signal
          ? `${stderr}\nTypeScript terminated by signal ${signal}.`
          : stderr,
      });
    });
  });
}
