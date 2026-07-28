import { access, readFile } from 'node:fs/promises';
import { dirname, extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

export async function resolve(specifier, context, nextResolve) {
  const workspaceSource = await resolveWorkspacePackageSource(specifier);
  if (workspaceSource) {
    return {
      url: pathToFileURL(workspaceSource).href,
      shortCircuit: true,
    };
  }
  if (
    specifier.startsWith('.')
    && context.parentURL?.startsWith('file:')
  ) {
    const parentDirectory = dirname(fileURLToPath(context.parentURL));
    const base = resolvePath(parentDirectory, specifier);
    const extension = extname(specifier);
    const candidates = extension === ''
      ? [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
      : extension === '.js'
        ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]
        : [];
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return {
          url: pathToFileURL(candidate).href,
          shortCircuit: true,
        };
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const sourcefile = fileURLToPath(url);
    const source = await readFile(sourcefile, 'utf8');
    const transformed = await transform(source, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'node22',
      sourcefile,
      sourcemap: 'inline',
    });
    return {
      format: 'module',
      source: transformed.code,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}

async function resolveWorkspacePackageSource(specifier) {
  const root = process.env.APPLIK8S_WORKSPACE_ROOT;
  const match = /^(@applik8s\/[^/]+)(\/.*)?$/.exec(specifier);
  if (!root || !match) return undefined;
  const packageName = match[1];
  const packageDirectory = resolvePath(root, 'packages', packageName.slice('@applik8s/'.length));
  const manifestPath = resolvePath(packageDirectory, 'package.json');
  if (!await exists(manifestPath)) return undefined;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.name !== packageName) return undefined;
  const subpath = match[2] ? `.${match[2]}` : '.';
  const target = resolveExportTarget(manifest.exports, subpath);
  if (!target) return undefined;
  for (const candidate of workspaceSourceCandidates(packageDirectory, target)) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function resolveExportTarget(exports, subpath) {
  if (!exports || typeof exports !== 'object') return undefined;
  const exact = exports[subpath];
  const exactTarget = conditionalExportTarget(exact);
  if (exactTarget) return exactTarget;
  for (const [pattern, value] of Object.entries(exports)) {
    const star = pattern.indexOf('*');
    if (star < 0 || !subpath.startsWith(pattern.slice(0, star)) || !subpath.endsWith(pattern.slice(star + 1))) continue;
    const replacement = subpath.slice(pattern.slice(0, star).length, subpath.length - pattern.slice(star + 1).length);
    const target = conditionalExportTarget(value);
    if (target) return target.replace('*', replacement);
  }
  return undefined;
}

function conditionalExportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  return value.import ?? value.default;
}

function workspaceSourceCandidates(packageDirectory, target) {
  if (!target.startsWith('./dist/')) return [];
  const source = resolvePath(packageDirectory, target.replace('./dist/', './src/'));
  return [
    source.replace(/\.js$/, '.ts'),
    source.replace(/\.js$/, '.tsx'),
  ];
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
