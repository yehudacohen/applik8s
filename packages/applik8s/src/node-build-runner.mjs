import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const request = JSON.parse(process.argv[2] ?? '{}');
const cwd = request.cwd ?? process.cwd();
const workspaceRoot = await findWorkspaceRoot(cwd);
process.chdir(cwd);

const tempDir = join(cwd, '.applik8s-tmp', `cli-build-${process.pid}`);
await mkdir(tempDir, { recursive: true });

try {
  const installedCompilerEntry = fileURLToPath(await import.meta.resolve('@applik8s/compiler'));
  const workspaceCompilerEntry = workspaceRoot
    ? join(workspaceRoot, 'packages/compiler/src/index.ts')
    : undefined;
  const compilerEntry = workspaceCompilerEntry && await fileExists(workspaceCompilerEntry)
    ? workspaceCompilerEntry
    : installedCompilerEntry;
  const runnerSource = join(tempDir, 'runner.ts');
  const runnerBundle = join(tempDir, 'runner.mjs');

  await writeFile(runnerSource, runnerProgram(importSpecifier(tempDir, compilerEntry), request), 'utf8');
  await build({
    entryPoints: [runnerSource],
    outfile: runnerBundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    external: ['@bytecodealliance/componentize-js', '@kubernetes/client-node', 'arktype', 'esbuild', 'typekro', 'typekro/*', 'typescript', 'yaml'],
    plugins: [workspaceSourcePlugin(workspaceRoot)],
  });

  const code = await run('node', [runnerBundle], { APPLIK8S_WORKSPACE_ROOT: workspaceRoot });
  process.exitCode = code;
} finally {
  if (process.env.APPLIK8S_KEEP_TMP !== '1') {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runnerProgram(compilerImport, request) {
  const options = request.options ?? {};
  const typeKro = Boolean(options.typekro);
  return `
import { readFile } from 'node:fs/promises';
import { compileTypeKroComposition, createCompilerPipeline } from ${JSON.stringify(compilerImport)};

const connectionBindings = ${options.connectionBindings ? `JSON.parse(await readFile(${JSON.stringify(resolve(request.cwd ?? '.', options.connectionBindings))}, 'utf8'))` : 'undefined'};

const request = {
  entrypoint: ${JSON.stringify(request.entrypoint)},
  ${options.outDir ? `outDir: ${JSON.stringify(options.outDir)},` : ''}
  ${options.operatorName ? `operatorName: ${JSON.stringify(options.operatorName)},` : ''}
  ${options.compositionName ? `compositionName: ${JSON.stringify(options.compositionName)},` : ''}
  runtimeVersionRange: '^0.1.0',
  handlerAbiVersion: 'applik8s.handler/v1alpha1',
  adapter: 'wasmComponent',
  ...(connectionBindings
    ? ${typeKro ? '{ operatorKubernetesConnectionBindings: connectionBindings }' : '{ kubernetesConnectionBindings: connectionBindings }'}
    : {}),
  portability: {
    deterministicBuild: true,
    allowEnvironmentAccess: false,
    allowFilesystemAccess: false,
    allowNetworkAccess: true,
    allowedHostImports: [],
    sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
  },
};

const result = ${typeKro ? 'await compileTypeKroComposition(request)' : 'await createCompilerPipeline().run(request)'};

if (!result.ok) {
  console.error(result.error.message);
  process.exit(1);
}

${typeKro ? `
console.log(\`Built TypeKro composition \${result.value.artifacts.manifest.metadata.name}\`);
console.log(\`Composition: \${result.value.artifacts.manifestJsonPath}\`);
console.log(\`Resources: \${result.value.artifacts.combinedYamlPath}\`);
console.log(\`Operators: \${result.value.artifacts.operatorArtifacts.length}\`);
` : `
console.log(\`Built \${result.value.manifest.metadata.name}\`);
console.log(\`Manifest: \${result.value.artifacts.manifestJsonPath}\`);
console.log(\`Kubernetes: \${result.value.artifacts.generatedDeploymentYamlPath ? result.value.artifacts.generatedDeploymentYamlPath.replace(/deployment-[^/]+\\.yaml$/, '') : '<not emitted>'}\`);
console.log(\`Apply: \${result.value.artifacts.generatedApplyScriptPath ?? '<not emitted>'}\`);
`}
`;
}

function importSpecifier(fromDir, targetPath) {
  const specifier = relative(fromDir, targetPath).replaceAll('\\', '/');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

function workspaceSourcePlugin(workspaceRoot) {
  const root = workspaceRoot ?? cwd;
  const packageAliases = new Map([
    ['@applik8s/applik8s', resolve(root, 'packages/applik8s/src/index.ts')],
    ['@applik8s/applik8s/typekro', resolve(root, 'packages/applik8s/src/typekro.ts')],
    ['@applik8s/applik8s/factories', resolve(root, 'packages/applik8s/src/factories.ts')],
    ['@applik8s/compiler', resolve(root, 'packages/compiler/src/index.ts')],
    ['@applik8s/compiler/kubernetes-schema', resolve(root, 'packages/compiler/src/kubernetes-schema/index.ts')],
    ['@applik8s/core', resolve(root, 'packages/core/src/index.ts')],
    ['@applik8s/runtime-contract', resolve(root, 'packages/runtime-contract/src/index.ts')],
    ['@applik8s/sdk', resolve(root, 'packages/sdk/src/index.ts')],
    ['@applik8s/testing', resolve(root, 'packages/testing/src/index.ts')],
    ['@applik8s/typekro-adapter', resolve(root, 'packages/typekro-adapter/src/index.ts')],
    ['@applik8s/typekro-adapter/targets', resolve(root, 'packages/typekro-adapter/src/operation-targets.ts')],
    ['@applik8s/typetainer', resolve(root, 'packages/typetainer/src/index.ts')],
  ]);

  return {
    name: 'applik8s-workspace-source',
    setup(build) {
      build.onResolve({ filter: /^@applik8s\// }, async (args) => {
        if (args.path.startsWith('@applik8s/applik8s/factories/')) {
          const alias = resolve(root, 'packages/applik8s/src/factories', `${args.path.slice('@applik8s/applik8s/factories/'.length)}.ts`);
          if (await fileExists(alias)) {
            return { path: alias };
          }
        }
        const alias = packageAliases.get(args.path);
        if (alias && await fileExists(alias)) {
          return { path: alias };
        }
        return undefined;
      });

      build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, async (args) => {
        if (!workspaceRoot || !args.importer.startsWith(resolve(root, 'packages'))) {
          return undefined;
        }
        const tsCandidate = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
        if (await fileExists(tsCandidate)) {
          return { path: tsCandidate };
        }
        return undefined;
      });
    },
  };
}

async function findWorkspaceRoot(start) {
  let current = resolve(start);
  for (;;) {
    if (await fileExists(join(current, 'packages/compiler/src/index.ts'))
      && await fileExists(join(current, 'packages/applik8s/src/index.ts'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete childEnv[name];
      else childEnv[name] = value;
    }
    const child = spawn(command, args, { stdio: 'inherit', env: childEnv });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
