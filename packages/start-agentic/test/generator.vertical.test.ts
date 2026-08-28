// typecast-file-boundary: Generator tests inspect emitted files and manifests after asserting their generated shape.
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type ApplicationGraph,
  deriveApplicationGraphFoundation,
} from '@applik8s/core';
import {
  compileTypeKroComposition,
  discoverApplicationGraph,
} from '@applik8s/compiler';
import {
  compileApplicationAwsDeploymentPlan,
  compileApplicationDeploymentGraph,
  compileLocalApplicationPlan,
  compileLocalSupervisorPlan,
} from '@applik8s/deployment-compiler';
import { applicationPlanSelectionResolver } from '@applik8s/dev';
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
    expect(result.files).toHaveLength(43);
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
    expect(researchView).toContain(
      'data-applik8s-provenance="query.Conversation.listConversations"',
    );
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
    expect(workspaceModel).toContain("'workspace-membership-bootstrap'");
    expect(workspaceModel).toContain('WorkspaceTable.create.beforeCommit(');
    expect(workspaceModel).toContain(
      'Workspace identity, ownership, lifecycle state, and timestamps are server-owned.',
    );
    expect(workspaceModel).toContain("input.role !== 'workspace-owner'");
    expect(workspaceModel).toContain(
      'principal.serviceIdentity?.id !== WorkspaceMembershipBootstrapIdentity.identity.id',
    );
    expect(workspaceModel).toContain(
      'Workspace ownership cannot be granted through an invitation.',
    );
    expect(workspaceModel).toContain(
      "WHEN ${WorkspaceTable.ownerPrincipalId} = ${context.principal.id}",
    );
    expect(workspaceModel).toContain(
      "const Authenticated = application.role('authenticated')",
    );
    expect(workspaceModel).toContain(
      'export const WorkspaceId = AgenticWorkspaceId;',
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
    expect(workspaceView).toContain('useEffect(() => {');
    expect(workspaceModel).toContain(
      'Authenticated.can(',
    );
    expect(workspaceModel).toContain(
      'WorkspaceDashboard,',
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
    expect(researchView).toContain('persistence: true');
    expect(researchView).not.toContain(
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
      'agenticPrincipalScope(context)',
    );
    const billingModel = await readFile(
      join(target, 'src/features/billing.tsx'),
      'utf8',
    );
    expect(billingModel).toContain('agenticPrincipalScope(context)');
    expect(billingModel).not.toContain(
      'applicationAIConversationPrincipalScope',
    );
    expect(researchModel).toContain('scope: AgenticPrincipalScope');
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
    expect(conversationModel).toContain('agenticPrincipalScope(context)');
    expect(conversationModel).toContain(
      'Authenticated.can(',
    );
    expect(conversationModel).toContain(
      "field !== 'title' && field !== 'archivedAt'",
    );
    expect(researchView).toContain(
      'const updateConversation = Conversation.update.useMutation()',
    );
    expect(researchView).not.toContain('setMessages(initialMessages)');
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
    expect(modules).toContain(
      "application.role('application-operator').bootstrap({",
    );
    expect(modules).toContain(
      "id: 'identity:deterministic:local-developer'",
    );
    expect(modules).not.toContain('conversations: Conversations,');
    expect(modules).not.toContain('maintainedCommands');
    expect(modules).not.toContain('Conversation: Conversations.Conversation');
    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
      readonly imports: Readonly<Record<string, string>>;
      readonly applik8s: Readonly<Record<string, string>>;
    };
    expect(manifest.scripts.plan).toBe('bun run build && applik8s plan');
    expect(manifest.scripts.deploy).toBe('bun run build && applik8s deploy');
    expect(manifest.scripts['dev:cluster']).toBe(
      'bun run build && applik8s deploy --development --instance kubernetes/application.yaml',
    );
    expect(manifest.scripts['dev:live']).toBe(
      'bun run build && applik8s deploy --development --instance kubernetes/application.developer.yaml',
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
    expect(manifest.scripts.dev).toBe('vite');
    expect(manifest.devDependencies['@applik8s/compiler']).toBeUndefined();
    expect(manifest.devDependencies.typekro).toBeUndefined();
    expect(manifest.dependencies['@tanstack/react-router']).toBe('1.170.18');
    expect(manifest.devDependencies.nitro).toBe(
      'npm:nitro-nightly@3.0.1-20260715-190547-7af4fee3',
    );
    expect(manifest.dependencies['@applik8s/start-agentic']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/operations-ui']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/ai-tanstack']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/identity']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-s3']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/client']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/core']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-contract']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-ai']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-aws']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-celld']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-duckdb']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-kubernetes']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-nats']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-otel']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-postgres']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/identity-ory']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/notifications-smtp']).toBe('workspace:*');
    expect(manifest.dependencies['@tanstack/ai-react']).toBe('0.19.3');
    expect(manifest.dependencies['@tanstack/ai-persistence']).toBe('0.1.5');
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
    expect(rootRoute).toContain(
      "import { AgenticAccountSession } from '@applik8s/start-agentic/react';",
    );
    expect(rootRoute).toContain('<AgenticAccountSession />');
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
    await expect(
      stat(join(target, 'src/features/account/session.tsx')),
    ).rejects.toThrow();
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
    const target = join(parent, 'documents-product');
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
    expect(result.files.length).toBeLessThanOrEqual(
      applicationAgenticStartDefinition.generator.maximumApplicationFiles,
    );
    expect(progress).toEqual(['scaffold', 'templates', 'validation']);
    const accountRoute = await readFile(
      join(target, 'src/routes/app.account.tsx'),
      'utf8',
    );
    expect(accountRoute).toContain(
      "import { AgenticAccountSettings } from '@applik8s/start-agentic/react';",
    );
    expect(accountRoute).toContain('<AgenticAccountSettings');
    const accountSessionLoader = await readFile(
      join(target, 'src/features/account/session-loader.ts'),
      'utf8',
    );
    expect(accountSessionLoader).toContain('return undefined;');
    expect(accountSessionLoader).toContain(
      "session.capabilities?.workspaceSelection !== 'admitted'",
    );
    expect(accountSessionLoader).not.toContain(
      'applicationIdentityHttpProtocol',
    );
    await expect(
      stat(join(target, 'src/features/account/settings.tsx')),
    ).rejects.toThrow();
    const conversationModel = await readFile(
      join(target, 'src/features/conversations/model.ts'),
      'utf8',
    );
    expect(conversationModel).toContain(
      'Conversations.Conversation.update.beforeCommit(',
    );
    expect(conversationModel).toContain(
      'Conversations.Conversation.update.all()',
    );
    expect(conversationModel).toContain(
      "field !== 'title' && field !== 'archivedAt'",
    );
    const lifecycleModel = await readFile(
      join(target, 'src/features/lifecycle/model.ts'),
      'utf8',
    );
    expect(lifecycleModel).toContain(
      'DataLifecycleRequestTable.create.beforeCommit(',
    );
    expect(lifecycleModel).toContain(
      'DataLifecycleRequestTable.on.create(',
    );
    expect(lifecycleModel).toContain(
      "state: 'actionRequired'",
    );
    expect(lifecycleModel).toContain(
      'principalScope: agenticWorkspaceScope(context)',
    );
    expect(lifecycleModel).not.toContain(
      ": request.value.targetId\n              : principalId",
    );
    expect(lifecycleModel).toContain('await Document.delete({ identity });');
    expect(lifecycleModel).toContain(
      'await Conversations.Conversation.update({',
    );
    const lifecycleUi = await readFile(
      join(target, 'src/features/account/identity-flow.tsx'),
      'utf8',
    );
    expect(lifecycleUi).toContain(
      "await requestLifecycle({\n      scope: 'account'",
    );
    expect(lifecycleUi).not.toContain('for (const document');

    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly applik8s: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
      readonly imports: Readonly<Record<string, string>>;
    };
    expect(manifest.applik8s.context).toBe('orbstack');
    expect(manifest.scripts).toMatchObject({
      'generate-routes': 'tsr generate',
      typecheck: 'bun run generate-routes && tsc --noEmit',
      test: 'vitest run',
      lint: 'biome lint src test vite.config.ts vitest.config.ts',
      doctor: 'applik8s doctor',
      check:
        'bun run typecheck && bun run lint && bun run test && bun run build && bun run app:check && bun run db:check',
    });
    expect(manifest.dependencies['@applik8s/operations-ui']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/conversations']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/data-lifecycle']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/approvals']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/artifacts']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/evals']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/runtime-s3']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/billing']).toBe('workspace:*');
    expect(manifest.dependencies['@applik8s/billing-stripe']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/notifications']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/runtime-hatchet']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/usage']).toBe('workspace:*');
    expect(manifest.dependencies['class-variance-authority']).toBe('0.7.1');
    expect(manifest.dependencies['lucide-react']).toBe('1.31.0');
    expect(manifest.dependencies['radix-ui']).toBe('1.6.7');
    expect(manifest.dependencies['react-markdown']).toBe('10.1.0');
    expect(manifest.dependencies['remark-gfm']).toBe('4.0.1');
    expect(manifest.devDependencies.typescript).toBe('^5.3.0');
    expect(manifest.dependencies['tailwind-merge']).toBe('3.6.0');
    expect(manifest.imports['#components/*']).toBe('./src/components/*.tsx');
    expect(manifest.devDependencies.tailwindcss).toBe('4.3.3');
    expect(manifest.devDependencies.shadcn).toBe('4.18.0');
    expect(manifest.devDependencies['@tailwindcss/vite']).toBe('4.3.3');
    const readme = await readFile(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('Starter profile is credential-free');
    expect(readme).toContain('web-only');
    expect(readme).toContain('dev:live');
    expect(readme).toContain(
      'APPLIK8S_DEVELOPMENT_SHARED_FILESYSTEM=1',
    );
    expect(readme).toContain('applik8s.context');
    expect(readme).toContain('Starter lineage');
    expect(readme).toContain('bunx shadcn add <component>');
    expect(
      await readFile(join(target, 'components.json'), 'utf8'),
    ).toContain('"style": "base-nova"');
    expect(
      await readFile(join(target, 'src/components/ui/button.tsx'), 'utf8'),
    ).toContain('buttonVariants = cva(');
    const environment = await readFile(join(target, '.env.example'), 'utf8');
    expect(environment).not.toContain('APPLIK8S_PROFILE=');
    expect(environment).not.toContain('APPLIK8S_CONTEXT=');
    const productStyles = await readFile(
      join(target, 'src/styles.css'),
      'utf8',
    );
    expect(productStyles).toContain(
      '.account-surface .agentic-account-settings',
    );
    expect(productStyles).toContain(
      '--applik8s-operations-danger-surface: #2a1716',
    );
    const databaseSchema = await readFile(
      join(target, 'src/database-schema.ts'),
      'utf8',
    );
    expect(databaseSchema).toContain(
      'export { DecisionReview, decisionReviewState }',
    );
    const productWorkspaceSchema = await readFile(
      join(target, 'src/features/workspaces/schema.ts'),
      'utf8',
    );
    const productAIUsageBudget = await readFile(
      join(target, 'src/features/budgets/model.ts'),
      'utf8',
    );
    const onboardingSchema = await readFile(
      join(target, 'src/features/onboarding/schema.ts'),
      'utf8',
    );
    expect(onboardingSchema).toContain(
      "field.text('completed_steps').array()",
    );
    expect(onboardingSchema).not.toContain("field.jsonb('completed_steps')");
    const lineage = JSON.parse(
      await readFile(
        join(target, '.applik8s/start-lineage.json'),
        'utf8',
      ),
    ) as {
      readonly example: string;
      readonly projectName: string;
      readonly templateRevision: string;
      readonly files: Readonly<Record<string, string>>;
    };
    expect(lineage).toMatchObject({
      example: 'product',
      projectName: 'documents-product',
      templateRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(lineage.files['src/routes/index.tsx']).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    const notesModel = await readFile(
      join(target, 'src/features/documents/model.ts'),
      'utf8',
    );
    expect(notesModel).toContain("const documentWorkspace = module(");
    expect(notesModel).toContain('currentApplication.include(maintainedDocuments)');
    expect(notesModel).not.toContain('ApplicationModelViewContext');
    const documentsView = await readFile(
      join(target, 'src/features/documents/view.tsx'),
      'utf8',
    );
    expect(documentsView).toContain('data-applik8s-provenance="query.document-list"');
    const productModulesSource = await readFile(
      join(target, 'src/modules.ts'),
      'utf8',
    );
    expect(productModulesSource).toContain('Billing.Subscription.find({');
    expect(productModulesSource).toContain('if (!billable) return;');
    const notesSchema = await readFile(
      join(target, 'src/features/documents/schema.ts'),
      'utf8',
    );
    expect(notesSchema).toContain('applicationDocuments as Document');
    expect(notesSchema).toContain("from '@applik8s/documents/schema'");
    const developerInstallation = await readFile(
      join(target, 'kubernetes/application.developer.yaml'),
      'utf8',
    );
    expect(developerInstallation).toContain('OPENROUTER_API_KEY');
    expect(developerInstallation).toContain('STRIPE_SECRET_KEY');
    expect(developerInstallation).toContain('STRIPE_WEBHOOK_SECRET');
    expect(developerInstallation).toContain(
      'endpoint: https://api.stripe.com/v1',
    );
    const home = await readFile(
      join(target, 'src/routes/app.index.tsx'),
      'utf8',
    );
    expect(home).toContain('createApplicationTanStackConnection');
    expect(home).toContain('agent: WorkspaceAssistant');
    expect(home).toContain('readAgenticWorkspaceSelection()');
    expect(home).toContain('<WorkspaceAssistantCard key={threadId}');
    expect(home).not.toContain('pending-conversation');
    expect(home).toContain('documents.refresh()');
    expect(home).toContain('What should we accomplish?');
    expect(home).not.toContain('Create manually');
    expect(home).toContain('Workspace assistant');
    expect(home).not.toMatch(/\bNotes assistant\b/u);
    const inboxView = await readFile(
      join(target, 'src/features/inbox/view.tsx'),
      'utf8',
    );
    expect(inboxView).toContain('const [workspaceId, setWorkspaceId] = useState<string>();');
    expect(inboxView).toContain('setWorkspaceId(readAgenticWorkspaceSelection())');
    expect(inboxView).not.toContain('useState<string | undefined>(() =>');
    expect(inboxView).toContain("workspaceSelectionLoaded && workspaces.phase !== 'loading'");
    const libraryView = await readFile(
      join(target, 'src/features/library/view.tsx'),
      'utf8',
    );
    expect(libraryView).toContain("library.phase === 'error'");
    expect(libraryView).toContain("library.phase === 'reconnecting'");
    expect(libraryView).toContain('library.data.artifacts.length === 0');
    expect(libraryView).toContain('Publish a Document to preserve an immutable Markdown output');
    expect(libraryView).not.toContain('library.data.documents');
    const libraryModel = await readFile(
      join(target, 'src/features/library/model.ts'),
      'utf8',
    );
    expect(libraryModel).toContain('return listApplicationArtifacts(_input, context, {');
    expect(libraryModel).toContain('return loadApplicationArtifact(input, context, {');
    expect(libraryModel).not.toContain('artifacts.map(item => ({ ...item,');
    const documentsModel = await readFile(
      join(target, 'src/features/documents/model.ts'),
      'utf8',
    );
    expect(documentsModel).toContain('DocumentTable.on.update(');
    expect(documentsModel).toContain('await ArtifactObjects.put({');
    expect(documentsModel).toContain('await Artifacts.Artifact.create({');
    expect(documentsModel).toContain('DocumentPublicationArtifacts');
    expect(documentsModel).toContain(
      'principalScope: updated.current.principalScope',
    );
    expect(documentsModel).toContain('agenticWorkspaceScope(context)');
    expect(documentsModel).toContain('scope: WorkspaceId');
    expect(documentsModel).toContain('selectApplicationTanStackTools(');
    expect(documentsModel).toContain("'Document.create': DocumentTable.create");
    expect(documentsModel).toContain("context.principal.executionContext?.kind === 'agent'");
    expect(documentsModel).toContain('sourceConversationId: agentExecution.threadId');
    expect(documentsModel).toContain('sourceRunId: agentExecution.runId');
    expect(documentsModel).toContain('listApplicationDocuments(input, context, {');
    await expect(readFile(
      join(target, 'src/features/documents/queries.ts'),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' });
    expect(documentsModel).not.toContain('For every Document.create or Document.update in this run');
    const agentsModel = await readFile(
      join(target, 'src/features/agents/model.ts'),
      'utf8',
    );
    expect(agentsModel).toContain('const AgentReleaseGate = AgentProfileTable.view({');
    expect(agentsModel).toContain('qualifiedVersion: AgentProfileTable.qualifiedVersion');
    expect(agentsModel).toContain('qualificationScore: AgentProfileTable.qualificationScore');
    expect(agentsModel).toContain('result?.qualifiedVersion === input.version');
    expect(agentsModel).not.toContain('.from(Evaluations.EvaluationResult)');
    expect(agentsModel).toContain('Run and pass the deterministic runtime-contract gate before publishing this revision.');
    expect(agentsModel).toContain('Published agent versions are immutable.');
    expect(agentsModel).toContain(
      'profile.patch({ spec: { principalScope: agenticWorkspaceScope(context) } })',
    );
    expect(agentsModel).toContain("'knowledgeSourceIds'");
    expect(agentsModel).toContain("'memoryWindowMessages'");
    expect(agentsModel).toContain('assertApplicationAgentExecutionContract(profile.value)');
    expect(agentsModel).toContain('version: profile.value.version + 1');
    expect(agentsModel).toContain('profile.value.qualifiedVersion !== profile.value.version');
    expect(agentsModel).toContain('loadApplicationAgentProfileVersion(input, context, agentQueries)');
    expect(agentsModel).toContain("currentApplication.role('application-operator')");
    expect(agentsModel).toContain('ApplicationOperator.can(');
    expect(agentsModel).not.toContain('qualifiedRevision');
    const agentsView = await readFile(
      join(target, 'src/features/agents/view.tsx'),
      'utf8',
    );
    expect(agentsView).toContain('Selections resolve to compiled operation handles.');
    expect(agentsView).toContain("selected?.state === 'draft'");
    expect(agentsView).toContain('Knowledge access');
    expect(agentsView).toContain('These budgets are enforced by the application-owned agent loop');
    const knowledgeModel = await readFile(
      join(target, 'src/features/knowledge/model.ts'),
      'utf8',
    );
    expect(knowledgeModel).toContain(
      'context.principal.serviceIdentity?.id === KnowledgeWorker.identity.id',
    );
    expect(knowledgeModel).toContain('Uploaded knowledge must be verified by the object provider');
    expect(knowledgeModel).toContain('verifyApplicationObjectCompletionReceipt({');
    expect(knowledgeModel).toContain('authorizationVersion: context.principal.authorityRevision');
    expect(knowledgeModel).toContain("store: 'agentic-artifacts'");
    expect(knowledgeModel).toContain('sha256: input.sha256');
    expect(knowledgeModel).toContain('Uploaded knowledge completion evidence is invalid or no longer authorized.');
    expect(knowledgeModel).toContain('agenticWorkspaceScope(context)');
    expect(knowledgeModel).toContain("'starter.knowledge.ingest.v1'");
    expect(knowledgeModel).toContain('const bytes = await ArtifactObjects.get(input.objectKey)');
    expect(knowledgeModel).toContain('KnowledgeSourceTable.on.create(');
    expect(knowledgeModel).toContain("currentApplication.index(\n    'workspace-knowledge-search'");
    expect(knowledgeModel).toContain("authorizationFields: ['principalScope']");
    expect(knowledgeModel).toContain('KnowledgeSearch.search');
    expect(knowledgeModel).toContain("currentApplication.role('application-operator')");
    const assistantQuery = await readFile(
      join(target, 'src/features/documents/assistant-query.ts'),
      'utf8',
    );
    expect(documentsModel).toContain('applicationKnowledgeContext(knowledge)');
    expect(assistantQuery).toContain('assembleApplicationKnowledgeContext(sources');
    expect(assistantQuery).toContain('maximumBytes: 48_000');
    expect(knowledgeModel).toContain("processingStage: 'search-projection-pending'");
    const knowledgeView = await readFile(
      join(target, 'src/features/knowledge/view.tsx'),
      'utf8',
    );
    expect(knowledgeView).toContain('ArtifactObjects.createUpload({');
    expect(knowledgeView).toContain('ArtifactObjects.completeUpload({');
    expect(knowledgeView).toContain('id: verified.objectId');
    expect(knowledgeView).toContain('Checking integrity…');
    expect(knowledgeView).toContain('We’ll extract and index it after upload.');
    const evaluationsModel = await readFile(
      join(target, 'src/features/evaluations/model.ts'),
      'utf8',
    );
    expect(evaluationsModel).toContain('EvaluationRun.on.create(');
    expect(evaluationsModel).toContain("logicalModel.startsWith('agent:')");
    expect(evaluationsModel).toContain("profile.tools.includes('Document.create')");
    expect(evaluationsModel).toContain('AgentEvaluationProcessor');
    expect(evaluationsModel).toContain('runtimeContract,');
    expect(evaluationsModel).toContain('qualifiedVersion: profile.version');
    expect(evaluationsModel).toContain('executeApplicationDeterministicAgentCase({');
    expect(evaluationsModel).toContain("evidenceKind: runtimeContract ? 'deterministic-runtime-contract'");
    expect(evaluationsModel).not.toContain('qualifiedRevision');
    expect(evaluationsModel).toContain('export const EvaluationDataset = Evaluations.Dataset');
    expect(evaluationsModel).toContain('ApplicationOperator.can(\n  Evaluations.EvaluationRun.create,\n  AgentEvaluationRuns,');
    expect(evaluationsModel).not.toContain('Evaluations.Dataset.update');
    expect(evaluationsModel).not.toContain('Evaluations.Case.update');
    expect(evaluationsModel).not.toContain('Evaluations.Scorer.update');
    const evaluationsView = await readFile(
      join(target, 'src/features/evaluations/view.tsx'),
      'utf8',
    );
    expect(evaluationsView).toContain('Versioned evaluation catalog');
    expect(evaluationsView).toContain('Regression');
    expect(evaluationsView).toContain('Run runtime gate');
    const integrationsView = await readFile(
      join(target, 'src/features/integrations/view.tsx'),
      'utf8',
    );
    expect(integrationsView).toContain('PaymentProvider');
    expect(integrationsView).toContain('OPENROUTER_API_KEY');
    expect(integrationsView).toContain('Request operator setup');
    const billingModel = await readFile(
      join(target, 'src/features/billing.tsx'),
      'utf8',
    );
    expect(billingModel).toContain('await requirePublishedBillingPlan(request.input.plan)');
    expect(billingModel).toContain('await requirePublishedBillingPlan(event.plan)');
    expect(billingModel).toContain('await applicationBillingPlans.find({');
    expect(integrationsView).toContain('secrets never enter this page.');
    const integrationsModel = await readFile(
      join(target, 'src/features/integrations/model.ts'),
      'utf8',
    );
    expect(integrationsModel).toContain('agenticWorkspaceScope(context)');
    expect(integrationsModel).toContain('Only the server-side connection authority may change provider state.');
    const billing = await readFile(
      join(target, 'src/features/billing.tsx'),
      'utf8',
    );
    expect(billing).toContain('agenticWorkspaceScope(context)');
    expect(billing).toContain('export const ReserveWorkspaceAIRun = AIUsageReservation.create');
    expect(billing).toContain('canManageWorkspaceBilling(context)');
    expect(billing).toContain('const returnTo = trustedBillingReturnUrl(');
    expect(billing).toContain('request.input.returnTo,');
    expect(billing).toContain('context.requestOrigin,');
    expect(billing).toContain('async function loadStarterSubscription(');
    expect(billing).toContain('await loadStarterSubscription(principalScope)');
    expect(billing).toContain('await Billing.Subscription.find({');
    expect(billing).not.toContain('const StarterSubscriptionState =');
    expect(billing).toContain("if (result.mode === 'simulated')");
    expect(billing).toContain('await Billing.Subscription.create({');
    expect(billing).toContain('await Billing.Subscription.update({');
    expect(billing).toContain('Billing.Subscription.create.applicationPolicy()');
    expect(billing).toContain('Billing.Subscription.update.applicationPolicy()');
    expect(billing).toContain('customerId: providerCustomerId');
    expect(documentsModel).toContain('if (workspaceId) {');
    expect(documentsModel).toContain('await ReserveWorkspaceAIRun({');
    expect(documentsModel).not.toContain('The workspace assistant requires an admitted workspace.');
    expect(productAIUsageBudget).toContain('const reservation = await AIUsageReservationTable.get(');
    expect(productAIUsageBudget).toContain('if (!reservation) return;');
    expect(documentsModel).toContain('maximumTokens: 72_000');
    expect(documentsModel).toContain('maximumCostMicrounits: 500_000');
    expect(documentsModel).toContain('maximumInputTokens: 64_000');
    expect(documentsModel).toContain('maximumOutputTokens: 8_000');
    expect(productWorkspaceSchema).toContain("model('ai_usage_budget_ledgers'");
    expect(productWorkspaceSchema).toContain("model('ai_usage_reservations'");
    expect(productAIUsageBudget).toContain("'starter.ai-usage-reservation.release.v1'");
    expect(productAIUsageBudget).toContain("'starter.ai-usage-reservation.settle.v1'");
    expect(productAIUsageBudget).toContain('Usage.UsageFact.on.create(');
    expect(productAIUsageBudget).toContain('await SettleAIUsageReservation.start(');
    expect(billing).toContain("rawType: 'checkout.completed'");
    expect(billing).toContain(
      'applicationBillingSubscriptionResumeInputSchema as ResumeSubscriptionInput',
    );
    const billingPolicy = await readFile(
      join(target, 'src/features/billing-policy.ts'),
      'utf8',
    );
    expect(billingPolicy).toContain("role === 'workspace-owner'");
    expect(billingPolicy).toContain(
      'if (typeof workspaceId !== \'string\' || !workspaceId.trim()) return true;',
    );
    const scopedConversationModel = await readFile(
      join(target, 'src/features/conversations/model.ts'),
      'utf8',
    );
    expect(scopedConversationModel).toContain('agenticWorkspaceScope(context)');
    expect(scopedConversationModel).toContain('Conversations.ProtocolRun');
    expect(scopedConversationModel).toContain('terminalReason: run.terminalReason');
    const artifactRoute = await readFile(
      join(target, 'src/routes/app.artifacts.$artifactId.tsx'),
      'utf8',
    );
    expect(artifactRoute).toContain('DownloadArtifact({ id: detail.data.id })');
    expect(artifactRoute).not.toContain('objectKey');
    expect(artifactRoute).toContain('Download artifact');
    expect(libraryModel).not.toContain('ArtifactDownloadTarget');
    expect(libraryModel).toContain('await Artifacts.Artifact.require(request.input.id)');
    expect(libraryModel).toContain('scope: agenticWorkspaceScope');
    expect(libraryModel).toContain('ArtifactObjects.signDownload({ key: artifact.objectKey })');
    const administrationModel = await readFile(
      join(target, 'src/features/administration/model.ts'),
      'utf8',
    );
    expect(administrationModel).toContain('PlatformTenants');
    expect(administrationModel).toContain('PlatformCatalog');
    expect(administrationModel).not.toContain('providerCustomerId');
    const administrationView = await readFile(
      join(target, 'src/features/administration/view.tsx'),
      'utf8',
    );
    expect(administrationView).toContain('export function TenantDirectory');
    expect(administrationView).toContain('Product catalog');
    expect(
      await readFile(join(target, 'src/routes/admin.tenants.$tenantId.tsx'), 'utf8'),
    ).toContain('TenantAdministration');
    const documentDetailRoute = await readFile(
      join(target, 'src/routes/app.documents.$documentId.tsx'),
      'utf8',
    );
    expect(documentDetailRoute).toContain("detail.phase === 'error'");
    expect(documentDetailRoute).toContain('setReviewRequested(true)');
    expect(documentDetailRoute).toContain(
      "document.state === 'in-review' || reviewRequested",
    );
    expect(documentDetailRoute).toContain('Open review Inbox');
    expect(documentDetailRoute).toContain('aria-label="Document state"');
    expect(documentsModel).toContain(
      'const nextVersion = document.value.version + 1;',
    );
    expect(documentsModel).toContain("'publishedAt' in input.patch");
    expect(documentsModel).toContain("requestedState === 'published' ? { publishedAt: context.now }");
    expect(documentsModel).toContain('Only draft documents may be edited.');
    expect(documentsModel).toContain('version: nextVersion');
    expect(documentsModel).toContain('revision: nextVersion');
    const inboxModel = await readFile(
      join(target, 'src/features/inbox/model.ts'),
      'utf8',
    );
    expect(inboxModel).toContain('targetKey: review.value.documentId');
    expect(inboxModel).toContain('selectedAgenticWorkspaceId(context)');
    expect(inboxModel).toContain('The requested Inbox is outside the server-admitted workspace scope.');
    expect(inboxModel).toContain(
      'idempotencyKey: `document-review:${review.value.id}`',
    );
    expect(inboxModel).toContain('DecisionWorker.can(');
    expect(inboxModel).toContain('DecisionReview.update.all()');
    expect(inboxModel).toContain('Document.update.all()');
    const markdownDocument = await readFile(
      join(target, 'src/components/markdown-document.tsx'),
      'utf8',
    );
    expect(markdownDocument).toContain('export function documentTitle');
    expect(markdownDocument).toContain('<table');
    expect(markdownDocument).toContain('h1: props => <h2');
    expect(markdownDocument).not.toContain('dangerouslySetInnerHTML');
    expect(
      await readFile(join(target, 'src/routes/app.artifacts.$artifactId.tsx'), 'utf8'),
    ).toContain("detail.phase === 'reconnecting'");
    const appLayout = await readFile(
      join(target, 'src/routes/app.tsx'),
      'utf8',
    );
    expect(appLayout).toContain('<Outlet />');
    expect(appLayout).toContain('notFoundComponent: RouteNotFound');
    const setupRoute = await readFile(
      join(target, 'src/routes/app.setup.tsx'),
      'utf8',
    );
    expect(setupRoute).not.toContain('groupHasEvidence');
    const rootRoute = await readFile(
      join(target, 'src/routes/__root.tsx'),
      'utf8',
    );
    expect(rootRoute).toContain('errorComponent: RouteErrorBoundary');
    expect(rootRoute).toContain('<AppShell><Outlet /></AppShell>');
    const appShell = await readFile(
      join(target, 'src/components/app-shell.tsx'),
      'utf8',
    );
    expect(appShell).toContain('if (admissionRoute)');
    expect(appShell).toContain("pathname === '/sign-up'");
    expect(appShell).toContain('cannot issue workspace-scoped queries');
    expect(await readFile(
      join(target, 'src/components/builder-boundary.tsx'),
      'utf8',
    )).toContain('applicationOperations === true');
    expect(
      await readFile(join(target, 'src/modules.ts'), 'utf8'),
    ).toContain('application.include(operationsControlCenter)');
    const billingFeature = await readFile(
      join(target, 'src/features/billing.tsx'),
      'utf8',
    );
    const billingView = await readFile(
      join(target, 'src/features/billing-view.tsx'),
      'utf8',
    );
    expect(billingFeature).not.toContain(
      'providerSubscriptionId: request.input.providerSubscriptionId',
    );
    expect(billingView).not.toContain(
      'providerSubscriptionId:',
    );
    expect(billingView).toContain('intentId: crypto.randomUUID()');
    expect(billingView).toContain('else await dashboard.refresh();');
    expect(billingView).toContain('dashboard.data?.canManageBilling');
    expect(
      await readFile(join(target, 'src/features/workspaces/model.ts'), 'utf8'),
    ).toContain("const workspaces = module(");
    const workspaceRoute = await readFile(
      join(target, 'src/routes/app.workspaces.$workspaceId.tsx'),
      'utf8',
    );
    expect(workspaceRoute).toContain('beforeLoad: ({ params })');
    expect(workspaceRoute).toContain('selectWorkspaceForRoute({');
    expect(workspaceRoute).toContain(
      "setCookie(workspaceCookieName, data.workspaceId",
    );
    expect(workspaceRoute).toContain("sameSite: 'lax'");
    expect(workspaceRoute).toContain("secure: getRequestProtocol() === 'https'");
    expect(
      await readFile(
        join(target, 'src/routes/invitations.$invitationId.tsx'),
        'utf8',
      ),
    ).toContain(
      'onClick={() => selectAgenticWorkspace(workspaceId)}',
    );
    const applicationTest = await readFile(
      join(target, 'test/application.test.ts'),
      'utf8',
    );
    expect(applicationTest).toContain('explicit authority graph');
    expect(applicationTest).toContain('canManageWorkspaceBilling({');
    expect(applicationTest).toContain('assembleApplicationKnowledgeContext([');
    const generatedBiome = await readFile(join(target, 'biome.json'), 'utf8');
    expect(generatedBiome).toContain('"root": true');
    expect(generatedBiome).toContain('"src/**/*.tsx"');
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
      const target = join(parent, 'documents-product');

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
      expect(result.value.metadata.name).toBe('documents-product');
      expect(result.value.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'model', id: 'model.document' }),
        expect.objectContaining({
          kind: 'aiAgent',
          name: 'workspace-assistant',
          queries: expect.arrayContaining([
            expect.objectContaining({ alias: 'KnowledgeSearch.search' }),
          ]),
        }),
        expect.objectContaining({ kind: 'authorityManifest' }),
      ]));
      // The product Start intentionally includes the maintained SaaS modules;
      // keep the complete inferred graph bounded as that baseline grows.
      // The product includes one complete durable-decision vertical: model,
      // workflow, signal, subscription, and terminal update. Keep a tight
      // ceiling so future examples cannot hide graph sprawl behind generation.
      // The maintained Document collaboration contract adds one model plus
      // its conventional lifecycle/command nodes; this remains bounded rather
      // than allowing template-owned feature sprawl.
      // The budget authority adds two durable models, one expiry workflow,
      // and settlement processors so concurrent AI runs cannot race a read-
      // then-charge check. Keep that safety cost explicit in this ceiling.
      // v0.8 adds one visible actor, fixed/dynamic schedules, historical
      // lakehouse publication/query, and target-selected observability. Keep
      // their complete generated surface bounded rather than hiding growth.
      expect(result.value.nodes.length).toBeLessThan(540);
      expect(result.value.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'model', id: 'model.document-comment' }),
        expect.objectContaining({ kind: 'model', id: 'model.billing-plan' }),
        expect.objectContaining({ kind: 'model', id: 'model.usage-fact' }),
        expect.objectContaining({ kind: 'model', id: 'model.aiusage-budget-ledger' }),
        expect.objectContaining({ kind: 'model', id: 'model.aiusage-reservation' }),
        expect.objectContaining({ kind: 'model', id: 'model.conversation' }),
        expect.objectContaining({ kind: 'model', id: 'model.document-revision' }),
        expect.objectContaining({ kind: 'model', id: 'model.agent-profile' }),
        expect.objectContaining({ kind: 'model', id: 'model.knowledge-source' }),
        expect.objectContaining({ kind: 'model', id: 'model.integration-connection' }),
        expect.objectContaining({ kind: 'model', id: 'model.approval-review' }),
        expect.objectContaining({ kind: 'model', id: 'model.data-lifecycle-request' }),
        expect.objectContaining({ kind: 'streamProcessor', name: 'process-data-lifecycle-request-create' }),
      ]));
      expect(
        result.value.nodes.flatMap((node) =>
          node.kind === 'query' && (node.handlerUnresolved?.length ?? 0) > 0
            ? [{ query: node.id, unresolved: node.handlerUnresolved }]
            : []),
      ).toEqual([]);
      const payments = result.value.nodes.find(
        (node) =>
          node.kind === 'provider'
          && node.interface === 'PaymentProvider',
      );
      const billingServer = result.value.nodes.find(
        (node) => node.kind === 'server' && node.name === 'billing',
      );
      const usageProcessor = result.value.nodes.find(
        (node) =>
          node.kind === 'streamProcessor'
          && node.name === 'deliver-billable-usage-create',
      );
      const notificationProvider = result.value.nodes.find(
        (node) =>
          node.kind === 'provider'
          && node.interface === 'NotificationDelivery',
      );
      const notificationProcessor = result.value.nodes.find(
        (node) =>
          node.kind === 'streamProcessor'
          && node.name === 'deliver-requested-notification-create',
      );
      const invitationProcessor = result.value.nodes.find(
        (node) =>
          node.kind === 'streamProcessor'
          && node.name === 'request-invitation-delivery-create',
      );
      expect(payments?.id).toBe(
        'provider.payment-provider.v1alpha1.primary',
      );
      const billingProviderConsumers = billingServer?.kind === 'server'
        ? billingServer.routes.map((route) => ({
            id: route.id,
            providerNodeIds:
              route.functionNative?.providerBindings?.map(
                (binding) => binding.provider.nodeId,
              ) ?? [],
          }))
        : [];
      expect(
        billingProviderConsumers.every((route) =>
          route.providerNodeIds.includes(payments?.id ?? ''),
        ),
        JSON.stringify(billingProviderConsumers),
      ).toBe(true);
      expect(usageProcessor?.kind === 'streamProcessor'
        ? usageProcessor.providerBindings
        : undefined).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: expect.objectContaining({ nodeId: payments?.id }),
          }),
        ]),
      );
      expect(notificationProcessor?.kind === 'streamProcessor'
        ? notificationProcessor.providerBindings
        : undefined, JSON.stringify(notificationProcessor)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            identifier: 'delivery.deliver',
            provider: expect.objectContaining({
              nodeId: notificationProvider?.id,
            }),
          }),
        ]),
      );
      expect(notificationProcessor?.kind === 'streamProcessor'
        ? notificationProcessor.handlerUnresolved
        : undefined, JSON.stringify(notificationProcessor)).toBeUndefined();
      expect(notificationProcessor?.kind === 'streamProcessor'
        ? notificationProcessor.operationBindings
        : undefined).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            identifier: 'requests.update',
            runtimeOperationId: 'NotificationRequest.update',
            operation: expect.objectContaining({
              model: 'NotificationRequest',
              operation: 'update',
            }),
          }),
        ]),
      );
      expect(invitationProcessor?.kind === 'streamProcessor'
        ? invitationProcessor.functionNativeTransaction?.modelBindings
        : undefined).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            identifier: 'NotificationRequest.find',
            model: { nodeId: 'model.notification-request' },
            access: 'read',
          }),
        ]),
      );
      expect(invitationProcessor?.kind === 'streamProcessor'
        ? invitationProcessor.operationBindings
        : undefined).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            identifier: 'NotificationRequest.create',
            operation: expect.objectContaining({
              model: 'NotificationRequest',
              operation: 'create',
            }),
          }),
        ]),
      );
      expect(result.value.edges).toEqual(expect.arrayContaining([
        {
          from: { nodeId: payments?.id },
          to: { nodeId: billingServer?.id },
          relationship: 'provides',
        },
        {
          from: { nodeId: payments?.id },
          to: { nodeId: usageProcessor?.id },
          relationship: 'provides',
        },
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
      const localPlan = compileLocalSupervisorPlan({
        graph: result.value,
        target: 'local',
        profile: 'starter',
        projectDigest: `sha256:${'9'.repeat(64)}`,
        applicationHostFrameworkCredentials: [],
        projectDirectory: target,
      });
      expect(
        localPlan.diagnostics.filter(({ severity }) => severity === 'error'),
      ).toEqual([]);
      expect(localPlan.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'process' }),
      ]));
      const localApplicationPlan = compileLocalApplicationPlan({
        graph: result.value,
        supervisor: localPlan,
        workspaceRoot: target,
      });
      const resolvedSelection = await applicationPlanSelectionResolver({
        currentPlan: () => localApplicationPlan,
      }).resolve({
        id: 'selection_research_inbox',
        capturedAtRevision: localApplicationPlan.sourceDigest,
        route: { pathname: '/', searchKeys: [] },
        element: { role: 'main', boundedText: 'Research inbox' },
        sourceHints: [{
          provenanceId: 'query.Conversation.listConversations',
          confidence: 'exact',
        }],
      }, {
        projectId: result.value.metadata.name,
        revision: localApplicationPlan.sourceDigest,
      });
      expect(resolvedSelection).toEqual(expect.arrayContaining([
        expect.objectContaining({ class: 'source', resolution: 'exact' }),
        expect.objectContaining({ class: 'graphNode', resolution: 'exact' }),
        expect.objectContaining({ class: 'operation', resolution: 'exact' }),
        expect.objectContaining({ class: 'applicationPlanNode', resolution: 'exact' }),
      ]));
      expect(JSON.stringify(resolvedSelection)).not.toContain(target);
      const awsPlan = compileApplicationAwsDeploymentPlan({
        graph: result.value,
        workspaceRoot: target,
        target: 'aws',
        environment: 'starter',
        profile: 'developer',
        region: 'us-east-1',
        accountId: '123456789012',
        installationSpec: {
          name: 'research-workspace',
          profile: 'developer',
          providers: {
            inference: {
              endpoint: 'https://openrouter.ai/api/v1',
              model: 'inclusionai/ling-3.0-tiny:free',
              credentialSecretName: 'research-workspace-providers',
            },
            payments: {
              secretName: 'research-workspace-providers',
            },
            notifications: {
              host: 'smtp.example.test',
              secretName: 'research-workspace-providers',
              senderEmail: 'hello@example.test',
            },
          },
        },
      });
      expect(
        awsPlan.diagnostics.filter(({ severity }) => severity === 'error'),
      ).toEqual([]);
      expect(awsPlan.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceType: 'fargate-service' }),
      ]));
      const dedicatedDeployment = compileApplicationDeploymentGraph({
        graph: result.value,
        workspaceRoot: target,
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
            notifications: {
              host: 'smtp.example.test',
              secretName: 'smtp-notifications',
              senderEmail: 'notifications@example.test',
              credentialSource: { kind: 'existingSecret' },
            },
            inference: {
              endpoint: 'https://inference.example.test',
              model: 'frontier',
              credentialSecretName: 'inference-credentials',
            },
          },
        },
        ...kubernetesRuntimeFixture(result.value, target),
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
        workspaceRoot: target,
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
        ...kubernetesRuntimeFixture(result.value, target),
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
        workspaceRoot: target,
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
            notifications: {
              host: 'smtp.example.test',
              secretName: 'smtp-notifications',
              senderEmail: 'notifications@example.test',
            },
          },
        },
        ...kubernetesRuntimeFixture(result.value, target),
      });
      expect(
        externalDeployment.graph.nodes.filter(
          (node) =>
            node.kind === 'kubernetesDirect'
            && node.source.semanticNodeId?.startsWith('provider.') === true,
        ).map((node) => ({
          compositionId: node.kind === 'kubernetesDirect'
            ? node.spec.compositionId
            : undefined,
          semanticNodeId: node.source.semanticNodeId,
        })),
      ).toEqual([
        {
          compositionId: 'clickhouse-operator-bootstrap',
          semanticNodeId: 'provider.observability.v1alpha1.primary',
        },
        {
          compositionId: 'applik8s-clickstack-clickhouse',
          semanticNodeId: 'provider.observability.v1alpha1.primary',
        },
        {
          compositionId: 'applik8s-clickstack',
          semanticNodeId: 'provider.observability.v1alpha1.primary',
        },
      ]);
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
      const notificationWorker = compiled.value.artifacts.reactiveArtifacts.find(
        (artifact) =>
          artifact.kind === 'streamProcessorWorker'
          && artifact.name.includes('deliver-requested-notification-create'),
      );
      expect(notificationWorker).toBeDefined();
      const notificationWorkerSource = await readFile(
        join(
          notificationWorker?.sourcePath
            ? dirname(notificationWorker.sourcePath)
            : '',
          'stream-processor.generated.ts',
        ),
        'utf8',
      );
      expect(notificationWorkerSource).toContain(
        'executeFunctionNativePostgresTransaction',
      );
      expect(notificationWorkerSource).toContain(
        'const functionNativeOperations = Object.freeze([Object.freeze({',
      );
      expect(notificationWorkerSource).toContain(
        '"requests": Object.freeze({ ...({ "update": createApplicationFunctionNativeOperationHandle',
      );
      expect(notificationWorkerSource).toMatch(
        /import \{ deliverApplicationNotification as providerOperation_[a-f0-9]{12} \} from "@applik8s\/notifications\/runtime";/u,
      );
      const operationsOffset = notificationWorkerSource.indexOf(
        'const functionNativeOperations',
      );
      const deliveryBindingOffset = notificationWorkerSource.indexOf(
        '"delivery"',
        operationsOffset,
      );
      expect(
        notificationWorkerSource.slice(
          deliveryBindingOffset,
          deliveryBindingOffset + 400,
        ),
      ).toMatch(
        /"delivery": Object\.freeze\(\{ \.\.\.\(\{ "deliver": instrumentApplicationProviderOperation\(\{"interface":"NotificationDelivery","nodeId":"provider\.notification-delivery\.v1alpha1\.transactional","member":"deliver"\}, providerOperation_[a-f0-9]{12}\) \}\) \}\)/u,
      );
      const nestedOperationSource = notificationWorkerSource.slice(
        notificationWorkerSource.indexOf('const functionNativeOperations'),
        notificationWorkerSource.indexOf('const functionNativeCommands'),
      );
      expect(nestedOperationSource.match(/operationId:/g)).toHaveLength(1);
      const invitationWorker = compiled.value.artifacts.reactiveArtifacts.find(
        (artifact) =>
          artifact.kind === 'streamProcessorWorker'
          && artifact.name.includes('request-invitation-delivery-create'),
      );
      expect(invitationWorker).toBeDefined();
      const invitationWorkerSource = await readFile(
        join(
          invitationWorker?.sourcePath
            ? dirname(invitationWorker.sourcePath)
            : '',
          'stream-processor.generated.ts',
        ),
        'utf8',
      );
      expect(invitationWorkerSource).toContain(
        "import { createApplicationNotificationRequestCallable } from '@applik8s/notifications';",
      );
      expect(invitationWorkerSource).toContain(
        'hydrateApplicationCallable(functionNativeBindingsMutable, ["Notifications","request"], createApplicationNotificationRequestCallable(functionNativeLeafBindings));',
      );
      expect(invitationWorkerSource).not.toContain(
        'import { Notifications } from',
      );
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

function kubernetesRuntimeFixture(graph: ApplicationGraph, workspaceRoot: string) {
  const executionNodeIds = [...new Set(
    deriveApplicationGraphFoundation(graph, { workspaceRoot }).runtimeAccess.map(({ consumer }) => consumer.nodeId),
  )].sort();
  const namespace = graph.metadata.namespace ?? graph.metadata.name;
  const logicalReference = 'artifact://agentic-start-application-host';
  const generatedSecretEnvironment = graph.nodes.flatMap((node, index) =>
    node.kind === 'gateway'
    && node.materialization === 'generatedDeployment'
    && node.cursorSecret
    && typeof node.cursorSecret.name === 'string'
      ? [{
          name: `APPLIK8S_TEST_CURSOR_${index}`,
          valueFrom: {
            secretKeyRef: {
              name: node.cursorSecret.name,
              key: node.cursorSecret.key,
            },
          },
        }]
      : []);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const needsContextSecret = graph.nodes.some((node) =>
    (node.kind === 'gateway' && node.materialization === 'generatedDeployment')
    || node.kind === 'server'
    || (node.kind === 'workflowWorker' && node.handlers.some(({ nodeId }) => {
      const handler = nodesById.get(nodeId);
      return handler?.kind === 'taskHandler' && (handler.operations?.length ?? 0) > 0;
    })));
  if (needsContextSecret) {
    generatedSecretEnvironment.push({
      name: 'APPLIK8S_TEST_CONTEXT',
      valueFrom: {
        secretKeyRef: {
          name: `${graph.metadata.name}-context`,
          key: 'key',
        },
      },
    });
  }
  return {
    artifacts: [{
      id: 'artifact.application-host',
      artifactType: 'containerImage' as const,
      name: 'agentic-start-application-host',
      sourceDigest: `sha256:${'e'.repeat(64)}`,
      sourceDescriptor: { logicalReference },
      executionNodeIds,
    }],
    materializedComposition: {
      resources: [{
        id: 'applicationHostDeployment',
        template: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'agentic-start', namespace },
          spec: {
            selector: { matchLabels: { 'app.kubernetes.io/name': 'agentic-start' } },
            template: {
              metadata: { labels: { 'app.kubernetes.io/name': 'agentic-start' } },
              spec: {
                serviceAccountName: 'agentic-start',
                containers: [{
                  name: 'application',
                  image: logicalReference,
                  env: generatedSecretEnvironment,
                }],
              },
            },
          },
        },
      }],
      status: {},
    },
  };
}

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
