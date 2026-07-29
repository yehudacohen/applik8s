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
    roots: ['packages/deployment-contract/src'],
    forbidden: [/^node:/, /^@applik8s\//, /^@kubernetes\//, /^alchemy(?:\/|$)/, /^typekro(?:\/|$)/],
    rationale: 'Deployment contracts must remain portable data with no runtime, provider, Kubernetes, TypeKro, or Alchemy dependency.',
  },
  {
    roots: ['packages/deployment-compiler/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!core(?:\/|$)|deployment-contract(?:\/|$))/, /^@kubernetes\//, /^alchemy(?:\/|$)/, /^typekro(?:\/|$)/],
    rationale: 'Deployment lowering must remain a pure ApplicationGraph-to-deployment-contract transform.',
  },
  {
    roots: ['packages/deployment-typekro/src'],
    forbidden: [/^node:/, /^@applik8s\/(?!deployment-contract(?:\/|$))/, /^@kubernetes\//, /^alchemy(?:\/|$)/],
    rationale: 'The TypeKro adapter may consume only the portable deployment contract and released TypeKro APIs; Alchemy runtime ownership belongs in the deployment backend.',
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
    forbidden: [/^@applik8s\/(?!compiler(?:\/diagnostics)?$)/, /^typekro(?:\/|$)/, /^@kubernetes\//],
    rationale: 'The CLI may route through the explicit deployment and migration facades, but must not reach provider, TypeKro, or Kubernetes implementations directly.',
  },
  {
    roots: ['packages/runtime-s3/src'],
    forbidden: [/^@applik8s\/(?!applik8s$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The S3 runtime may implement the provider-neutral Applik8s object contract but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-hatchet/src'],
    forbidden: [/^@applik8s\/(?!applik8s$)/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The Hatchet runtime may implement the provider-neutral Applik8s workflow contract but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-nats/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The NATS runtime may implement provider-neutral Applik8s event-log contracts but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-kubernetes/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$)|core(?:\/|$))/, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The Kubernetes runtime may implement provider-neutral installation transports but must not depend on compiler, deployment, TypeKro, or Alchemy packages.',
  },
  {
    roots: ['packages/runtime-postgres/src'],
    forbidden: [/^@applik8s\/(?!applik8s(?:\/|$))/, /^@kubernetes\//, /^typekro(?:\/|$)/, /^alchemy(?:\/|$)/],
    rationale: 'The PostgreSQL runtime may implement the provider-neutral SQL contract but must not depend on compiler, deployment, Kubernetes, TypeKro, or Alchemy packages.',
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
    forbidden: [/^node:/, /^@kubernetes\/client-node$/, /^@applik8s\/(?!client(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'Browser packages may depend only on the browser-safe client contract and transport package.',
  },
  {
    roots: ['packages/vite/src/index.ts'],
    forbidden: [/^@kubernetes\/client-node$/, /^@applik8s\/(?!compiler(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'The generic Vite build adapter may consume compiler metadata only; runtime and framework integration belong elsewhere.',
  },
  {
    roots: ['packages/server/src'],
    forbidden: [/^@applik8s\/(?!client(?:\/|$)|core(?:\/|$)|sdk(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'Framework-neutral server authority may use only client, core, SDK, and Kubernetes APIs—not authoring, build, UI, or framework adapters.',
  },
  {
    roots: ['packages/tanstack-start/src'],
    forbidden: [/^@kubernetes\/client-node$/, /^@applik8s\/(?!client(?:\/|$)|server(?:\/|$)|vite(?:\/|$)|tanstack-start(?:\/|$))/, /^typekro(?:\/|$)/],
    rationale: 'TanStack Start is a thin framework adapter over client, server, and Vite; generic UI and application capabilities belong in their own packages.',
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
if (failures.length > 0) throw new Error(`Module boundary violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
console.log('Module boundaries: portable core, WASM operator surface, and v0.6 browser package rules passed.');

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
