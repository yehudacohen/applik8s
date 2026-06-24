import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { bundleHandlerEntrypoint } from '../src/index.js';

describe('compiler portability policy', () => {
  it('allows direct fetch in async handler source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-fetch-policy-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `export async function handle(input: string): Promise<string> {
  const response = await fetch('https://example.test/healthz');
  return response.ok ? input : input;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects obvious ambient entrypoint assumptions before bundling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `import { readFile } from 'node:fs/promises';

export async function handle(input: string): Promise<string> {
  const secret = process.env.SECRET_TOKEN;
  await import('./late.js');
  await fetch('https://example.test');
  return readFile ? input + secret : input;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.code).toBe('BUNDLE_INVALID');
        expect(bundle.error.context.sourceFile).toBe(entrypoint);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects ambient assumptions in bundled local dependencies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-dependency-policy-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      const helper = join(dir, 'helper.ts');
      await writeFile(
        entrypoint,
        `import { suffix } from './helper';

export function handle(input: string): string {
  return input + suffix();
}
`
      );
      await writeFile(
        helper,
        `export function suffix(): string {
  return process.env.SUFFIX ?? '!';
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.code).toBe('BUNDLE_INVALID');
        expect(bundle.error.context.sourceFile).toMatch(/helper\.ts$/);
        expect(bundle.error.message).toContain('Environment access');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not reject portability words in comments or string literals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-strings-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `// process.env, import('./late.js'), fetch('https://example.test'), and node:fs are examples in docs.
const text = "require('node:fs') fetch('https://example.test') process.env";

export function handle(input: string): string {
  return input + text.length;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects bracketed environment access and raw WebSocket use', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-ast-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `export function handle(input: string): string {
  const secret = process['env'].SECRET_TOKEN;
  new WebSocket('wss://example.test');
  return input + secret;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.message).toContain('Environment access');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects Node runtime globals, dynamic require, and native modules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-node-runtime-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `import { cpus } from 'node:os';

export function handle(input: string): string {
  const runtime = process.cwd() + __dirname + Buffer.byteLength(input);
  const moduleName = 'node:crypto';
  const crypto = require(moduleName);
  return input + cpus().length + runtime + crypto;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.code).toBe('BUNDLE_INVALID');
        expect(bundle.error.message).toContain('Node.js native modules');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects dynamic require when native imports are not otherwise present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-dynamic-require-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `export function handle(input: string): string {
  const moduleName = './runtime-' + input;
  return require(moduleName).value;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.message).toContain('Dynamic require');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects likely embedded secret material and local credential paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-secrets-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `const kubeconfigPath = '/Users/alice/.kube/config';
const apiToken = 'Abcdefghijklmnop1234567890+/=';

export function handle(input: string): string {
  return input + kubeconfigPath + apiToken;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.message).toContain('Local credential paths');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects common cloud credential and env files before bundling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-cloud-credentials-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `const googleCredentials = '/home/alice/.config/gcloud/application_default_credentials.json';
const dotenvPath = '/Users/alice/project/.env.local';
const azureCredentials = 'C:\\Users\\alice\\.azure\\accessTokens.json';

export function handle(input: string): string {
  return input + googleCredentials + dotenvPath + azureCredentials;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.message).toContain('Local credential paths');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects likely secret values even without sensitive variable names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-secret-values-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `export function handle(input: string): string {
  return input + 'AKIA1234567890ABCDEF';
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(false);
      if (!bundle.ok) {
        expect(bundle.error.message).toContain('Likely secret material');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allows Kubernetes Secret reference names without treating them as embedded secret values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-compiler-policy-secret-refs-'));

    try {
      const entrypoint = join(dir, 'handler-entry.ts');
      await writeFile(
        entrypoint,
        `const secretName = 'stripe-api-key';

export function handle(input: string): string {
  return input + secretName;
}
`
      );

      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle') });

      expect(bundle.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
