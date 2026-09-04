import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

interface BoundaryRule { readonly roots: readonly string[]; readonly forbidden: readonly RegExp[]; readonly rationale: string }

const rules: readonly BoundaryRule[] = [
  {
    roots: ['packages/core/src'],
    forbidden: [/^node:/, /^@applik8s\/(?:applik8s|compiler|runtime|sdk|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'Core contracts must remain portable and independent from authoring, compiler, runtime, and infrastructure packages.',
  },
  {
    roots: ['packages/ai/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!core(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'Provider-neutral AI contracts and durable attempt semantics may depend only on portable core authority, never infrastructure or framework adapters.',
  },
  {
    roots: ['packages/ai-tanstack/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!ai(?:\/|$)|client(?:\/|$)|core(?:\/|$)|sdk\/schema-runtime$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The TanStack AI adapter may bridge portable AI, operation, authority, and focused schema-validation contracts to released upstream TanStack APIs, but may not own infrastructure or application runtime semantics.',
  },
  {
    roots: ['packages/identity/src'],
    forbidden: [/^@applik8s\/(?!core(?:\/|$)|runtime\/node-integrity$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'Provider-neutral identity and OAuth flow authority may depend on portable core principals and the focused Node integrity algebra, but never provider SDKs, Kubernetes, TypeKro, or deployment effects.',
  },
  {
    roots: ['packages/runtime-ai/src'],
    forbidden: [/^@applik8s\/(?!ai(?:\/|$)|ai-tanstack(?:\/|$)|client(?:\/|$)|core(?:\/|$)|operations(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The AI execution runtime may join AI, TanStack, operation, and authority contracts but must remain independent of infrastructure and deployment implementations.',
  },
  {
    roots: ['packages/ml/src'],
    forbidden: [
      /^@kubernetes\//,
      /^typekro(?:\/|$)/,
      /^alchemy(?:\/|$)/,
    ],
    rationale: 'The ML module may use application-authoring contracts and the focused provider-extension entrypoint, but never infrastructure implementation packages.',
  },
  {
    roots: ['packages/deployment-contract/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!core(?:\/|$))/, /^@kubernetes\//, /^alchemy(?:\/|$)/, /^typekro(?:\/|$)/],
    rationale: 'Deployment contracts may consume portable core identities, guarantees, and Canonical JSON, but no runtime, provider, Kubernetes, TypeKro, or Alchemy dependency.',
  },
  {
    roots: ['packages/deployment-compiler/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!core(?:\/|$)|deployment-contract(?:\/|$))/, /^@kubernetes\//, /^alchemy(?:\/|$)/, /^typekro(?:\/|$)/],
    rationale: 'Deployment lowering must remain a pure ApplicationGraph-to-deployment-contract transform.',
  },
  {
    roots: ['packages/deployment-typekro/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!deployment-contract(?:\/|$)|deployment-compiler\/runtime-access-parity$|celld-operator\/typekro$)/, /^@kubernetes\//, /^alchemy(?:\/|$)/],
    rationale: 'The TypeKro adapter may consume the portable deployment contract, the focused pure parity validator, provider-owned TypeKro compositions, and released TypeKro APIs; Alchemy runtime ownership belongs in the deployment backend.',
  },
  {
    roots: ['packages/deployment-alchemy/src'],
    forbidden: [/^@applik8s\/(?!deployment-contract(?:\/|$)|deployment-provider-harbor(?:\/|$)|deployment-provider-kubernetes(?:\/|$)|deployment-provider-oci(?:\/|$)|deployment-typekro(?:\/|$))/, /^@kubernetes\//],
    rationale: 'The Alchemy backend may compose focused provider layers but may not own provider SDK clients directly.',
  },
  {
    roots: ['packages/deployment-provider-harbor/src'],
    forbidden: [/^@applik8s\//, /^@kubernetes\//],
    rationale: 'The Harbor Alchemy provider is an isolated external-effect adapter that may reuse released TypeKro Harbor/container clients but must not depend on Applik8s semantics or own a Kubernetes client.',
  },
  {
    roots: ['packages/deployment-provider-kubernetes/src'],
    forbidden: [/^@applik8s\//, /^typekro(?:\/|$)/],
    rationale: 'The Kubernetes Alchemy provider is an isolated effect adapter and must not depend on application semantics or TypeKro composition internals.',
  },
  {
    roots: ['packages/deployment-provider-oci/src'],
    forbidden: [/^@applik8s\//, /^@kubernetes\//],
    rationale: 'The OCI Alchemy provider may reuse released TypeKro container machinery but must not depend on Applik8s semantics or Kubernetes clients.',
  },
  {
    roots: ['packages/cli/src/cli.ts', 'packages/cli/src/application-deployment-command.ts'],
    forbidden: [/^@applik8s\/(?!compiler(?:\/diagnostics)?$|core(?:\/|$)|deployment-contract(?:\/|$))/, /^typekro(?:\/|$)/, /^@kubernetes\//],
    rationale: 'The CLI may consume portable compiler diagnostics, core authority, and deployment contracts, but must not reach provider, TypeKro, or Kubernetes implementations directly.',
  },
  {
    roots: ['packages/runtime-s3/src'],
    forbidden: [/^@applik8s\/(?!applik8s$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The S3 runtime may implement the provider-neutral Applik8s object contract but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-hatchet/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$)|runtime-postgres\/schedule-(?:state|occurrence)$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The Hatchet runtime may implement Applik8s/core contracts and compose the focused PostgreSQL schedule authority, but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-nats/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The NATS runtime may implement provider-neutral Applik8s and core authority contracts but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-kubernetes/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$)|runtime-postgres\/(?:job-store|schedule-(?:state|occurrence))$)/, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The Kubernetes runtime may implement provider-neutral installation transports and compose focused PostgreSQL Job and schedule authorities, but must not depend on compiler, deployment, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-postgres/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The PostgreSQL runtime may implement provider-neutral Applik8s and core SQL contracts but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-aws/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$)|sdk(?:\/|$)|runtime-postgres\/schedule-state$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The AWS runtime may implement Applik8s/core contracts, validate focused SDK schemas, and compose the focused PostgreSQL schedule authority, but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-celld/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$)|deployment-contract(?:\/|$)|runtime\/signed-envelope$|sdk(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The celld runtime may implement actor/core contracts and use the focused signed-envelope, stable hashing, and schema-validation contracts, but must not depend on compiler, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-otel/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The OpenTelemetry runtime may implement the portable core telemetry contract but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-duckdb/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$)|sdk(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The DuckDB runtime may implement the provider-neutral lakehouse contract and validate focused SDK schemas, but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-opensearch/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The OpenSearch runtime may implement provider-neutral search contracts but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/applik8s/src/operator.ts', 'packages/applik8s/src/dns.ts'],
    forbidden: [/^node:/, /^@applik8s\/(?:applik8s|compiler|runtime|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'Operator closure entrypoints must stay WASM-safe and free of Node, compiler, and TypeKro dependencies.',
  },
  {
    roots: ['packages/client/src', 'packages/react/src'],
    forbidden: [/^node:/, /^@kubernetes\/client-node$/, /^@applik8s\/(?!client(?:\/|$)|core(?:\/|$)|identity\/client$)/, /^typekro(?:\/|$)/],
    rationale: 'Browser packages may depend only on browser-safe client, focused identity-client, and portable core authority contracts.',
  },
  {
    roots: ['packages/vite/src/index.ts'],
    forbidden: [/^@kubernetes\/client-node$/, /^@applik8s\/(?!compiler(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'The generic Vite build adapter may consume compiler metadata only; runtime and framework integration belong elsewhere.',
  },
  {
    roots: ['packages/server/src'],
    forbidden: [/^@applik8s\/(?!client(?:\/|$)|core(?:\/|$)|runtime\/(?:node-integrity|signed-envelope)$|sdk(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'Framework-neutral server authority may use client, core, focused integrity/envelope, SDK, and Kubernetes APIs—not authoring, build, UI, or framework adapters.',
  },
  {
    roots: ['packages/tanstack-start/src'],
    forbidden: [/^@kubernetes\/client-node$/, /^@applik8s\/(?!client(?:\/|$)|identity\/client$|react(?:\/|$)|server(?:\/|$)|vite(?:\/|$)|tanstack-start(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'TanStack Start is a thin framework adapter over client, focused identity-client, router-neutral React, server, and Vite; generic UI and application capabilities remain owned by their focused packages.',
  },
];

const failures: string[] = [];
for (const rule of rules) {
  for (const root of rule.roots) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (rule.forbidden.some((pattern) => pattern.test(specifier))) failures.push(`${relative(process.cwd(), file)} imports ${specifier}. ${rule.rationale}`);
      }
    }
  }
}
const applicationUmbrella = await readFile('packages/applik8s/src/index.ts', 'utf8');
// typecast: This checked literal list is the complete internal extension surface intentionally excluded from the application umbrella.
for (const internalExtensionSymbol of [
  'bindApplicationProviderDependencies',
  'bindApplicationProviderOperation',
] as const) {
  if (applicationUmbrella.includes(internalExtensionSymbol)) {
    failures.push(`packages/applik8s/src/index.ts exports ${internalExtensionSymbol}. Maintained modules must use @applik8s/applik8s/provider-extension-runtime; application authors must not see extension plumbing at the umbrella root.`);
  }
}
const mlModule = await readFile('packages/ml/src/index.ts', 'utf8');
if (!mlModule.includes("from '@applik8s/applik8s/provider-extension-runtime'")) {
  failures.push('packages/ml/src/index.ts must import provider metadata seams from @applik8s/applik8s/provider-extension-runtime.');
}
if (failures.length > 0) throw new Error(`Module boundary violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
console.log('Module boundaries: portable core, provider-extension, WASM operator, deployment, and browser package rules passed.');

async function sourceFiles(path: string): Promise<string[]> {
  try {
    const metadata = await stat(path);
    if (metadata.isFile()) return path.endsWith('.ts') ? [path] : [];
    const entries = await readdir(path);
    return (await Promise.all(entries.map((entry) => sourceFiles(join(path, entry))))).flat();
  } catch (error) {
    // typecast: Node filesystem rejections expose the optional errno code used to distinguish a future package that is not created yet.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function importSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map((match) => match[2] ?? '').filter(Boolean);
}
