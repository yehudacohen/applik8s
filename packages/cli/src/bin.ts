#!/usr/bin/env node

if (typeof process.versions.bun !== 'string') {
  // The installed executable starts under Node directly, so it must register
  // the same authored-TypeScript resolver used by the Bun-to-Node handoff.
  // static-import-exception: Bun must not evaluate Node's module-hook registration path.
  await import(new URL('./node-register-typescript.mjs', import.meta.url).href);
}

// static-import-exception: register authored-TypeScript resolution before the CLI can load an application entrypoint.
const { runCli } = await import('./cli.js');
process.exitCode = await runCli(process.argv.slice(2));
