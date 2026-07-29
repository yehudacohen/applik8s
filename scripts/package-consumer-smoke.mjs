import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { publishablePackageDirectories } from './publishable-packages.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(process.cwd());
await execFileAsync(process.execPath, [join(root, 'scripts/build-publishable-packages.mjs')], { cwd: root });
console.log('Package consumer smoke: built publishable packages.');
const packageDirs = publishablePackageDirectories;
const publicEntrypoints = [
  '@applik8s/cli',
  '@applik8s/applik8s',
  '@applik8s/applik8s/operator',
  '@applik8s/applik8s/dsl',
  '@applik8s/applik8s/drizzle',
  '@applik8s/applik8s/typekro',
  '@applik8s/applik8s/factories',
  '@applik8s/applik8s/processor-runtime',
  '@applik8s/applik8s/event-log-runtime',
  '@applik8s/applik8s/postgres-runtime-contract',
  '@applik8s/applik8s/dns',
  '@applik8s/client',
  '@applik8s/react',
  '@applik8s/server',
  '@applik8s/server/kubernetes-gateway',
  '@applik8s/vite',
  '@applik8s/tanstack-start/server',
  '@applik8s/tanstack-start/vite',
  '@applik8s/core',
  '@applik8s/deployment-contract',
  '@applik8s/deployment-compiler',
  '@applik8s/deployment-typekro',
  '@applik8s/deployment-provider-harbor',
  '@applik8s/deployment-provider-kubernetes',
  '@applik8s/deployment-provider-oci',
  '@applik8s/deployment-alchemy',
  '@applik8s/sdk',
  '@applik8s/compiler',
  '@applik8s/compiler/diagnostics',
  '@applik8s/compiler/kubernetes-schema',
  '@applik8s/runtime-contract',
  '@applik8s/runtime',
  '@applik8s/runtime-s3',
  '@applik8s/runtime-hatchet',
  '@applik8s/runtime-nats',
  '@applik8s/runtime-nats/event-log',
  '@applik8s/runtime-nats/command-processor',
  '@applik8s/runtime-kubernetes',
  '@applik8s/runtime-postgres',
  '@applik8s/testing',
  '@applik8s/typekro-adapter',
  '@applik8s/typekro-adapter/targets',
  '@applik8s/typetainer',
];

const workDir = await mkdtemp(join(tmpdir(), 'applik8s-package-consumer-'));
const packDir = join(workDir, 'packs');
const consumerModules = join(workDir, 'consumer', 'node_modules');
const externalPackages = new Map();

async function assertDirectRuntimeDependencies(packageDir, manifest) {
  const distDir = join(packageDir, 'dist');
  const pending = [distDir];
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const source = await readFile(path, 'utf8');
      const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const specifiers = [];
      const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          specifiers.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      for (const specifier of specifiers) {
        if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || specifier.startsWith('applik8s:')) continue;
        const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!declared.has(packageName)) {
          throw new Error(`${manifest.name}: ${path.slice(packageDir.length + 1)} imports undeclared runtime dependency ${packageName}.`);
        }
      }
    }
  }
}

try {
  await mkdir(packDir, { recursive: true });
  for (const packageDir of packageDirs) {
    const absolutePackageDir = join(root, packageDir);
    const manifest = JSON.parse(await readFile(join(absolutePackageDir, 'package.json'), 'utf8'));
    await assertDirectRuntimeDependencies(absolutePackageDir, manifest);
    for (const dependency of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]) {
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
  console.log(`Package consumer smoke: packed and unpacked ${packageDirs.length} packages.`);

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
  console.log(`Package consumer smoke: imported ${publicEntrypoints.length} public entrypoints under Node.`);

  const v05Path = join(consumerDir, 'v05.mjs');
  await writeFile(v05Path, `import { app, applicationGraphFor, task, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Provision = task('packed.provision.v1', { input: type({ id: 'string' }), output: type({ endpoint: 'string' }), errors: { unavailable: type({ retryAfterSeconds: 'number' }) } });
const Onboard = workflow('packed.onboard.v1', { input: type({ id: 'string' }), output: type({ endpoint: 'string' }), errors: { rejected: type({ reason: 'string' }) }, signals: { approval: type({ approved: 'boolean' }) } });
const platform = app('packed-v05', { namespace: 'packed-v05' });
const provision = platform.task(Provision, {}, async (input) => ({ endpoint: 'https://' + input.id + '.example.test' }));
platform.workflow(Onboard, { tasks: { provision } }, async (input, context) => {
  const approval = await context.waitFor('approval');
  if (!approval.approved) context.fail('rejected', { reason: 'approval denied' });
  return context.task('provision', input);
});
const graph = applicationGraphFor(platform.composition);
if (!graph?.nodes.some((node) => node.kind === 'workflowWorker') || !graph.providerRequirements.some((requirement) => requirement.interface === 'WorkflowEngine')) throw new Error('Packed v0.5 task/workflow graph did not materialize.');
`);
  await execFileAsync(process.execPath, [v05Path], { cwd: consumerDir });
  console.log('Package consumer smoke: packed v0.5 task/workflow graph passed.');

  const v06Path = join(consumerDir, 'v06.mjs');
  await writeFile(v06Path, `import { app, applicationGraphFor, ApplicationHost, Certificate, DnsPublication, RequestIdentity, postgres, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { authenticatedPrincipalId } from '@applik8s/applik8s/drizzle';
import { ApplicationQueryClient, preloadApplicationQuery } from '@applik8s/client';
import { ApplicationQueryClientProvider } from '@applik8s/react';
import { applik8sVite } from '@applik8s/vite';
import { createApplik8sKubernetesGateway } from '@applik8s/server/kubernetes-gateway';
import { applik8sStart } from '@applik8s/tanstack-start/vite';
import { pgTable, text } from 'drizzle-orm/pg-core';
void ApplicationQueryClient; void ApplicationQueryClientProvider; void preloadApplicationQuery;
void applik8sVite; void applik8sStart; void createApplik8sKubernetesGateway;
const cards = pgTable('cards', { id: text('id').default(authenticatedPrincipalId).primaryKey(), organizationId: text('organization_id').notNull(), name: text('name').notNull(), revision: text('revision').notNull() });
const OrganizationId = trustedContext('organizationId', { schema: type('string') });
const platform = app('packed-v06', { namespace: 'packed-v06' });
const Work = platform.resource('Work', { apiVersion: 'packed.example/v1alpha1', spec: type({ message: 'string' }), status: type({ 'phase?': 'string' }) });
platform.on(Work, { created: async (work) => { work.status.phase = 'Ready'; } });
platform.provide(RequestIdentity, RequestIdentity.from(async () => ({ principal: { id: 'guest' }, trustedContext: { organizationId: 'guest' }, authorizationVersion: 'v1' })));
platform.provide(ApplicationHost, ApplicationHost.kubernetes({ namespace: 'packed-v06', image: 'registry.example.test/packed-v06@sha256:${'a'.repeat(64)}' }));
const Database = platform.database.postgres('catalog', { schema: { cards }, access: postgres.rls({ context: OrganizationId, column: 'organizationId' }) });
const Card = platform.model(cards, { name: 'Card', database: Database });
const query = platform.query('cards.list.v1', { input: type({}), output: Card.$model.schema.select.array(), database: Database, context: [OrganizationId], reads: [Card], authorize: () => true, run: async ({ context }) => context.database(Database).select().from(Card) });
const gateway = platform.gateway('public', { queries: [query], deployment: { namespace: 'packed-v06', cursorSecret: { name: 'cursor', key: 'secret' }, authenticate: async () => ({ principal: { id: 'guest' }, trustedContext: { organizationId: 'guest' }, authorizationVersion: 'v1' }) } });
platform.provide(Certificate, Certificate.certManager({ issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer' } }));
platform.provide(DnsPublication, DnsPublication.externalDns());
platform.expose('public', { service: gateway, hostnames: ['packed.example.test'], tls: { mode: 'managed' }, dns: { mode: 'managed' } });
const graph = applicationGraphFor(platform.composition);
const native = graph?.nodes.find((node) => node.kind === 'model' && node.name === 'Card');
const exposure = graph?.nodes.find((node) => node.kind === 'exposure' && node.name === 'public');
if (Card !== cards || native?.runtime?.storageShape !== 'native-relational' || native.native?.schemaAuthority !== 'drizzle' || exposure?.service !== 'packed-v06-public' || exposure.publicUrl !== 'https://packed.example.test' || !graph?.nodes.some((node) => node.kind === 'provider' && node.interface === 'RequestIdentity') || !graph.nodes.some((node) => node.kind === 'provider' && node.interface === 'ApplicationHost') || !graph.nodes.some((node) => node.kind === 'operator' && node.name === 'work-controller')) throw new Error('Packed v0.6 native model/query/application-host/event graph did not materialize.');
`);
  await execFileAsync(process.execPath, [v06Path], { cwd: consumerDir });
  console.log('Package consumer smoke: packed v0.6 native model/query/exposure graph passed.');

  const operatorPath = join(consumerDir, 'operator.ts');
  const outDir = join(consumerDir, 'dist');
  await writeFile(operatorPath, `import { sdk } from '@applik8s/sdk';
const Work = sdk.crd({ apiVersion: 'smoke.applik8s.dev/v1alpha1', kind: 'Work', spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'WorkSpec' }, schema: { type: 'object', properties: {} } }, status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'WorkStatus' }, schema: { type: 'object', properties: { phase: { type: 'string' } } } } });
export const smoke = sdk.operator({ name: 'packed-smoke', deployment: { namespace: 'smoke' }, resources: { Work }, handlers: [Work.on.reconcile((work) => { work.status.phase = 'Ready'; })] });
`);
  const binDir = join(consumerModules, '.bin');
  await mkdir(binDir, { recursive: true });
  const executable = join(binDir, 'applik8s');
  await symlink(join(consumerModules, '@applik8s/cli/dist/bin.js'), executable);
  const help = await execFileAsync(executable, ['--help'], { cwd: consumerDir });
  if (!help.stdout.includes('Usage: applik8s')) throw new Error('Packed applik8s executable did not render help.');
  await execFileAsync(executable, ['build', operatorPath, '--out-dir', outDir, '--operator-name', 'packed-smoke'], { cwd: consumerDir, maxBuffer: 20 * 1024 * 1024 });
  await readFile(join(outDir, 'operator-manifest.json'));
  console.log('Package consumer smoke: clean-directory CLI build passed.');

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
  console.log('Package consumer smoke: packed v0.4 graph passed.');

  console.log(`Package consumer smoke passed under Node for ${packageDirs.length} packed packages, ${publicEntrypoints.length} public entrypoints, the packed executable, v0.4 command/EventLog, v0.5 task/workflow, and v0.6 native model/query/exposure graphs, plus a clean-directory CLI build.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
