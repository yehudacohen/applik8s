import {
  type ApplicationStartDefinition,
  applicationStartDefinitionApiVersion,
  validateApplicationStartDefinition,
} from '@applik8s/core';

export const applicationAgenticStartDefinition = Object.freeze({
  apiVersion: applicationStartDefinitionApiVersion,
  name: 'agentic',
  version: '0.7.0',
  compatibility: {
    // Exact upstream-compatible tuple. TanStack packages intentionally carry
    // independent release numbers; generators and examples must use this
    // whole set rather than independently ranged versions.
    applik8s: '0.7.0',
    tanstackCli: '0.70.1',
    tanstackStart: '1.168.28',
    tanstackRouter: '1.170.18',
    tanstackRouterCli: '1.167.19',
    tanstackAI: '0.42.0',
    tanstackAIClient: '0.22.1',
    tanstackAIReact: '0.18.1',
    agUi: '0.0.52',
    tanstackAIPersistence: 'unreleased',
    typekro: '0.33.6',
  },
  packages: [
    packageContribution(
      '@applik8s/conversations',
      'canonical conversations, messages, protocol runs, events, and memory',
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
    route('public-assistant', '/assistant', '@applik8s/start-agentic'),
    route('conversations', '/conversations', '@applik8s/conversations'),
    route('billing', '/billing', '@applik8s/billing'),
    route('reviews', '/reviews', '@applik8s/approvals'),
    route('operations', '/operations', '@applik8s/operations-ui'),
    route('administration', '/administration', '@applik8s/start-agentic'),
  ],
  diagnostics: [
    {
      id: 'agentic.starter.non-production',
      description:
        'Starter identity and inference are deterministic and cannot satisfy production qualification.',
      severity: 'warning',
    },
    {
      id: 'agentic.server-persistence.upstream',
      description:
        'TanStack server ChatPersistence remains gated until its published contract is pinned.',
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
    // Compatibility ceiling required by the v0.7 definition schema. Release
    // review uses the categorized source-ownership inventory below rather than
    // treating one aggregate count as a quality target.
    maximumApplicationFiles: 67,
    maximumIntegrationLines: 600,
    files: [
      '.applik8s/start-lineage.json',
      'package.json',
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
      'src/components/app-shell.tsx',
      'src/components/ui.tsx',
      'src/database-schema.ts',
      'src/features/account/session-loader.ts',
      'src/features/account/identity-flow.tsx',
      'src/features/billing-view.tsx',
      'src/features/billing.tsx',
      'src/features/conversations/model.ts',
      'src/features/conversations/view.tsx',
      'src/features/inbox/model.ts',
      'src/features/inbox/schema.ts',
      'src/features/inbox/view.tsx',
      'src/features/library/model.ts',
      'src/features/library/view.tsx',
      'src/features/lifecycle/model.ts',
      'src/features/lifecycle/schema.ts',
      'src/features/notes/model.ts',
      'src/features/notes/schema.ts',
      'src/features/onboarding/model.ts',
      'src/features/onboarding/schema.ts',
      'src/features/onboarding/view.tsx',
      'src/features/workspaces/model.ts',
      'src/features/workspaces/schema.ts',
      'src/features/workspaces/view.tsx',
      'src/installation.ts',
      'src/modules.ts',
      'src/providers.ts',
      'src/routes/__root.tsx',
      'src/routes/app.tsx',
      'src/routes/app.index.tsx',
      'src/routes/app.account.tsx',
      'src/routes/app.billing.tsx',
      'src/routes/app.artifacts.$artifactId.tsx',
      'src/routes/app.conversations.$conversationId.tsx',
      'src/routes/app.documents.$documentId.tsx',
      'src/routes/app.inbox.tsx',
      'src/routes/app.library.tsx',
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
