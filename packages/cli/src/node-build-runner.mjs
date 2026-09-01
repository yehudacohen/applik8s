import './node-register-typescript.mjs';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (typeof process.versions.bun === 'string') {
  process.exit(await run('node', [
    fileURLToPath(import.meta.url),
    process.argv[2] ?? '{}',
  ]));
}

const request = JSON.parse(process.argv[2] ?? '{}');
const cwd = resolve(request.cwd ?? process.cwd());
const options = request.options ?? {};
const workspaceRoot = await findWorkspaceRoot(cwd);
process.chdir(cwd);

if (workspaceRoot) {
  process.env.APPLIK8S_WORKSPACE_ROOT = workspaceRoot;
}

const compilerUrl = workspaceRoot
  ? pathToFileURL(join(workspaceRoot, 'packages/compiler/src/index.ts')).href
  : import.meta.resolve('@applik8s/compiler');
// static-import-exception: the isolated build host selects workspace TypeScript or published JavaScript without bundling a second compiler copy.
const { compileTypeKroComposition, createCompilerPipeline } = await import(compilerUrl);
const installationSpec = options.installationSpecPath
  ? await readInstallationSpec(
      resolve(cwd, options.installationSpecPath),
    )
  : undefined;
const connectionBindings = options.connectionBindings
  ? JSON.parse(await readFile(resolve(cwd, options.connectionBindings), 'utf8'))
  : undefined;
const typeKro = Boolean(options.typekro);

const compileRequest = {
  entrypoint: request.entrypoint,
  ...(options.outDir ? { outDir: options.outDir } : {}),
  ...(options.operatorName ? { operatorName: options.operatorName } : {}),
  ...(options.compositionName ? { compositionName: options.compositionName } : {}),
  ...(typeKro ? { operationCatalogPolicy: options.production ? 'production' : 'development' } : {}),
  ...(options.executionTarget
    ? { executionTarget: options.executionTarget }
    : options.localDevelopment
      ? { executionTarget: 'local' }
      : {}),
  ...(options.profile
    ? { profile: options.profile, configuration: process.env }
    : {}),
  ...(installationSpec ? { installationSpec } : {}),
  runtimeVersionRange: '^0.1.0',
  handlerAbiVersion: 'applik8s.handler/v1alpha1',
  adapter: 'wasmComponent',
  ...(connectionBindings
    ? typeKro
      ? { operatorKubernetesConnectionBindings: connectionBindings }
      : { kubernetesConnectionBindings: connectionBindings }
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

const result = typeKro
  ? await compileTypeKroComposition(compileRequest)
  : await createCompilerPipeline().run(compileRequest);

if (!result.ok) {
  console.error(result.error.message);
  process.exitCode = 1;
} else if (typeKro) {
  console.log(`Built TypeKro composition ${result.value.artifacts.manifest.metadata.name}`);
  console.log(`Composition: ${result.value.artifacts.manifestJsonPath}`);
  console.log(`Resources: ${result.value.artifacts.combinedYamlPath}`);
  console.log(`Apply: ${result.value.artifacts.applyScriptPath}`);
  console.log(`Operators: ${result.value.artifacts.operatorArtifacts.length}`);
} else {
  console.log(`Built ${result.value.manifest.metadata.name}`);
  console.log(`Manifest: ${result.value.artifacts.manifestJsonPath}`);
  console.log(`Kubernetes: ${result.value.artifacts.generatedDeploymentYamlPath
    ? result.value.artifacts.generatedDeploymentYamlPath.replace(/deployment-[^/]+\.yaml$/, '')
    : '<not emitted>'}`);
  console.log(`Apply: ${result.value.artifacts.generatedApplyScriptPath ?? '<not emitted>'}`);
}

async function findWorkspaceRoot(start) {
  let current = resolve(start);
  for (;;) {
    if (
      await fileExists(join(current, 'packages/compiler/src/index.ts'))
      && await fileExists(join(current, 'packages/applik8s/src/index.ts'))
    ) return current;
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

async function readInstallationSpec(path) {
  const sourceUrl = new URL('./application-deployment-instance-files.ts', import.meta.url);
  const moduleUrl = await fileExists(fileURLToPath(sourceUrl))
    ? sourceUrl
    : new URL('./application-deployment-instance-files.js', import.meta.url);
  // static-import-exception: The source runner and published runner have
  // different extensions; select the one that exists without two code paths.
  const { readExplicitApplicationInstallationSpec } = await import(moduleUrl.href); // static-import-exception: source/published extension selection
  return readExplicitApplicationInstallationSpec(path);
}

function run(command, args) {
  return new Promise((resolveCode) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('close', (code) => resolveCode(code ?? 1));
    child.on('error', () => resolveCode(1));
  });
}
