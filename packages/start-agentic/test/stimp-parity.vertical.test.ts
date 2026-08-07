import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgenticStartOnboarding } from '@applik8s/start-agentic/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgenticExternal,
  AgenticStarter,
  createApplicationAgenticStart,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('pinned Stimp product-contract parity', () => {
  it('generates the same feature-first product twice without retaining Stimp runtime authority', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'applik8s-stimp-parity-'));
    temporaryDirectories.push(parent);
    const first = join(parent, 'first');
    const second = join(parent, 'second');

    const firstResult = await generate(first);
    const secondResult = await generate(second);
    expect(firstResult.files).toEqual(secondResult.files);
    expect(await generatedDigest(first, firstResult.files)).toBe(
      await generatedDigest(second, secondResult.files),
    );

    const manifest = JSON.parse(
      await readFile(join(first, 'package.json'), 'utf8'),
    );
    expect(manifest.scripts).toMatchObject({
      plan: 'bun run build && applik8s plan',
      deploy: 'bun run build && applik8s deploy',
      'dev:cluster': 'bun run build && applik8s deploy --development --instance kubernetes/application.developer.yaml',
      status: 'applik8s status',
      destroy: 'applik8s destroy',
    });
    expect(Object.keys(manifest.dependencies)).not.toContain('stimp');
    const productCatalog = await readFile(
      join(first, 'drizzle/zzzz_agentic_product_catalog.sql'),
      'utf8',
    );
    expect(productCatalog).toContain("'research-free'");
    expect(productCatalog).toContain("'research-team'");
    expect(productCatalog).toContain('ON CONFLICT (id) DO NOTHING');

    const allSource = (
      await Promise.all(
        firstResult.files
          .filter((path) => /\.(?:ts|tsx)$/.test(path))
          .map((path) => readFile(join(first, path), 'utf8')),
      )
    ).join('\n');
    expect(allSource).not.toMatch(/from ['"][^'"]*stimp/i);
    expect(allSource).toContain('application.include(agenticProfiles)');
    expect(allSource).toContain('application.include(conversations)');
    expect(allSource).toContain('application.include(approvals)');
    expect(allSource).toContain('application.include(artifacts)');
    expect(allSource).toContain('application.include(billing)');
    expect(allSource).toContain('application.include(evaluations)');
    expect(allSource).toContain('application.include(usage)');
    expect(allSource).toContain('application.include(operationsControlCenter)');
    expect(allSource).not.toContain('maintainedCommands');
    expect(allSource).not.toContain("application.gateway('web'");
    expect(allSource).not.toContain('ApplicationHost.kubernetes');
    expect(allSource).toContain("createFileRoute('/operations')");
    expect(allSource).toContain("createFileRoute('/workspaces')");
    expect(allSource).toContain("createFileRoute('/assistant')");
    expect(allSource).toContain("createFileRoute('/billing')");
    expect(allSource).toContain(
      "createFileRoute('/workspaces/$workspaceId/reviews')",
    );
    expect(allSource).toContain("model('research_notes', {");
    expect(allSource).toContain("model('research_reviews', {");
    expect(allSource).toContain("model('workspaces', {");
    expect(allSource).toContain('Workspace.create.useMutation()');
    expect(allSource).not.toContain('useOperation');
    expect(allSource).toContain('await createWorkspace({ name, slug })');
    expect(allSource).toContain(
      'const workspaceId = String(created.value.id)',
    );
    expect(allSource).toContain(
      "const Authenticated = application.role('authenticated')",
    );
    expect(allSource).toContain(
      'Conversations.Conversation.update.beforeCommit(',
    );
    expect(allSource).toContain('PublicAssistant.public()');
    expect(allSource).toContain(
      "source: 'public-onboarding'",
    );
    expect(allSource).toContain(
      'export const BillingDashboard = Billing.BillingPlan.view(',
    );
    expect(allSource).toContain('export const StartCheckout = billingApi.post(');
    expect(allSource).toContain('export const OpenBillingPortal = billingApi.post(');
    expect(allSource).toContain(
      'principalScope: applicationAIConversationPrincipalScope(',
    );
    expect(allSource).toContain(
      "ResearchReviewDecision = workflow.signal(\n  'research.review-decision.v1'",
    );
    expect(allSource).toContain(
      'const decision = await workflow.emitSignal(ResearchReviewDecision, {',
    );
    expect(allSource).toContain('const stored = await ArtifactObjects.put({');
    expect(allSource).toContain('await Artifacts.Artifact.create({');
    expect(allSource).toContain('await Conversations.Memory.create({');
    expect(allSource).toContain('await Usage.UsageFact.create({');
    expect(allSource).toContain(
      'ResearchReview.create.beforeCommit(',
    );
    expect(allSource).toContain(
      "capability: 'research-review'",
    );
    expect(allSource).toContain(
      'await requireActiveEntitlement(context, {',
    );
    expect(allSource).toContain(
      'transaction: { models: [Usage.Entitlement] }',
    );
    expect(allSource).toContain(
      'await Evaluations.EvaluationRun.create({',
    );
    expect(allSource).toContain(
      'await Evaluations.EvaluationResult.create({',
    );
    expect(allSource).toContain(
      'export const ResearchReviewCoordinator = ResearchReview.on.create(',
    );
    expect(allSource).not.toContain('principalScope: request.input');
    expect(allSource).toContain('patch: { title: next }');
    expect(allSource).toContain(
      'patch: { archivedAt: new Date().toISOString() }',
    );
    expect(allSource).toContain("to=\"/workspaces/$workspaceId\"");
    expect(allSource).toContain(
      'eq(MembershipTable.identityId, context.principal.id)',
    );
    expect(allSource).toContain("client.beginFlow(mode, { email })");
    expect(allSource).toContain(
      "client.transitionFlow(flow.id, transition, { email, password })",
    );
    expect(allSource).toContain('session.logout()');
    expect(allSource).not.toContain('createWorkspace.mutate');
    expect(allSource).not.toContain('pgTable(');
    expect(allSource).not.toContain('application.model(');
  });

  it('preserves credential-free onboarding while keeping external providers externally owned', () => {
    const context = {
      application: 'research',
      namespace: 'research-system',
    };
    const html = renderToStaticMarkup(
      AgenticStartOnboarding({
        application: context.application,
        operationsHref: '/operations',
      }),
    );

    expect(html).toContain('default: starter · non-production');
    expect(html).toContain('Open operations');
    expect(html).toContain('bun run plan');
    expect(html).not.toContain('password');
    expect(html).not.toContain('token');
    expect(AgenticStarter.inference()).toMatchObject({
      kind: 'ai-deterministic',
      fixture: {
        response: 'Credential-free starter inference.',
        tool: {
          index: 0,
          input: { body: 'Starter tool-created note.' },
        },
      },
    });
    expect(
      AgenticExternal.events(
        { server: 'nats://events.example.test:4222' },
        context,
      ),
    ).toMatchObject({
      provision: false,
      servers: ['nats://events.example.test:4222'],
    });
    expect(
      AgenticExternal.objects(
        {
          endpoint: 'https://objects.example.test',
          bucket: 'research',
          region: 'us-east-1',
          credentialsSecretName: 'objects',
        },
        context,
      ),
    ).toMatchObject({
      ownership: 'external',
    });
  });
});

async function generate(targetDirectory: string) {
  return createApplicationAgenticStart({
    targetDirectory,
    projectName: 'research-workspace',
    applik8sVersion: 'workspace:*',
    example: 'research',
    install: false,
    async run() {
      await mkdir(join(targetDirectory, 'src/routes'), { recursive: true });
      await writeFile(
        join(targetDirectory, 'package.json'),
        `${JSON.stringify({
          scripts: { dev: 'vite dev' },
          dependencies: {
            '@tanstack/react-start': '1.168.28',
            '@tanstack/react-router': '1.168.28',
            react: '^19.1.0',
          },
        })}\n`,
      );
      await writeFile(
        join(targetDirectory, 'src/routes/index.tsx'),
        'export const upstream = true;\n',
      );
      await writeFile(
        join(targetDirectory, 'src/routes/__root.tsx'),
        'export const upstreamRoot = true;\n',
      );
      await writeFile(
        join(targetDirectory, 'src/router.tsx'),
        'export const upstreamRouter = true;\n',
      );
    },
  });
}

async function generatedDigest(
  directory: string,
  files: readonly string[],
): Promise<string> {
  const digest = createHash('sha256');
  for (const path of [...files].sort()) {
    digest.update(path);
    digest.update('\0');
    digest.update(await readFile(join(directory, path)));
    digest.update('\0');
  }
  return digest.digest('hex');
}
