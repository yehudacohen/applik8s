import {
  type ApplicationStartDefinition,
  applicationStartDefinitionApiVersion,
  validateApplicationStartDefinition,
} from '@applik8s/core';

export const applicationAgenticStartDefinition = Object.freeze({
  apiVersion: applicationStartDefinitionApiVersion,
  name: 'agentic',
  version: '0.9.0',
  compatibility: {
    // Exact upstream-compatible tuple. TanStack packages intentionally carry
    // independent release numbers; generators and examples must use this
    // whole set rather than independently ranged versions.
    applik8s: '0.9.0',
    tanstackCli: '0.70.1',
    tanstackStart: '1.168.28',
    tanstackRouter: '1.170.18',
    tanstackRouterCli: '1.167.19',
    tanstackAI: '0.45.1',
    tanstackAIClient: '0.23.3',
    tanstackAIReact: '0.19.3',
    tanstackAIPersistence: '0.1.5',
    agUi: '0.1.1-canary.beta.0',
    typekro: '0.33.8',
  },
  packages: [
    packageContribution(
      '@applik8s/conversations',
      'canonical conversations, messages, protocol runs, events, and memory',
    ),
    packageContribution(
      '@applik8s/documents',
      'editable documents, immutable revisions, lifecycle state, and causal provenance',
    ),
    packageContribution(
      '@applik8s/agents',
      'application-owned agent profiles, versioning, publication state, and execution budgets',
    ),
    packageContribution(
      '@applik8s/knowledge',
      'verified knowledge sources, object provenance, ingestion state, and indexing lifecycle',
    ),
    packageContribution(
      '@applik8s/integrations',
      'provider-neutral connection intent, requested scopes, and safe lifecycle state',
    ),
    packageContribution(
      '@applik8s/approvals',
      'review queues and independent outcome observation',
    ),
    packageContribution(
      '@applik8s/artifacts',
      'typed object references and causal artifact provenance',
    ),
    packageContribution(
      '@applik8s/billing',
      'provider-neutral plans, subscriptions, checkout, portal, and entitlement projection',
    ),
    packageContribution(
      '@applik8s/data-lifecycle',
      'provider-neutral lifecycle request state, progress, and bounded coordination',
    ),
    {
      package: '@applik8s/billing-stripe',
      purpose: 'server-only Stripe checkout and authenticated webhook adapter',
      dependencyZone: 'server-only',
      required: true,
    },
    packageContribution(
      '@applik8s/notifications',
      'provider-neutral transactional application notification delivery and deterministic Starter sink',
    ),
    {
      package: '@applik8s/notifications-smtp',
      purpose: 'server-only production SMTP notification adapter',
      dependencyZone: 'server-only',
      required: true,
    },
    packageContribution(
      '@applik8s/web-search',
      'bounded provider-neutral web retrieval with deterministic Starter execution',
    ),
    packageContribution(
      '@applik8s/research',
      'maintained evidence-grounded research agents and durable citation authority',
    ),
    {
      package: '@applik8s/web-search-searxng',
      purpose: 'server-only external and TypeKro-managed SearXNG adapter',
      dependencyZone: 'server-only',
      required: true,
    },
    {
      package: '@applik8s/web-retrieval-http',
      purpose: 'server-only bounded public-source retrieval with SSRF and response limits',
      dependencyZone: 'server-only',
      required: true,
    },
    packageContribution(
      '@applik8s/evals',
      'versioned datasets, scorers, evaluation runs, and results',
    ),
    packageContribution(
      '@applik8s/usage',
      'provider-neutral usage, cost, quota, and entitlement facts',
    ),
    packageContribution(
      '@applik8s/operations',
      'canonical operation catalog, typed grants, revocation, expiry, and application-operator bootstrap',
    ),
    packageContribution(
      '@applik8s/operations-ui',
      'authority-preserving operational snapshot and router-neutral control center',
    ),
    {
      package: '@applik8s/identity-ory',
      purpose: 'dedicated identity and OAuth provider adapter',
      dependencyZone: 'server-only',
      required: true,
    },
    {
      package: '@applik8s/runtime-opensearch',
      purpose: 'dedicated relationship-aware search projection runtime',
      dependencyZone: 'server-only',
      required: false,
    },
    {
      package: '@applik8s/runtime-s3',
      purpose: 'generated provider-neutral object-storage gateway runtime',
      dependencyZone: 'server-only',
      required: true,
    },
  ],
  profiles: [
    {
      name: 'starter',
      production: false,
      credentialFree: true,
      description:
        'Credential-free deterministic identity and inference with real PostgreSQL, JetStream, object, workflow, and authority contracts.',
    },
    {
      name: 'dedicated',
      production: true,
      credentialFree: false,
      description:
        'CNPG, ClickHouse, JetStream, Hatchet, Rook/Ceph, OpenSearch, Envoy AI Gateway, and Ory.',
    },
    {
      name: 'external',
      production: true,
      credentialFree: false,
      description:
        'Explicit externally owned endpoints, capabilities, readiness, credentials, and lifecycle responsibility.',
    },
  ],
  routes: [
    route('workspace-home', '/app', '@applik8s/start-agentic'),
    route('documents', '/app/documents', '@applik8s/documents'),
    route('conversations', '/app/conversations/$conversationId', '@applik8s/conversations'),
    route('reviews', '/app/inbox', '@applik8s/approvals'),
    route('agents', '/app/agents', '@applik8s/agents'),
    route('knowledge', '/app/knowledge', '@applik8s/knowledge'),
    route('evaluations', '/app/evaluations', '@applik8s/evals'),
    route('connections', '/app/integrations', '@applik8s/integrations'),
    route('workspaces', '/app/workspaces', '@applik8s/start-agentic'),
    route('billing', '/app/billing', '@applik8s/billing'),
    route('operations', '/app/operations', '@applik8s/operations-ui'),
    route('administration', '/admin', '@applik8s/start-agentic'),
  ],
  diagnostics: [
    {
      id: 'agentic.starter.non-production',
      description:
        'Starter identity and inference are deterministic and cannot satisfy production qualification.',
      severity: 'warning',
    },
  ],
  generator: {
    upstream: {
      package: '@tanstack/cli',
      version: '0.70.1',
      mode: 'start-file-router',
      blank: true,
    },
    // Compatibility ceiling retained by the Start definition schema. Release
    // review uses the categorized source-ownership inventory below rather than
    // treating one aggregate count as a quality target.
    maximumApplicationFiles: 124,
    maximumIntegrationLines: 600,
    files: [
      '.applik8s-start.json',
      'package.json',
      'biome.json',
      'components.json',
      '.env.example',
      'README.md',
      'drizzle/zzzz_agentic_product_catalog.sql',
      'drizzle.config.ts',
      'kubernetes/application.dedicated.example.yaml',
      'kubernetes/application.developer.yaml',
      'kubernetes/application.external.example.yaml',
      'kubernetes/application.yaml',
      'src/app.ts',
      'src/application.ts',
      'src/brand.ts',
      'src/product-home.ts',
      'src/product-navigation.tsx',
      'src/operational-objectives.ts',
      'src/components/markdown-document.tsx',
      'src/components/app-shell.tsx',
      'src/components/builder-boundary.tsx',
      'src/components/mobile-navigation.tsx',
      'src/components/ui.tsx',
      'src/components/ui/badge.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/card.tsx',
      'src/components/ui/checkbox.tsx',
      'src/components/ui/input.tsx',
      'src/components/ui/label.tsx',
      'src/components/ui/progress.tsx',
      'src/components/ui/radio-group.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/separator.tsx',
      'src/components/ui/sheet.tsx',
      'src/components/ui/skeleton.tsx',
      'src/components/ui/textarea.tsx',
      'src/lib/utils.ts',
      'src/database-schema.ts',
      'src/features/account/session-loader.ts',
      'src/features/administration/model.ts',
      'src/features/administration/view.tsx',
      'src/features/account/identity-flow.tsx',
      'src/features/billing-view.tsx',
      'src/features/billing-policy.ts',
      'src/features/billing.tsx',
      'src/features/conversations/model.ts',
      'src/features/conversations/view.tsx',
      'src/features/inbox/model.ts',
      'src/features/inbox/schema.ts',
      'src/features/inbox/view.tsx',
      'src/features/library/model.ts',
      'src/features/library/view.tsx',
      'src/features/lifecycle/model.ts',
      'src/features/documents/model.ts',
      'src/features/documents/assistant-query.ts',
      'src/features/documents/schema.ts',
      'src/features/documents/view.tsx',
      'src/features/agents/model.ts',
      'src/features/agents/schema.ts',
      'src/features/agents/view.tsx',
      'src/features/evaluations/model.ts',
      'src/features/evaluations/view.tsx',
      'src/features/runtime/events.ts',
      'src/features/runtime/model.ts',
      'src/features/specialists/model.ts',
      'src/features/integrations/model.ts',
      'src/features/integrations/schema.ts',
      'src/features/integrations/view.tsx',
      'src/features/knowledge/model.ts',
      'src/features/knowledge/schema.ts',
      'src/features/knowledge/view.tsx',
      'src/features/onboarding/model.ts',
      'src/features/onboarding/schema.ts',
      'src/features/onboarding/view.tsx',
      'src/features/budgets/model.ts',
      'src/features/budgets/models.ts',
      'src/features/workspaces/model.ts',
      'src/features/workspaces/queries.ts',
      'src/features/workspaces/schema.ts',
      'src/features/workspaces/view.tsx',
      'src/installation.ts',
      'src/inference-roles.ts',
      'src/journeys.ts',
      'src/modules.ts',
      'src/providers.ts',
      'src/workspace-scope.ts',
      'src/routes/__root.tsx',
      'src/routes/admin.catalog.tsx',
      'src/routes/admin.index.tsx',
      'src/routes/admin.tenants.$tenantId.tsx',
      'src/routes/admin.tenants.index.tsx',
      'src/routes/admin.tenants.tsx',
      'src/routes/admin.tsx',
      'src/routes/app.tsx',
      'src/routes/app.index.tsx',
      'src/routes/app.account.tsx',
      'src/routes/app.billing.tsx',
      'src/routes/app.artifacts.$artifactId.tsx',
      'src/routes/app.conversations.$conversationId.tsx',
      'src/routes/app.documents.$documentId.tsx',
      'src/routes/app.documents.index.tsx',
      'src/routes/app.agents.tsx',
      'src/routes/app.evaluations.tsx',
      'src/routes/app.integrations.tsx',
      'src/routes/app.knowledge.tsx',
      'src/routes/app.inbox.tsx',
      'src/routes/app.artifacts.index.tsx',
      'src/routes/app.operations.tsx',
      'src/routes/app.setup.tsx',
      'src/routes/app.usage.tsx',
      'src/routes/app.workspaces.$workspaceId.tsx',
      'src/routes/app.workspaces.index.tsx',
      'src/routes/app.workspaces.tsx',
      'src/routes/invitations.$invitationId.tsx',
      'src/routes/index.tsx',
      'src/routes/-route-state.tsx',
      'src/routes/sign-in.tsx',
      'src/routes/sign-up.tsx',
      'src/routes/recover.tsx',
      'src/routes/verify.tsx',
      'src/styles.css',
      'test/application.test.ts',
      'vite.config.ts',
      'vitest.config.ts',
    ],
  },
} satisfies ApplicationStartDefinition);

const definitionFindings = validateApplicationStartDefinition(
  applicationAgenticStartDefinition,
);
if (definitionFindings.length > 0) {
  throw new Error(
    `The maintained Agentic Start definition is invalid: ${definitionFindings
      .map((finding) => finding.message)
      .join(' ')}`,
  );
}

function packageContribution(
  name: string,
  purpose: string,
): ApplicationStartDefinition['packages'][number] {
  return {
    package: name,
    purpose,
    dependencyZone: 'authoring',
    required: true,
  };
}

function route(
  id: string,
  path: string,
  module: string,
): ApplicationStartDefinition['routes'][number] {
  return {
    id,
    path,
    module,
    authority: 'application-operation',
  };
}
