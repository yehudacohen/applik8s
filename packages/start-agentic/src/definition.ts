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
    applik8s: '0.7.0',
    tanstackCli: '0.70.1',
    tanstackStart: '1.168.28',
    tanstackAI: '0.42.0',
    tanstackAIClient: '0.22.1',
    tanstackAIReact: '0.18.1',
    agUi: '0.0.52',
    tanstackAIPersistence: 'unreleased',
    typekro: '0.32.0',
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
      '@applik8s/evals',
      'versioned datasets, scorers, evaluation runs, and results',
    ),
    packageContribution(
      '@applik8s/usage',
      'provider-neutral usage, cost, quota, and entitlement facts',
    ),
    {
      package: '@applik8s/identity-ory',
      purpose: 'dedicated identity and OAuth provider adapter',
      dependencyZone: 'server-only',
      required: false,
    },
    {
      package: '@applik8s/runtime-opensearch',
      purpose: 'dedicated relationship-aware search projection runtime',
      dependencyZone: 'server-only',
      required: false,
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
    route('conversations', '/conversations', '@applik8s/conversations'),
    route('reviews', '/reviews', '@applik8s/approvals'),
    route('operations', '/operations', '@applik8s/start-agentic'),
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
    maximumApplicationFiles: 14,
    maximumIntegrationLines: 600,
    files: [
      'src/app.ts',
      'src/installation.ts',
      'src/providers.ts',
      'src/database-schema.ts',
      'src/modules.ts',
      'src/application.ts',
      'src/features/research/schema.ts',
      'src/features/research/model.ts',
      'src/features/research/view.tsx',
      'src/routes/index.tsx',
      'vite.config.ts',
      'drizzle.config.ts',
      'kubernetes/application.yaml',
      '.env.example',
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
