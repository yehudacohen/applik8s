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
    roots: ['packages/applik8s/src/operator.ts', 'packages/applik8s/src/dns.ts'],
    forbidden: [/^node:/, /^@applik8s\/(?:applik8s|compiler|runtime|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'Operator closure entrypoints must stay WASM-safe and free of Node, compiler, and TypeKro dependencies.',
  },
  {
    roots: ['packages/client/src', 'packages/react/src', 'packages/tanstack-start/src/react.ts'],
    forbidden: [/^node:/, /^@kubernetes\/client-node$/, /^@applik8s\/(?:applik8s|compiler|runtime|sdk|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'Future v0.6 browser packages may depend only on browser-safe contracts and transport clients.',
  },
  {
    roots: ['packages/vite/src/index.ts'],
    forbidden: [/^@kubernetes\/client-node$/, /^@applik8s\/(?:applik8s|runtime|sdk|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'The generic Vite build adapter may consume compiler metadata but must not become a Kubernetes, runtime-host, or TypeKro client.',
  },
  {
    roots: ['packages/vite/src/server.ts', 'packages/vite/src/kubernetes-gateway.ts'],
    forbidden: [/^@applik8s\/(?:applik8s|runtime|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'Framework-neutral server adapters may use focused provider SDKs but must not pull in the authoring umbrella, runtime host, or TypeKro.',
  },
  {
    roots: ['packages/tanstack-start/src/index.ts', 'packages/tanstack-start/src/server.ts', 'packages/tanstack-start/src/vite.ts'],
    forbidden: [/^@kubernetes\/client-node$/, /^@applik8s\/(?:compiler|runtime|sdk|typekro-adapter)$/, /^typekro(?:\/|$)/],
    rationale: 'TanStack authoring, server, and build adapters may use their environment APIs but must not become direct Kubernetes, compiler, runtime-host, or TypeKro clients.',
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
