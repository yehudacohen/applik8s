// typecast-file-boundary: Generator tests inspect emitted files and manifests after asserting their generated shape.
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  compileTypeKroComposition,
  discoverApplicationGraph,
} from '@applik8s/compiler';
import { compileApplicationDeploymentGraph } from '@applik8s/deployment-compiler';
import {
  type ApplicationStartCommand,
  applicationAgenticStartDefinition,
  createApplicationAgenticStart,
} from '@applik8s/start-agentic';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Agentic Start generator', () => {
  it('overlays the exact official TanStack Start scaffold and reuses the qualified database authority', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'applik8s-agentic-start-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'research-workspace');
    const commands: ApplicationStartCommand[] = [];

    const result = await createApplicationAgenticStart({
      targetDirectory: target,
      applik8sVersion: 'workspace:*',
      example: 'research',
      install: false,
      async run(command) {
        commands.push(command);
        await mkdir(join(target, 'src/routes'), { recursive: true });
        await writeFile(
          join(target, 'package.json'),
          `${JSON.stringify({
            name: 'upstream',
            scripts: { dev: 'vite --port 3000' },
            dependencies: {
              '@tanstack/react-start': '1.168.28',
              '@tanstack/react-router': '1.168.28',
              react: '^19.1.0',
            },
          })}\n`,
        );
        await writeFile(
          join(target, 'src/routes/index.tsx'),
          'export const upstream = true;\n',
        );
        await writeOfficialRouterFiles(target);
      },
    });

    expect(commands).toEqual([
      {
        executable: 'bunx',
        arguments: [
          '@tanstack/cli@0.70.1',
          'create',
          'research-workspace',
          '--target-dir',
          target,
          '--blank',
          '--package-manager',
          'bun',
          '--no-git',
          '--no-install',
          '-y',
        ],
        cwd: parent,
      },
    ]);
    expect(result.upstream).toEqual({
      package: '@tanstack/cli',
      version: '0.70.1',
    });
    expect(result.example).toBe('research');
    expect(result.files).toHaveLength(42);
    const productCatalog = await readFile(
      join(target, 'drizzle/zzzz_agentic_product_catalog.sql'),
      'utf8',
    );
    expect(productCatalog).toContain("'Local workspace'");
    expect(productCatalog).toContain(
      "'principal:research-workspace:deterministic:local-developer'",
    );
    expect(productCatalog).toContain("'research-review'");
    expect(productCatalog).toContain(
      "'research-workspace-authority-v1'",
    );
    expect(productCatalog).not.toContain('applik8s-template-project');
    const providers = await readFile(join(target, 'src/providers.ts'), 'utf8');
    expect(providers).toContain('application.include(agenticProfiles)');
    expect(providers).not.toContain('applicationAgenticModuleSchema');
    expect(providers).not.toContain('schema:');
    expect(providers).not.toContain('migrations:');
    expect(providers).toContain('application.include(agenticProfiles)');
    expect(providers).toContain('host,');
    expect(providers).not.toContain('ApplicationHost.kubernetes');
    expect(providers).not.toContain('.exhaustive()');
    expect(providers).not.toContain('application.profile(');
    expect(providers).not.toContain('export const authenticate');
    expect(providers).not.toContain('application.database.postgres');
    const installation = await readFile(
      join(target, 'src/installation.ts'),
      'utf8',
    );
    expect(installation).toContain("kind: \"'ory'\"");
    expect(installation).toContain("publicUrl: 'string'");
    expect(installation).toContain("adminUrl: 'string'");
    const schema = await readFile(
      join(target, 'src/features/research/schema.ts'),
      'utf8',
    );
    expect(schema).toContain(
      "import { field, model } from '@applik8s/applik8s/drizzle';",
    );
    expect(schema).toContain(
      "export const ResearchNote = model('research_notes', {",
    );
    expect(schema).not.toContain('pgTable(');
    const researchModel = await readFile(
      join(target, 'src/features/research/model.ts'),
      'utf8',
    );
    expect(researchModel).toContain(
      "import { ResearchNote as ResearchNoteTable } from './schema';",
    );
    expect(researchModel).toContain("const research = module(");
    expect(researchModel).not.toContain('defineApplicationModule');
    expect(researchModel).not.toContain('throw new Error');
    expect(researchModel).toContain('application.include(research)');
    expect(researchModel).not.toContain('application.model(');
    const researchView = await readFile(
      join(target, 'src/features/research/view.tsx'),
      'utf8',
    );
    expect(researchView).toContain(
      "import { AgenticStartOnboarding } from '@applik8s/start-agentic/react';",
    );
    expect(researchView).toContain('<AgenticStartOnboarding');
    expect(researchView).not.toContain('profile="starter"');
    const applicationSource = await readFile(
      join(target, 'src/application.ts'),
      'utf8',
    );
    expect(applicationSource).not.toContain('authenticate,');
    expect(applicationSource).not.toContain("application.gateway('web'");
    expect(applicationSource).not.toContain('ApplicationHost.kubernetes');
    expect(applicationSource).toContain('OperationsSnapshot,');
    expect(applicationSource).toContain('Researcher,');
    expect(applicationSource).toContain('Conversation,');
    expect(applicationSource).toContain('Workspace,');
    expect(applicationSource).toContain('WorkspaceList,');
    const workspaceView = await readFile(
      join(target, 'src/features/workspaces/view.tsx'),
      'utf8',
    );
    expect(workspaceView).toContain('Workspace.create.useMutation()');
    expect(workspaceView).not.toContain('useOperation');
    const workspaceModel = await readFile(
      join(target, 'src/features/workspaces/model.ts'),
      'utf8',
    );
    expect(workspaceModel).not.toContain('application.model(');
    expect(workspaceModel).toContain("const workspaces = module(");
    expect(workspaceModel).not.toContain('defineApplicationModule');
    expect(workspaceModel).toContain('WorkspaceTable.on.create(');
    expect(workspaceModel).toContain('await MembershipTable.create({');
    expect(workspaceModel).toContain(
      "WHEN ${WorkspaceTable.ownerPrincipalId} = ${context.principal.id}",
    );
    expect(workspaceModel).toContain(
      "const Authenticated = application.role('authenticated')",
    );
    expect(workspaceModel).toContain(
      "export const WorkspaceId = trustedContext('workspaceId'",
    );
    expect(workspaceModel).toContain(
      'membership.workspaceId.eq(WorkspaceId)',
    );
    expect(workspaceModel).not.toContain('ownerPrincipalId: input');
    expect(workspaceView).toContain('await createWorkspace({ name, slug })');
    expect(workspaceView).toContain(
      'const workspaceId = String(created.value.id)',
    );
    expect(workspaceView).toContain(
      'selectAgenticWorkspace(workspaceId)',
    );
    const reviewRoute = await readFile(
      join(target, 'src/routes/workspaces.$workspaceId_.reviews.tsx'),
      'utf8',
    );
    expect(reviewRoute).toContain(
      "createFileRoute('/workspaces/$workspaceId/reviews')",
    );
    expect(workspaceView).toContain(
      'params: { workspaceId }',
    );
    expect(workspaceView).not.toContain("'id' in created");
    expect(workspaceView).toContain(
      'onClick={() => selectAgenticWorkspace(workspace.id)}',
    );
    expect(workspaceView).not.toContain('.mutate(');
    const workspaceLayout = await readFile(
      join(target, 'src/routes/workspaces.tsx'),
      'utf8',
    );
    expect(workspaceLayout).toContain("createFileRoute('/workspaces')");
    expect(workspaceLayout).toContain('component: Outlet');
    expect(
      await readFile(join(target, 'src/routes/workspaces.index.tsx'), 'utf8'),
    ).toContain("createFileRoute('/workspaces/')");
    expect(researchView).toContain('Researcher,');
    expect(researchView).toContain('agent: Researcher');
    expect(researchView).not.toContain("agent: 'researcher'");
    expect(researchView).not.toContain('useId');
    expect(researchView).toContain(
      'hydrateApplicationConversationMessage',
    );
    expect(researchView).toContain(
      "to: '/conversations/$conversationId'",
    );
    const conversationModel = await readFile(
      join(target, 'src/features/conversations/model.ts'),
      'utf8',
    );
    expect(conversationModel).toContain(
      'applicationAIConversationPrincipalScope',
    );
    expect(conversationModel).not.toContain(
      'ApplicationModelBeforeCommitHandler',
    );
    expect(conversationModel).not.toContain('Parameters<');
    expect(conversationModel).toContain(
      'export const ConversationInbox = Conversations.Conversation.view(',
    );
    expect(conversationModel).toContain(
      'export const ConversationDetail = Conversations.Conversation.view(',
    );
    expect(conversationModel).toContain(
      'Conversations.Conversation.update.beforeCommit(',
    );
    expect(conversationModel).toContain(
      'context.trustedContext',
    );
    expect(conversationModel).toContain(
      'Authenticated.can(',
    );
    expect(conversationModel).toContain(
      "field !== 'title' && field !== 'archivedAt'",
    );
    expect(researchView).toContain(
      'const updateConversation = Conversation.update.useMutation()',
    );
    expect(researchView).toContain('setMessages(initialMessages)');
    expect(researchView).toContain(
      'patch: { archivedAt: new Date().toISOString() }',
    );
    expect(researchView).toContain('patch: { title: next }');
    expect(
      await readFile(
        join(target, 'src/routes/conversations.$conversationId.tsx'),
        'utf8',
      ),
    ).toContain("createFileRoute('/conversations/$conversationId')");
    const modules = await readFile(join(target, 'src/modules.ts'), 'utf8');
    expect(modules).toContain(
      "import { conversations } from '@applik8s/conversations';",
    );
    expect(modules).toContain(
      "import { billing } from '@applik8s/billing';",
    );
    expect(modules).not.toContain("group: 'agentic-commands'");
    expect(modules).toContain(
      'application.include(conversations)',
    );
    expect(modules).toContain(
      "import { operationsControlCenter } from '@applik8s/operations-ui';",
    );
    expect(modules).toContain(
      'export const Operations = application.include(operationsControlCenter);',
    );
    expect(modules).toContain(
      'export const OperationsSnapshot = Operations.Conversation.operationsSnapshot;',
    );
    expect(modules).not.toContain('conversations: Conversations,');
    expect(modules).not.toContain('maintainedCommands');
    expect(modules).not.toContain('Conversation: Conversations.Conversation');
    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
      readonly applik8s: Readonly<Record<string, string>>;
    };
    expect(manifest.scripts.plan).toBe('bun run build && applik8s plan');
    expect(manifest.scripts.deploy).toBe('bun run build && applik8s deploy');
    expect(manifest.scripts['dev:cluster']).toBe(
      'bun run deploy && vite dev',
    );
    expect(manifest.scripts.status).toBe('applik8s status');
    expect(manifest.scripts.destroy).toBe('applik8s destroy');
    expect(manifest.applik8s).toEqual({
      entrypoint: 'src/application.ts',
      compositionName: 'application',
      instance: 'kubernetes/application.yaml',
      outDir: '.applik8s/deploy',
    });
    expect(manifest.dependencies['@tanstack/react-start']).toBe('1.168.28');
    expect(manifest.dependencies['@tanstack/react-router']).toBe('1.170.18');
    expect(manifest.dependencies['@applik8s/start-agentic']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/operations-ui']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/identity']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-s3']).toBe('workspace:*');
    expect(manifest.dependencies['@tanstack/ai-react']).toBe('0.18.1');
    expect(
      await readFile(join(target, 'kubernetes/application.yaml'), 'utf8'),
    ).toContain('kind: ResearchWorkspace');
    expect(
      await readFile(join(target, 'src/routes/operations.tsx'), 'utf8'),
    ).toContain('ApplicationOperationsControlCenter');
    const rootRoute = await readFile(
      join(target, 'src/routes/__root.tsx'),
      'utf8',
    );
    expect(rootRoute).toContain(
      "import { Applik8sProvider } from '@applik8s/react';",
    );
    expect(rootRoute).toContain(
      '<Applik8sProvider>',
    );
    expect(rootRoute).toContain(
      'loader: () => getApplicationIdentitySession()',
    );
    expect(rootRoute).toContain(
      '<ApplicationIdentityProvider initialSession={initialSession}>',
    );
    expect(rootRoute).toContain('<AccountSession />');
    expect(rootRoute).toContain('<Outlet />');
    expect(rootRoute).toMatch(
      /<ApplicationIdentityProvider[\s\S]*<Document>[\s\S]*<\/Document>[\s\S]*<\/ApplicationIdentityProvider>/,
    );
    const accountSessionServer = await readFile(
      join(target, 'src/features/account/session-loader.ts'),
      'utf8',
    );
    expect(accountSessionServer).toContain(
      "import { loadApplicationIdentitySession } from '@applik8s/tanstack-start/server';",
    );
    expect(accountSessionServer).toContain(
      ".handler(() => loadApplicationIdentitySession())",
    );
    const accountSession = await readFile(
      join(target, 'src/features/account/session.tsx'),
      'utf8',
    );
    expect(accountSession).toContain(
      'useApplicationIdentitySession',
    );
    expect(accountSession).toContain(
      "session.phase === 'loading'",
    );
    expect(accountSession).not.toContain('Ory');
    expect(accountSession).not.toContain('Kratos');
    expect(
      await readFile(join(target, 'src/styles.css'), 'utf8'),
    ).toContain('font-synthesis: none');
    const operationsRoute = await readFile(
      join(target, 'src/routes/operations.tsx'),
      'utf8',
    );
    expect(operationsRoute).toContain(
      "import { OperationsSnapshot } from '../application';",
    );
    expect(operationsRoute).toContain(
      'snapshot={OperationsSnapshot}',
    );
    expect(operationsRoute).not.toContain("from '../modules'");
  });

  it('generates the smaller product shell with truthful lineage, scripts, context, and documentation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'applik8s-agentic-product-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'notes-product');
    const progress: string[] = [];

    const result = await createApplicationAgenticStart({
      targetDirectory: target,
      applik8sVersion: 'workspace:*',
      install: false,
      context: 'orbstack',
      progress(update) {
        progress.push(update.phase);
      },
      async run() {
        await mkdir(join(target, 'src/routes'), { recursive: true });
        await writeFile(
          join(target, 'package.json'),
          `${JSON.stringify({
            name: 'upstream',
            scripts: { dev: 'vite --port 3000' },
            dependencies: {
              '@tanstack/react-start': '1.168.28',
              '@tanstack/react-router': '1.168.28',
            },
          })}\n`,
        );
        await writeFile(join(target, 'src/routes/index.tsx'), 'export {};\n');
        await writeOfficialRouterFiles(target);
      },
    });

    expect(result.example).toBe('product');
    expect(result.files).toEqual(
      expect.arrayContaining(applicationAgenticStartDefinition.generator.files),
    );
    expect(result.files).toHaveLength(24);
    expect(result.files.length).toBeLessThanOrEqual(
      applicationAgenticStartDefinition.generator.maximumApplicationFiles,
    );
    expect(progress).toEqual(['scaffold', 'templates', 'validation']);

    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly applik8s: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
    };
    expect(manifest.applik8s.context).toBe('orbstack');
    expect(manifest.scripts).toMatchObject({
      typecheck: 'bun run generate-routes && tsc --noEmit',
      test: 'vitest run',
      lint: 'biome lint src test vite.config.ts vitest.config.ts',
      check:
        'bun run typecheck && bun run lint && bun run test && bun run app:check && bun run db:check',
    });
    expect(manifest.dependencies['@applik8s/operations-ui']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies).not.toHaveProperty(
      '@applik8s/conversations',
    );
    expect(manifest.dependencies).not.toHaveProperty('@applik8s/approvals');
    expect(manifest.dependencies).not.toHaveProperty('@applik8s/billing');
    const readme = await readFile(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('Starter profile is credential-free');
    expect(readme).toContain('web-only');
    expect(readme).toContain('applik8s.context');
    expect(readme).toContain('Starter lineage');
    const environment = await readFile(join(target, '.env.example'), 'utf8');
    expect(environment).not.toContain('APPLIK8S_PROFILE=');
    expect(environment).not.toContain('APPLIK8S_CONTEXT=');
    expect(
      await readFile(
        join(target, '.applik8s/start-lineage.json'),
        'utf8',
      ),
    ).toContain('"example": "product"');
    expect(
      await readFile(join(target, 'src/features/notes/model.ts'), 'utf8'),
    ).toContain("const notes = module(");
    expect(
      await readFile(join(target, 'src/modules.ts'), 'utf8'),
    ).toContain('application.include(operationsOverview)');
    expect(
      await readFile(join(target, 'test/application.test.ts'), 'utf8'),
    ).toContain('explicit authority graph');
  });

  it('generates the file-route tree after installing the generated application', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'applik8s-agentic-start-install-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'research-workspace');
    const commands: ApplicationStartCommand[] = [];

    await createApplicationAgenticStart({
      targetDirectory: target,
      applik8sVersion: 'workspace:*',
      example: 'research',
      async run(command) {
        commands.push(command);
        if (commands.length !== 1) return;
        await mkdir(join(target, 'src/routes'), { recursive: true });
        await writeFile(
          join(target, 'package.json'),
          `${JSON.stringify({
            dependencies: {
              '@tanstack/react-start': '1.168.28',
              '@tanstack/react-router': '1.168.28',
            },
          })}\n`,
        );
        await writeFile(
          join(target, 'src/routes/index.tsx'),
          'export const upstream = true;\n',
        );
        await writeOfficialRouterFiles(target);
      },
    });

    expect(commands.slice(1)).toEqual([
      {
        executable: 'bun',
        arguments: ['install'],
        cwd: target,
      },
      {
        executable: 'bun',
        arguments: ['run', 'db:generate'],
        cwd: target,
      },
      {
        executable: 'bun',
        arguments: ['run', 'generate-routes'],
        cwd: target,
      },
    ]);
  });

  it(
    'discovers the default product shell with its model, agent, view, and authority',
    async () => {
      const temporaryRoot = join(process.cwd(), '.applik8s-tmp');
      await mkdir(temporaryRoot, { recursive: true });
      const parent = await mkdtemp(
        join(temporaryRoot, 'agentic-product-discovery-'),
      );
      temporaryDirectories.push(parent);
      const target = join(parent, 'notes-product');

      await createApplicationAgenticStart({
        targetDirectory: target,
        applik8sVersion: 'workspace:*',
        install: false,
        async run() {
          await mkdir(join(target, 'src/routes'), { recursive: true });
          await writeFile(
            join(target, 'package.json'),
            `${JSON.stringify({
              dependencies: {
                '@tanstack/react-start': '1.168.28',
                '@tanstack/react-router': '1.168.28',
              },
            })}\n`,
          );
          await writeFile(
            join(target, 'src/routes/index.tsx'),
            'export const upstream = true;\n',
          );
          await writeOfficialRouterFiles(target);
        },
      });

      const result = await discoverApplicationGraph(
        join(target, 'src/application.ts'),
        'application',
      );
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.value.metadata.name).toBe('notes-product');
      expect(result.value.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'model', id: 'model.note' }),
        expect.objectContaining({ kind: 'aiAgent', name: 'notes-assistant' }),
        expect.objectContaining({ kind: 'authorityManifest' }),
      ]));
      expect(result.value.nodes.length).toBeLessThan(80);
      expect(result.value.nodes).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'model', id: 'model.conversation' }),
        expect.objectContaining({ kind: 'model', id: 'model.approval-review' }),
      ]));
    },
    30_000,
  );

  it(
    'emits an application entrypoint that the real compiler discovers as one graph',
    async () => {
      const temporaryRoot = join(process.cwd(), '.applik8s-tmp');
      await mkdir(temporaryRoot, { recursive: true });
      const parent = await mkdtemp(
        join(temporaryRoot, 'agentic-start-discovery-'),
      );
      temporaryDirectories.push(parent);
      const target = join(parent, 'research-workspace');

      await createApplicationAgenticStart({
        targetDirectory: target,
        applik8sVersion: 'workspace:*',
        example: 'research',
        install: false,
        async run() {
          await mkdir(join(target, 'src/routes'), { recursive: true });
          await writeFile(
            join(target, 'package.json'),
            `${JSON.stringify({
              dependencies: {
                '@tanstack/react-start': '1.168.28',
                '@tanstack/react-router': '1.168.28',
              },
            })}\n`,
          );
          await writeFile(
            join(target, 'src/routes/index.tsx'),
            'export const upstream = true;\n',
          );
          await writeOfficialRouterFiles(target);
        },
      });

      const result = await discoverApplicationGraph(
        join(target, 'src/application.ts'),
        'application',
      );
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.value.metadata.name).toBe('research-workspace');
      expect(
        result.value.nodes
          .filter((node) => node.kind === 'model')
          .map((model) => model.name),
      ).toContain(
        'ResearchNote',
      );
      expect(
        result.value.nodes
          .filter(
            (node) =>
              node.kind === 'gateway'
              && node.visibility === 'public',
          )
          .map((gateway) => gateway.name),
      ).toEqual(['web']);
      const dedicatedDeployment = compileApplicationDeploymentGraph({
        graph: result.value,
        sourceGraphDigest: `sha256:${'a'.repeat(64)}`,
        compilerVersion: '0.7.0',
        identity: {
          connection: {
            provider: 'kubernetes',
            cluster: 'orbstack',
            digest: `sha256:${'b'.repeat(64)}`,
          },
          application: 'research-workspace',
          controlPlaneNamespace: 'applik8s-system',
          instance: 'research-workspace',
          profile: 'dedicated',
        },
        strategy: 'kro',
        installationSpec: {
          name: 'research-workspace',
          profile: 'dedicated',
          providers: {
            identity: { issuer: 'https://identity.example.test' },
            objects: {
              deviceStorageClassName: 'dedicated-block',
              allowLoopDevices: true,
            },
            payments: {
              secretName: 'stripe-payments',
            },
            inference: {
              endpoint: 'https://inference.example.test',
              model: 'frontier',
              credentialSecretName: 'inference-credentials',
            },
          },
        },
        artifacts: [],
      });
      expect(
        dedicatedDeployment.graph.nodes.find(
          (node) =>
            node.kind === 'kubernetesDirect'
            && node.spec.compositionId === 'ory-platform-stack',
        ),
      ).toMatchObject({
        source: {
          semanticNodeId: 'provider.identity-provider.v1alpha1.primary',
        },
        lifecycle: {
          ownership: 'application',
          deletion: 'retain',
        },
        spec: {
          configuration: {
            name: 'research-workspace-identity',
            namespace: 'research-workspace-system',
            managed: {
              databases: false,
              secrets: false,
              routes: false,
            },
            hydra: {
              issuerUrl: 'https://identity.example.test',
            },
          },
        },
      });
      const rookOperator = dedicatedDeployment.graph.nodes.find(
        (node) =>
          node.kind === 'kubernetesDirect'
          && node.spec.compositionId === 'applik8s-rook-ceph-operator',
      );
      const rookPlatform = dedicatedDeployment.graph.nodes.find(
        (node) =>
          node.kind === 'kubernetesDirect'
          && node.spec.compositionId
            ===
              'applik8s-rook-ceph-external-operator-single-node-platform',
      );
      const objectClaim = dedicatedDeployment.graph.nodes.find(
        (node) =>
          node.kind === 'kubernetesDirect'
          && node.spec.compositionId === 'rook-object-storage-claim',
      );
      expect(rookOperator).toMatchObject({
        lifecycle: {
          ownership: 'shared',
          deletion: 'retain',
        },
        spec: {
          configuration: {
            name: 'applik8s-rook-operator',
            namespace: 'applik8s-rook-ceph-operator',
          },
        },
      });
      expect(rookPlatform).toMatchObject({
        lifecycle: {
          ownership: 'shared',
          deletion: 'retain',
        },
        spec: {
          configuration: {
            name: 'applik8s-rook',
            profile: 'single-node-development',
            namespace: 'applik8s-rook-ceph',
            operatorNamespace: 'applik8s-rook-ceph-operator',
            storageClassName: 'dedicated-block',
            allowLoopDevices: true,
            storageSize: '16Gi',
            objectStoreName: 'applik8s-object-store',
            bucketStorageClassName: 'applik8s-rook-buckets',
          },
        },
      });
      expect(objectClaim).toMatchObject({
        lifecycle: {
          ownership: 'application',
          deletion: 'delete',
        },
        spec: {
          configuration: {
            name: 'research-workspace-objects',
            namespace: 'research-workspace-system',
            storageClassName: 'applik8s-rook-buckets',
          },
        },
      });
      expect(dedicatedDeployment.graph.edges).toContainEqual({
        from: rookOperator?.id,
        to: rookPlatform?.id,
        relationship: 'requiresReady',
      });
      expect(dedicatedDeployment.graph.edges).toContainEqual({
        from: rookPlatform?.id,
        to: objectClaim?.id,
        relationship: 'requiresReady',
      });
      const starterDeployment = compileApplicationDeploymentGraph({
        graph: result.value,
        sourceGraphDigest: `sha256:${'c'.repeat(64)}`,
        compilerVersion: '0.7.0',
        identity: {
          connection: {
            provider: 'kubernetes',
            cluster: 'orbstack',
            digest: `sha256:${'b'.repeat(64)}`,
          },
          application: 'research-workspace',
          controlPlaneNamespace: 'applik8s-system',
          instance: 'research-workspace-starter',
          profile: 'starter',
        },
        strategy: 'kro',
        installationSpec: {
          name: 'research-workspace',
          profile: 'starter',
        },
        artifacts: [],
      });
      expect(
        starterDeployment.graph.nodes.some(
          (node) =>
            node.kind === 'kubernetesDirect'
            && ['ory-platform-stack', 'opensearch-cluster', 'envoy-ai-gateway']
              .includes(node.spec.compositionId),
        ),
      ).toBe(false);
      const externalDeployment = compileApplicationDeploymentGraph({
        graph: result.value,
        sourceGraphDigest: `sha256:${'d'.repeat(64)}`,
        compilerVersion: '0.7.0',
        identity: {
          connection: {
            provider: 'kubernetes',
            cluster: 'orbstack',
            digest: `sha256:${'b'.repeat(64)}`,
          },
          application: 'research-workspace',
          controlPlaneNamespace: 'applik8s-system',
          instance: 'research-workspace-external',
          profile: 'external',
        },
        strategy: 'kro',
        installationSpec: {
          name: 'research-workspace',
          profile: 'external',
          providers: {
            database: {
              clusterName: 'external-postgres',
              namespace: 'database-system',
              database: 'research',
              connectionSecretName: 'postgres-connection',
            },
            analytics: {
              endpoint: 'https://analytics.example.test',
            },
            events: {
              server: 'nats://events.example.test:4222',
            },
            objects: {
              endpoint: 'https://objects.example.test',
              bucket: 'research',
              region: 'us-east-1',
              credentialsSecretName: 'object-credentials',
            },
            workflows: {
              hostPort: 'workflows.example.test:7070',
              apiUrl: 'https://workflows.example.test',
              tokenSecretName: 'workflow-token',
            },
            search: {
              endpoint: 'https://search.example.test',
            },
            inference: {
              endpoint: 'https://inference.example.test',
              model: 'frontier',
              credentialSecretName: 'inference-credentials',
            },
            identity: {
              kind: 'ory',
              issuer: 'https://identity.example.test',
              publicUrl: 'https://identity.example.test',
              adminUrl: 'https://identity-admin.example.test',
            },
            payments: {
              secretName: 'stripe-payments',
            },
          },
        },
        artifacts: [],
      });
      expect(
        externalDeployment.graph.nodes.filter(
          (node) =>
            node.kind === 'kubernetesDirect'
            && node.source.semanticNodeId?.startsWith('provider.') === true,
        ),
      ).toEqual([]);
      expect(
        result.value.nodes
          .filter((node) => node.kind === 'aiAgent')
          .map((agent) => agent.name),
      ).toContain(
        'researcher',
      );
      // install:false deliberately skips the generator's drizzle-kit step.
      // Seed the committed artifact boundary so this test can exercise the
      // compiler rather than stopping at the expected migration prerequisite.
      await mkdir(join(target, 'drizzle'), { recursive: true });
      await writeFile(
        join(target, 'drizzle', '0000_compiler_contract.sql'),
        'SELECT 1;\n',
      );
      const serverSource = 'export default {};\n';
      const serverDigest = createHash('sha256')
        .update(serverSource)
        .digest('hex');
      const artifacts = [{
        path: 'server/index.mjs',
        bytes: Buffer.byteLength(serverSource),
        digest: serverDigest,
      }];
      await mkdir(join(target, '.output', 'server'), { recursive: true });
      await mkdir(join(target, '.applik8s', 'web-artifacts'), {
        recursive: true,
      });
      await writeFile(
        join(target, '.output', 'server', 'index.mjs'),
        serverSource,
      );
      await writeFile(
        join(target, '.applik8s', 'web-artifacts', 'server.json'),
        `${JSON.stringify({
          apiVersion: 'applik8s.webArtifact/v1alpha1',
          application: 'src/application.ts',
          output: '.output',
          target: 'server',
          digest: `sha256:${createHash('sha256').update(JSON.stringify(artifacts)).digest('hex')}`,
          entrypoint: 'server/index.mjs',
          artifacts,
        })}\n`,
      );
      const compiled = await compileTypeKroComposition({
        entrypoint: join(target, 'src/application.ts'),
        compositionName: 'application',
        outDir: join(target, '.applik8s', 'build'),
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
      expect(
        compiled.ok,
        compiled.ok ? undefined : compiled.error.message,
      ).toBe(true);
      if (!compiled.ok) return;
      const searchWorker = compiled.value.artifacts.reactiveArtifacts.find(
        (artifact) => artifact.kind === 'searchProjectionWorker',
      );
      expect(searchWorker).toMatchObject({
        kind: 'searchProjectionWorker',
        name: expect.stringContaining('research-notes-search'),
      });
      const searchWorkerSource = await readFile(
        searchWorker?.sourcePath ?? '',
        'utf8',
      );
      expect(searchWorkerSource).toContain('.synchronize(');
      expect(searchWorkerSource).toContain('.rebuild(');
      expect(searchWorkerSource).toContain(
        'ApplicationSearchHistoryLossError',
      );
      const searchGateway = compiled.value.artifacts.reactiveArtifacts.find(
        (artifact) =>
          artifact.kind === 'queryGateway'
          && artifact.name.includes('researcher-tool'),
      );
      expect(searchGateway).toBeDefined();
      const searchGatewayEntrypoint = await readFile(
        join(
          searchGateway?.sourcePath ? dirname(searchGateway.sourcePath) : '',
          'gateway.generated.ts',
        ),
        'utf8',
      );
      expect(
        searchGatewayEntrypoint.indexOf(
          "const cursorSecret = requiredEnv('APPLIK8S_CURSOR_SECRET');",
        ),
      ).toBeGreaterThan(-1);
      expect(
        searchGatewayEntrypoint.indexOf(
          "const cursorSecret = requiredEnv('APPLIK8S_CURSOR_SECRET');",
        ),
      ).toBeLessThan(
        searchGatewayEntrypoint.indexOf(
          'createPostgresApplicationSearchRuntime({',
        ),
      );
      const searchWorkerDeployment = searchWorker?.resources.find(
        (resource) => resource.kind === 'Deployment',
      );
      const serializedSearchWorkerDeployment = JSON.stringify(
        searchWorkerDeployment,
      );
      expect(serializedSearchWorkerDeployment).toContain(
        'NODE_EXTRA_CA_CERTS',
      );
      expect(serializedSearchWorkerDeployment).toContain(
        'research-workspace-search-http-cert',
      );
      expect(serializedSearchWorkerDeployment).toContain(
        'schema.spec.providers.search.credentialsSecretName',
      );
      expect(serializedSearchWorkerDeployment).not.toContain(
        '"${schema.spec.providers.search.credentialsSecretName}"',
      );
    },
    120_000,
  );
});

async function writeOfficialRouterFiles(target: string): Promise<void> {
  await writeFile(
    join(target, 'src/routes/__root.tsx'),
    `import { createRootRoute, Outlet } from '@tanstack/react-router';
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
  );
  await writeFile(
    join(target, 'src/router.tsx'),
    `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}
`,
  );
}
