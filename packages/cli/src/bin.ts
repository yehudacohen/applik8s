#!/usr/bin/env node

const bunRuntime = typeof process.versions.bun === 'string';
const command = process.argv[2];
const nodeOnlyCommands = new Set([
  'build',
  'plan',
  'deploy',
  'status',
  'destroy',
  'delete',
]);

if (
  bunRuntime
  && command
  && nodeOnlyCommands.has(command)
  && process.env.APPLIK8S_DISABLE_NODE_CLI_HANDOFF !== '1'
) {
  // Compilation, planning, and deployment load Kubernetes/AWS SDKs, TypeKro,
  // Alchemy, and worker-thread compiler paths that rely on Node internals Bun does not
  // implement (notably tcp_wrap). Hand off before application/profile
  // discovery so one command executes once under one runtime and preserves
  // every CLI option verbatim.
  const [{ spawn }, { fileURLToPath }] = await Promise.all([
    // static-import-exception: Load Node-only modules only after deciding that
    // this Bun invocation must hand off; browser-safe CLI imports stay inert.
    import('node:child_process'), // static-import-exception: conditional Node handoff
    // static-import-exception: This is paired with the conditional Node handoff
    // above and must not enter non-handoff Bun/browser module initialization.
    import('node:url'), // static-import-exception: conditional Node handoff
  ]);
  const registerTypescript = new URL('./node-register-typescript.mjs', import.meta.url).href;
  const code = await new Promise<number>((resolve) => {
    const child = spawn('node', [
      '--enable-source-maps',
      '--import', registerTypescript,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        APPLIK8S_DISABLE_NODE_CLI_HANDOFF: '1',
        APPLIK8S_DISABLE_NODE_DEPLOY_HANDOFF: '1',
        APPLIK8S_DISABLE_NODE_DELETE_HANDOFF: '1',
        APPLIK8S_DISABLE_NODE_STATUS_HANDOFF: '1',
      },
    });
    child.on('close', (status) => resolve(status ?? 1));
    child.on('error', () => resolve(1));
  });
  process.exitCode = code;
} else {
  if (!bunRuntime) {
  // The installed executable starts under Node directly, so it must register
  // the same authored-TypeScript resolver used by the Bun-to-Node handoff.
  // static-import-exception: Bun must not evaluate Node's module-hook registration path.
    await import(new URL('./node-register-typescript.mjs', import.meta.url).href);
  }

  // static-import-exception: register authored-TypeScript resolution before the CLI can load an application entrypoint.
  const { runCli } = await import('./cli.js');
  process.exitCode = await runCli(process.argv.slice(2));
}
