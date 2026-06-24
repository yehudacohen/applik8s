import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const request = JSON.parse(process.argv[2] ?? '{}');
const cwd = request.cwd ?? process.cwd();
process.chdir(cwd);

const tempDir = join(cwd, '.applik8s-tmp', `cli-build-${process.pid}`);
await mkdir(tempDir, { recursive: true });

try {
  const compilerEntry = fileURLToPath(await import.meta.resolve('@applik8s/compiler'));
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
    external: ['@bytecodealliance/componentize-js', '@kubernetes/client-node', 'arktype', 'esbuild', 'typekro', 'typescript', 'yaml'],
    plugins: [workspaceSourcePlugin(cwd)],
  });

  const code = await run('node', [runnerBundle], { APPLIK8S_WORKSPACE_ROOT: cwd });
  process.exitCode = code;
} finally {
  if (process.env.APPLIK8S_KEEP_TMP !== '1') {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runnerProgram(compilerImport, request) {
  const options = request.options ?? {};
  return `
import { createCompilerPipeline } from ${JSON.stringify(compilerImport)};

const result = await createCompilerPipeline().run({
  entrypoint: ${JSON.stringify(request.entrypoint)},
  ${options.outDir ? `outDir: ${JSON.stringify(options.outDir)},` : ''}
  ${options.operatorName ? `operatorName: ${JSON.stringify(options.operatorName)},` : ''}
  runtimeVersionRange: '^0.1.0',
  handlerAbiVersion: 'applik8s.handler/v1alpha1',
  adapter: 'wasmComponent',
  portability: {
    deterministicBuild: true,
    allowEnvironmentAccess: false,
    allowFilesystemAccess: false,
    allowNetworkAccess: false,
    allowedHostImports: [],
    sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
  },
});

if (!result.ok) {
  console.error(result.error.message);
  process.exit(1);
}

console.log(\`Built \${result.value.manifest.metadata.name}\`);
console.log(\`Manifest: \${result.value.artifacts.manifestJsonPath}\`);
console.log(\`Kubernetes: \${result.value.artifacts.generatedDeploymentYamlPath ? result.value.artifacts.generatedDeploymentYamlPath.replace(/deployment-[^/]+\\.yaml$/, '') : '<not emitted>'}\`);
console.log(\`Apply: \${result.value.artifacts.generatedApplyScriptPath ?? '<not emitted>'}\`);
`;
}

function importSpecifier(fromDir, targetPath) {
  const specifier = relative(fromDir, targetPath).replaceAll('\\', '/');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

function workspaceSourcePlugin(cwd) {
  const packageAliases = new Map([
    ['@applik8s/applik8s', resolve(cwd, 'packages/applik8s/src/index.ts')],
    ['@applik8s/compiler', resolve(cwd, 'packages/compiler/src/index.ts')],
    ['@applik8s/core', resolve(cwd, 'packages/core/src/index.ts')],
    ['@applik8s/runtime-contract', resolve(cwd, 'packages/runtime-contract/src/index.ts')],
    ['@applik8s/sdk', resolve(cwd, 'packages/sdk/src/index.ts')],
    ['@applik8s/testing', resolve(cwd, 'packages/testing/src/index.ts')],
    ['@applik8s/typekro-adapter', resolve(cwd, 'packages/typekro-adapter/src/index.ts')],
    ['@applik8s/typekro-adapter/targets', resolve(cwd, 'packages/typekro-adapter/src/operation-targets.ts')],
    ['@applik8s/typetainer', resolve(cwd, 'packages/typetainer/src/index.ts')],
  ]);

  return {
    name: 'applik8s-workspace-source',
    setup(build) {
      build.onResolve({ filter: /^@applik8s\// }, async (args) => {
        const alias = packageAliases.get(args.path);
        if (alias && await fileExists(alias)) {
          return { path: alias };
        }
        return undefined;
      });

      build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, async (args) => {
        if (!args.importer.startsWith(resolve(cwd, 'packages'))) {
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
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
