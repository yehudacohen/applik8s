import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
const packageDirs = [
  'packages/applik8s',
  'packages/core',
  'packages/sdk',
  'packages/compiler',
  'packages/runtime-contract',
  'packages/runtime',
  'packages/testing',
  'packages/typekro-adapter',
  'packages/typetainer',
];
const publicEntrypoints = [
  '@applik8s/applik8s',
  '@applik8s/applik8s/dsl',
  '@applik8s/applik8s/typekro',
  '@applik8s/applik8s/factories',
  '@applik8s/core',
  '@applik8s/sdk',
  '@applik8s/compiler',
  '@applik8s/compiler/kubernetes-schema',
  '@applik8s/runtime-contract',
  '@applik8s/runtime',
  '@applik8s/testing',
  '@applik8s/typekro-adapter',
  '@applik8s/typekro-adapter/targets',
  '@applik8s/typetainer',
];

const workDir = await mkdtemp(join(tmpdir(), 'applik8s-package-consumer-'));
const packDir = join(workDir, 'packs');
const consumerModules = join(workDir, 'consumer', 'node_modules');
const externalPackages = new Set();

try {
  await mkdir(packDir, { recursive: true });
  for (const packageDir of packageDirs) {
    const absolutePackageDir = join(root, packageDir);
    const manifest = JSON.parse(await readFile(join(absolutePackageDir, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!dependency.startsWith('@applik8s/')) {
        externalPackages.add(dependency);
      }
    }

    const { stdout } = await execFileAsync('npm', ['pack', '--json', '--pack-destination', packDir, '.'], {
      cwd: absolutePackageDir,
      env: { ...process.env, npm_config_cache: join(workDir, 'npm-cache') },
      maxBuffer: 10 * 1024 * 1024,
    });
    const [packResult] = JSON.parse(stdout);
    if (!packResult?.filename) {
      throw new Error(`${manifest.name}: npm pack did not return a tarball filename.`);
    }

    const packageInstallDir = join(consumerModules, ...manifest.name.split('/'));
    await mkdir(packageInstallDir, { recursive: true });
    await execFileAsync('tar', ['-xzf', join(packDir, packResult.filename), '-C', packageInstallDir, '--strip-components=1']);
  }

  const consumerDir = join(workDir, 'consumer');
  const entryPath = join(consumerDir, 'entry.ts');
  await writeFile(
    entryPath,
    publicEntrypoints.map((specifier, index) => `import * as package${index} from ${JSON.stringify(specifier)};\nvoid package${index};`).join('\n'),
  );

  const external = [...externalPackages].flatMap((name) => [name, `${name}/*`]);
  await build({
    absWorkingDir: consumerDir,
    entryPoints: [entryPath],
    outfile: join(consumerDir, 'bundle.mjs'),
    bundle: true,
    external,
    format: 'esm',
    logLevel: 'silent',
    nodePaths: [join(root, 'node_modules')],
    platform: 'node',
    target: 'node22',
  });

  console.log(`Package consumer smoke passed for ${packageDirs.length} packed packages and ${publicEntrypoints.length} public entrypoints.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
