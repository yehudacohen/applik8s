import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const examples = [
  'examples/guestbook-start',
  'examples/chirp-start',
  'examples/identity-start',
];
const executable = resolve(
  root,
  'node_modules/.bin',
  process.platform === 'win32' ? 'tsr.cmd' : 'tsr',
);
const failures = [];

for (const example of examples) {
  const source = resolve(root, example);
  const expected = await readFile(
    join(source, 'src/routeTree.gen.ts'),
    'utf8',
  );
  const authoredConfig = JSON.parse(
    await readFile(join(source, 'tsr.config.json'), 'utf8'),
  );
  const temporary = await mkdtemp(
    join(tmpdir(), 'applik8s-generated-routes-'),
  );
  try {
    await cp(join(source, 'src/routes'), join(temporary, 'routes'), {
      recursive: true,
    });
    await writeFile(
      join(temporary, 'tsr.config.json'),
      `${JSON.stringify({
        ...authoredConfig,
        routesDirectory: './routes',
        generatedRouteTree: './routeTree.gen.ts',
      }, null, 2)}\n`,
    );
    const result = spawnSync(executable, ['generate'], {
      cwd: temporary,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      failures.push(
        `${example}: route generation failed\n${result.stderr || result.stdout}`,
      );
      continue;
    }
    const generated = await readFile(
      join(temporary, 'routeTree.gen.ts'),
      'utf8',
    );
    if (generated !== expected) {
      failures.push(
        `${example}: src/routeTree.gen.ts is stale; run "bun run generate-routes" in that example and commit the result.`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  throw new Error(
    `Generated TanStack route reproducibility failed:\n- ${failures.join('\n- ')}`,
  );
}

console.log(
  `Generated TanStack route trees are reproducible for ${examples.length} examples.`,
);
