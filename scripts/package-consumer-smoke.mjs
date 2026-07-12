import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
await execFileAsync(process.execPath, [join(root, 'scripts/build-publishable-packages.mjs')], { cwd: root });
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
  '@applik8s/applik8s/processor-runtime',
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
const externalPackages = new Map();

try {
  await mkdir(packDir, { recursive: true });
  for (const packageDir of packageDirs) {
    const absolutePackageDir = join(root, packageDir);
    const manifest = JSON.parse(await readFile(join(absolutePackageDir, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!dependency.startsWith('@applik8s/')) {
        externalPackages.set(dependency, join(absolutePackageDir, 'node_modules', ...dependency.split('/')));
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
  for (const [dependency, packageTarget] of externalPackages) {
    const rootTarget = join(root, 'node_modules', ...dependency.split('/'));
    const target = dependency === 'typescript' ? rootTarget : packageTarget;
    const link = join(consumerModules, ...dependency.split('/'));
    await mkdir(join(link, '..'), { recursive: true });
    await symlink(target, link, 'junction');
  }

  const entryPath = join(consumerDir, 'entry.mjs');
  await writeFile(
    entryPath,
    publicEntrypoints.map((specifier, index) => `import * as package${index} from ${JSON.stringify(specifier)};\nvoid package${index};`).join('\n'),
  );
  await execFileAsync(process.execPath, [entryPath], { cwd: consumerDir });

  const operatorPath = join(consumerDir, 'operator.ts');
  const outDir = join(consumerDir, 'dist');
  await writeFile(operatorPath, `import { sdk } from '@applik8s/sdk';
const Work = sdk.crd({ apiVersion: 'smoke.applik8s.dev/v1alpha1', kind: 'Work', spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'WorkSpec' }, schema: { type: 'object', properties: {} } }, status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'WorkStatus' }, schema: { type: 'object', properties: { phase: { type: 'string' } } } } });
export const smoke = sdk.operator({ name: 'packed-smoke', deployment: { namespace: 'smoke' }, resources: { Work }, handlers: [Work.on.reconcile((work) => { work.status.phase = 'Ready'; })] });
`);
  await execFileAsync(process.execPath, [join(consumerModules, '@applik8s/applik8s/dist/cli.js'), 'build', operatorPath, '--out-dir', outDir, '--operator-name', 'packed-smoke'], { cwd: consumerDir, maxBuffer: 20 * 1024 * 1024 });
  await readFile(join(outDir, 'operator-manifest.json'));

  const v04Path = join(consumerDir, 'v04.mjs');
  await writeFile(v04Path, `import { app, applicationGraphFor, command, event } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';
const AccountEntity = entity('Account', { spec: type({ name: 'string' }) });
const Rename = command('account.rename.v1', { input: type({ accountId: 'string', name: 'string' }), output: type({ changed: 'boolean' }) });
const Changed = event('account.changed.v1', { payload: type({ accountId: 'string', name: 'string' }) });
const platform = app('packed-v04', { namespace: 'packed-v04' });
platform.storage.postgres('packed-v04-db', { migrations: 'generated-job' });
const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
Account.on.command(Rename, { key: ({ accountId }) => accountId, transaction: { history: [Account], outbox: [Changed] } }, async (account, input, context) => {
  account.patch({ spec: { name: input.name } });
  context.emit(Changed, { accountId: input.accountId, name: input.name });
  return { changed: true };
});
const graph = applicationGraphFor(platform.composition);
if (!graph?.nodes.some((node) => node.kind === 'processor') || !graph.providerRequirements.some((requirement) => requirement.interface === 'EventLog')) throw new Error('Packed v0.4 command/EventLog graph did not materialize.');
`);
  await execFileAsync(process.execPath, [v04Path], { cwd: consumerDir });

  console.log(`Package consumer smoke passed under Node for ${packageDirs.length} packed packages, ${publicEntrypoints.length} public entrypoints, a v0.4 command/EventLog graph, and a clean-directory CLI build.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
