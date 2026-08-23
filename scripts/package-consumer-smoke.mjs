import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  '@applik8s/applik8s/lakehouse-runtime',
  '@applik8s/applik8s/schedule-runtime-local',
  '@applik8s/applik8s/schedule-state-runtime',
  '@applik8s/applik8s/actor-runtime-local',
  '@applik8s/applik8s/postgres-runtime-contract',
  '@applik8s/applik8s/search-runtime',
  '@applik8s/applik8s/dns',
  '@applik8s/client',
  '@applik8s/react',
  '@applik8s/react/identity',
  '@applik8s/server',
  '@applik8s/server/kubernetes-gateway',
  '@applik8s/vite',
  '@applik8s/tanstack-start/server',
  '@applik8s/tanstack-start/vite',
  '@applik8s/core',
  '@applik8s/ai',
  '@applik8s/ai-tanstack',
  '@applik8s/approvals',
  '@applik8s/approvals/schema',
  '@applik8s/artifacts',
  '@applik8s/artifacts/schema',
  '@applik8s/billing',
  '@applik8s/billing/schema',
  '@applik8s/billing-stripe',
  '@applik8s/conversations',
  '@applik8s/conversations/schema',
  '@applik8s/data-lifecycle',
  '@applik8s/data-lifecycle/schema',
  '@applik8s/start-agentic',
  '@applik8s/start-agentic/react',
  '@applik8s/start-agentic/identity-runtime',
  '@applik8s/start-agentic/payments-runtime',
  '@applik8s/operations-ui',
  '@applik8s/operations-ui/health',
  '@applik8s/operations-ui/react',
  '@applik8s/operations-ui/schema',
  '@applik8s/evals',
  '@applik8s/evals/schema',
  '@applik8s/usage',
  '@applik8s/usage/schema',
  '@applik8s/identity',
  '@applik8s/identity/client',
  '@applik8s/identity/server',
  '@applik8s/identity-ory',
  '@applik8s/identity-postgres',
  '@applik8s/mcp',
  '@applik8s/mcp/client',
  '@applik8s/mcp/server',
  '@applik8s/mcp/postgres',
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
  '@applik8s/runtime-postgres/schedule-state',
  '@applik8s/runtime-aws',
  '@applik8s/runtime-aws/bootstrap',
  '@applik8s/runtime-aws/kinesis',
  '@applik8s/runtime-celld',
  '@applik8s/runtime-celld/worker',
  '@applik8s/runtime-otel',
  '@applik8s/runtime-duckdb',
  '@applik8s/dev',
  '@applik8s/dev/server',
  '@applik8s/dev/ui',
  '@applik8s/dev/agent',
  '@applik8s/dev/agent/opencode',
  '@applik8s/dev/skills',
  '@applik8s/search',
  '@applik8s/runtime-opensearch',
  '@applik8s/runtime-ai',
  '@applik8s/testing',
  '@applik8s/typekro-adapter',
  '@applik8s/typekro-adapter/targets',
  '@applik8s/typetainer',
];

const workDir = await mkdtemp(join(tmpdir(), 'applik8s-package-consumer-'));
const packDir = join(workDir, 'packs');
const consumerModules = join(workDir, 'consumer', 'node_modules');
const externalPackages = new Map();
const generatedRuntimeFiles = [
  '@applik8s/applik8s/dist/stream-worker-runtime.js',
  '@applik8s/applik8s/dist/workflow-runtime.js',
  '@applik8s/applik8s/dist/workflow-runtime-resolvers.js',
  '@applik8s/runtime-hatchet/dist/index.js',
];

function assertGeneratedRuntimeFiles(stage) {
  const missing = generatedRuntimeFiles.filter((path) =>
    !existsSync(join(consumerModules, ...path.split('/'))));
  if (missing.length > 0) {
    throw new Error(
      `Package consumer smoke lost generated-worker runtime files after ${stage}: ${missing.join(', ')}`,
    );
  }
}

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
        if (packageName === manifest.name) continue;
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
  assertGeneratedRuntimeFiles('package unpack');

  const consumerDir = join(workDir, 'consumer');
  for (const dependency of [
    '@types/react',
    '@types/react-dom',
    '@tanstack/ai',
    '@tanstack/ai-react',
    '@tailwindcss/vite',
    '@vitejs/plugin-react',
    'class-variance-authority',
    'clsx',
    'drizzle-kit',
    'lucide-react',
    'radix-ui',
    'react-dom',
    'react-markdown',
    'remark-gfm',
    'tailwind-merge',
    'tailwindcss',
    'tw-animate-css',
    'vitest',
  ]) {
    externalPackages.set(
      dependency,
      join(root, 'node_modules', ...dependency.split('/')),
    );
  }
  for (const [dependency, packageTarget] of externalPackages) {
    const rootTarget = join(root, 'node_modules', ...dependency.split('/'));
    const target =
      dependency === 'typescript' || !existsSync(packageTarget)
        ? rootTarget
        : packageTarget;
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
  await writeFile(v05Path, `import { app, applicationGraphFor } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const platform = app('packed-v05', { namespace: 'packed-v05' });
const provision = platform.workflow(
  'packed.provision.v1',
  { input: type({ id: 'string' }), output: type({ endpoint: 'string' }) },
  { retries: 2, idempotencyKey: ({ id }) => id },
  async (input) => ({ endpoint: 'https://' + input.id + '.example.test' }),
);
platform.workflow(
  'packed.onboard.v1',
  { input: type({ id: 'string' }), output: type({ endpoint: 'string' }) },
  async (input) => provision(input, { idempotencyKey: input.id }),
);
const graph = applicationGraphFor(platform.composition);
if (!graph?.nodes.some((node) => node.kind === 'workflowWorker') || !graph.providerRequirements.some((requirement) => requirement.interface === 'WorkflowEngine')) throw new Error('Packed function-native workflow graph did not materialize.');
`);
  await execFileAsync(process.execPath, [v05Path], { cwd: consumerDir });
  console.log('Package consumer smoke: packed function-native workflow graph passed.');

  const v06Path = join(consumerDir, 'v06.mjs');
  await writeFile(v06Path, `import { app, applicationGraphFor, ApplicationHost, Certificate, DnsPublication, IdentityProvider, OAuthAuthorizationServer, postgres, trustedContext } from '@applik8s/applik8s';
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
Work.on.reconcile(async (work) => { work.status.phase = 'Ready'; });
platform.provide(IdentityProvider, IdentityProvider.from(async () => ({ principal: { id: 'guest' }, trustedContext: { organizationId: 'guest' }, authorizationVersion: 'v1' })));
platform.provide(OAuthAuthorizationServer, OAuthAuthorizationServer.from('packed-oauth', async ({ flow, decision }) => ({ id: 'packed-' + flow.id, providerAuthorizationRequestId: flow.providerAuthorizationRequestId, accepted: decision === 'approve', continuationUri: 'https://oauth.example.test/continue', evidence: {} })));
platform.provide(ApplicationHost, ApplicationHost.kubernetes({ namespace: 'packed-v06', image: 'registry.example.test/packed-v06@sha256:${'a'.repeat(64)}' }));
const Database = platform.database.postgres('catalog', { schema: { cards }, access: postgres.rls({ context: OrganizationId, column: 'organizationId' }) });
const Card = platform.model(cards, { name: 'Card', database: Database });
if (typeof Card.require !== 'function' || typeof Card.edit !== 'function') throw new Error('Packed function-native model require/edit surface is missing.');
if ('command' in Card || 'operation' in Card || 'action' in Card || 'command' in Card.on || 'operation' in Card.on || 'action' in Card.on) throw new Error('Packed model exposed a removed command/operation/action registry.');
const query = platform.query('cards.list.v1', { input: type({}), output: Card.$model.schema.select.array(), database: Database, context: [OrganizationId], reads: [Card], authorize: () => true, run: async ({ context }) => context.database(Database).select().from(Card) });
const gateway = platform.gateway('public', { queries: [query], deployment: { namespace: 'packed-v06', cursorSecret: { name: 'cursor', key: 'secret' }, authenticate: async () => ({ principal: { id: 'guest' }, trustedContext: { organizationId: 'guest' }, authorizationVersion: 'v1' }) } });
platform.provide(Certificate, Certificate.certManager({ issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer' } }));
platform.provide(DnsPublication, DnsPublication.externalDns());
platform.expose('public', { service: gateway, hostnames: ['packed.example.test'], tls: { mode: 'managed' }, dns: { mode: 'managed' } });
const graph = applicationGraphFor(platform.composition);
const native = graph?.nodes.find((node) => node.kind === 'model' && node.name === 'Card');
const exposure = graph?.nodes.find((node) => node.kind === 'exposure' && node.name === 'public');
if (Card !== cards || native?.runtime?.storageShape !== 'native-relational' || native.native?.schemaAuthority !== 'drizzle' || exposure?.service !== 'packed-v06-public' || exposure.publicUrl !== 'https://packed.example.test' || !graph?.nodes.some((node) => node.kind === 'provider' && node.interface === 'IdentityProvider') || !graph.nodes.some((node) => node.kind === 'provider' && node.interface === 'OAuthAuthorizationServer') || !graph.nodes.some((node) => node.kind === 'provider' && node.interface === 'ApplicationHost') || !graph.nodes.some((node) => node.kind === 'operator' && node.name === 'work-controller')) throw new Error('Packed v0.6 native model/query/application-host/event graph did not materialize.');
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

  const agenticStartTarget = join(consumerDir, 'packed-agentic-start');
  // static-import-exception: load the packed artifact from the isolated consumer node_modules tree, not workspace source.
  const { createApplicationAgenticStart } = await import(
    pathToFileURL(
      join(consumerModules, '@applik8s', 'start-agentic', 'dist', 'index.js'),
    ).href
  );
  // static-import-exception: load the packed compiler from the isolated consumer node_modules tree.
  const { compileTypeKroComposition, discoverApplicationGraph } = await import(
    pathToFileURL(
      join(consumerModules, '@applik8s', 'compiler', 'dist', 'index.js'),
    ).href
  );
  await createApplicationAgenticStart({
    targetDirectory: agenticStartTarget,
    projectName: 'packed-agentic-start',
    applik8sVersion: '0.8.0',
    install: false,
    async run(command) {
      if (
        command.executable !== 'bunx'
        || command.arguments[0] !== '@tanstack/cli@0.70.1'
      ) {
        throw new Error(`Packed Agentic Start invoked an unexpected scaffold command: ${command.executable} ${command.arguments.join(' ')}`);
      }
      await mkdir(join(agenticStartTarget, 'src', 'routes'), { recursive: true });
      await writeFile(
        join(agenticStartTarget, 'package.json'),
        `${JSON.stringify({
          name: 'upstream-scaffold',
          type: 'module',
          scripts: { dev: 'vite --port 3000' },
          dependencies: {
            '@tanstack/react-start': '1.168.28',
            '@tanstack/react-router': '1.168.28',
            react: '^19.1.0',
            'react-dom': '^19.1.0',
          },
          devDependencies: {
            '@vitejs/plugin-react': '^5.0.4',
            vite: '^7.1.7',
          },
        })}\n`,
      );
      await writeFile(
        join(agenticStartTarget, 'src', 'routes', 'index.tsx'),
        'export const upstreamScaffold = true;\n',
      );
      await writeFile(
        join(agenticStartTarget, 'src', 'routes', '__root.tsx'),
        `import { createRootRoute, Outlet } from '@tanstack/react-router';
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
      );
      await writeFile(
        join(agenticStartTarget, 'src', 'router.tsx'),
        `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}
`,
      );
      await writeFile(
        join(agenticStartTarget, 'tsconfig.json'),
        `${JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'react-jsx',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ['src/**/*.ts', 'src/**/*.tsx', 'vite.config.ts', 'drizzle.config.ts'],
        })}\n`,
      );
    },
  });
  assertGeneratedRuntimeFiles('Agentic Start generation');
  const generatedDoctorHelp = await execFileAsync(
    'bun',
    ['run', 'doctor', '--help'],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (!generatedDoctorHelp.stdout.includes('Usage: applik8s doctor')) {
    throw new Error(
      'Packed Agentic Start could not resolve its declared @applik8s/cli executable from a generated package script.',
    );
  }
  assertGeneratedRuntimeFiles('generated doctor command');
  await execFileAsync(
    join(root, 'node_modules', '.bin', 'drizzle-kit'),
    ['generate', '--config', 'drizzle.config.ts'],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const packedMigrations = (await readdir(
    join(agenticStartTarget, 'drizzle'),
  )).filter((file) => file.endsWith('.sql'));
  if (packedMigrations.length === 0) {
    throw new Error(
      'Packed Agentic Start migration generation reported success without emitting SQL.',
    );
  }
  assertGeneratedRuntimeFiles('generated migration command');
  const packedServerSource = 'export default {};\n';
  const packedServerArtifacts = [{
    path: 'server/index.mjs',
    bytes: Buffer.byteLength(packedServerSource),
    digest: createHash('sha256').update(packedServerSource).digest('hex'),
  }];
  await mkdir(join(agenticStartTarget, '.output', 'server'), { recursive: true });
  await mkdir(join(agenticStartTarget, '.applik8s', 'web-artifacts'), { recursive: true });
  await writeFile(
    join(agenticStartTarget, '.output', 'server', 'index.mjs'),
    packedServerSource,
  );
  await writeFile(
    join(agenticStartTarget, '.applik8s', 'web-artifacts', 'server.json'),
    `${JSON.stringify({
      apiVersion: 'applik8s.webArtifact/v1alpha1',
      application: 'src/application.ts',
      output: '.output',
      target: 'server',
      digest: `sha256:${createHash('sha256').update(JSON.stringify(packedServerArtifacts)).digest('hex')}`,
      entrypoint: 'server/index.mjs',
      artifacts: packedServerArtifacts,
    })}\n`,
  );
  const packedAgenticEntrypoint = join(agenticStartTarget, 'src', 'application.ts');
  const discoveredAgenticStart = await discoverApplicationGraph(
    packedAgenticEntrypoint,
    'application',
  );
  if (!discoveredAgenticStart.ok) {
    throw new Error(`Packed Agentic Start discovery failed: ${discoveredAgenticStart.error.message}`);
  }
  if (
    !discoveredAgenticStart.value.nodes.some((node) => node.kind === 'aiAgent')
    || !discoveredAgenticStart.value.nodes.some((node) => node.kind === 'model')
  ) {
    throw new Error('Packed Agentic Start did not materialize its maintained agent and model modules.');
  }
  assertGeneratedRuntimeFiles('packed Agentic Start discovery');
  const compiledAgenticStart = await compileTypeKroComposition({
    entrypoint: packedAgenticEntrypoint,
    compositionName: 'application',
    outDir: join(agenticStartTarget, '.applik8s', 'build'),
    runtimeVersionRange: '^0.7.0',
    handlerAbiVersion: 'applik8s.handler/v1alpha1',
    adapter: 'wasmComponent',
    portability: {
      deterministicBuild: true,
      allowEnvironmentAccess: false,
      allowFilesystemAccess: false,
      allowNetworkAccess: true,
      allowedHostImports: [],
      sourceMaps: {
        emit: true,
        includeSourceContent: false,
        redactPaths: false,
      },
    },
  });
  assertGeneratedRuntimeFiles('packed Agentic Start compilation');
  if (!compiledAgenticStart.ok) {
    throw new Error(`Packed Agentic Start compilation failed: ${compiledAgenticStart.error.message}`);
  }
  const packedAgenticModelIds = new Set(
    discoveredAgenticStart.value.nodes
      .filter((node) => node.kind === 'model')
      .map((node) => node.id),
  );
  if (
    ![
      'model.document',
      'model.workspace',
      'model.conversation',
      'model.approval-review',
      'model.artifact',
      'model.evaluation-run',
      'model.billing-plan',
      'model.usage-fact',
    ].every((id) => packedAgenticModelIds.has(id))
  ) {
    throw new Error(
      'The default packed Agentic Start omitted part of its maintained SaaS product baseline.',
    );
  }
  const packedAgenticGraph = JSON.parse(await readFile(
    compiledAgenticStart.value.artifacts.applicationGraphJsonPath,
    'utf8',
  ));
  const packedAgenticYaml = await readFile(
    compiledAgenticStart.value.artifacts.combinedYamlPath,
    'utf8',
  );
  if (
    !packedAgenticGraph.nodes.some(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'ApplicationHost'
        && node.config?.host?.name === 'packed-agentic-start-app',
    )
    || !packedAgenticYaml.includes('name: packed-agentic-start-app')
    || !packedAgenticYaml.includes('kind: Deployment')
    || !packedAgenticYaml.includes('kind: Service')
  ) {
    throw new Error(
      'Packed Agentic Start did not infer its ApplicationHost Deployment and Service from the built Start server artifact.',
    );
  }
  if (!(await readFile(join(agenticStartTarget, 'src', 'routes', 'app.operations.tsx'), 'utf8')).includes('ApplicationOperationsControlCenter')) {
    throw new Error('Packed Agentic Start omitted the maintained operations route.');
  }
  await execFileAsync(
    join(root, 'node_modules', '.bin', 'tsr'),
    ['generate'],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const firstPackedRouteTree = await readFile(
    join(agenticStartTarget, 'src', 'routeTree.gen.ts'),
    'utf8',
  );
  await execFileAsync(
    join(root, 'node_modules', '.bin', 'tsr'),
    ['generate'],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const secondPackedRouteTree = await readFile(
    join(agenticStartTarget, 'src', 'routeTree.gen.ts'),
    'utf8',
  );
  if (secondPackedRouteTree !== firstPackedRouteTree) {
    throw new Error(
      'Packed Agentic Start route generation is not reproducible with its pinned TanStack compatibility tuple.',
    );
  }
  const packedUpdateCheck = await execFileAsync(
    executable,
    ['start', 'update', '--check', '--json'],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const packedUpdateReport = JSON.parse(packedUpdateCheck.stdout);
  if (
    packedUpdateReport.updateAvailable !== false
    || packedUpdateReport.conflicts !== false
    || packedUpdateReport.paths.some(({ state }) => state !== 'unchanged')
  ) {
    throw new Error(
      `Packed Agentic Start update check did not recognize a clean generated consumer: ${packedUpdateCheck.stdout}`,
    );
  }
  await execFileAsync(
    join(root, 'node_modules', '.bin', 'tsc'),
    ['--project', join(agenticStartTarget, 'tsconfig.json')],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  await execFileAsync(
    join(root, 'node_modules', '.bin', 'vitest'),
    ['run'],
    {
      cwd: agenticStartTarget,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  await execFileAsync(
    join(root, 'node_modules', '.bin', 'vite'),
    ['build'],
    {
      cwd: agenticStartTarget,
      env: {
        ...process.env,
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          '--max-old-space-size=8192',
        ].filter(Boolean).join(' '),
      },
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  console.log('Package consumer smoke: packed Agentic Start generation, discovery, compilation, and browser/server build passed.');

  console.log(`Package consumer smoke passed under Node for ${packageDirs.length} packed packages, ${publicEntrypoints.length} public entrypoints, the packed executable, function-native workflows and the registry-free model API, v0.6 native model/query/exposure, and packed Agentic Start graphs, plus clean-directory CLI, generated migration/tests, and Agentic Start builds.`);
} finally {
  // Generated builds may close file handles a few milliseconds after their
  // child process exits on macOS. Retry recursive cleanup so teardown cannot
  // mask the actual package-consumer result with a transient ENOTEMPTY.
  if (process.env.APPLIK8S_KEEP_PACKAGE_CONSUMER === '1') {
    console.error(`Package consumer smoke retained diagnostic workspace: ${workDir}`);
  } else {
    await rm(workDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
