import { ApplicationCommandClient, ApplicationQueryClient } from '@applik8s/client';
import { runWithApplik8sServerRequest } from '@applik8s/server';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  installApplik8sNitroRequestRuntime,
  loadApplicationIdentitySession,
} from '../src/server.js';
import { applik8sStart } from '../src/vite.js';

describe('TanStack Start Vite adapter', () => {
  it('is a thin Nitro host around the framework-neutral Vite plugin', () => {
    const plugins = applik8sStart({ application: 'src/application.ts' }).flat().filter(Boolean);
    expect(plugins.some((plugin) => pluginName(plugin) === '@applik8s/vite')).toBe(true);
    expect(plugins.some((plugin) => pluginName(plugin).includes('nitro'))).toBe(true);
    expect(plugins.findIndex((plugin) => pluginName(plugin) === '@applik8s/vite')).toBeLessThan(
      plugins.findIndex((plugin) => pluginName(plugin).includes('nitro')),
    );
    expect(plugins.findIndex((plugin) => pluginName(plugin) === '@applik8s/tanstack-start-fetch-adapter')).toBeLessThan(
      plugins.findIndex((plugin) => pluginName(plugin).includes('nitro')),
    );
  });

  it('generates a fail-closed health handler alongside the gateway adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-health-'));
    try {
      await mkdir(join(root, '.applik8s/generated'), { recursive: true });
      await writeFile(join(root, '.applik8s/generated/gateway.generated.ts'), 'export const gateway = {};\n');
      const plugins = applik8sStart({ application: 'src/application.ts' }).flat().filter(Boolean);
      const adapter = plugins.find((plugin) => pluginName(plugin) === '@applik8s/tanstack-start-fetch-adapter');
      expect(adapter).toBeDefined();
      const hook = adapter && typeof adapter === 'object' ? Reflect.get(adapter, 'configResolved') : undefined;
      expect(hook).toBeTypeOf('function');
      await hook.call(adapter, { root });
      const health = await readFile(join(root, '.applik8s/generated/nitro-health.generated.ts'), 'utf8');
      expect(health).toContain("import { gateway } from './gateway.generated.js';");
      expect(health).toContain("component: 'applik8s-start'");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps hosted applications without an HTTP gateway healthy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-health-'));
    try {
      const plugins = applik8sStart({ application: 'src/application.ts' }).flat().filter(Boolean);
      const adapter = plugins.find((plugin) => pluginName(plugin) === '@applik8s/tanstack-start-fetch-adapter');
      const hook = adapter && typeof adapter === 'object' ? Reflect.get(adapter, 'configResolved') : undefined;
      expect(hook).toBeTypeOf('function');
      await hook.call(adapter, { root });
      const health = await readFile(join(root, '.applik8s/generated/nitro-health.generated.ts'), 'utf8');
      const handler = await readFile(join(root, '.applik8s/generated/nitro-handler.generated.ts'), 'utf8');
      const plugin = await readFile(join(root, '.applik8s/generated/nitro-plugin.generated.ts'), 'utf8');
      expect(health).not.toContain('gateway.generated.js');
      expect(health).toContain("component: 'applik8s-start'");
      expect(handler).toContain("new Response('Not Found', { status: 404 })");
      expect(plugin).toBe('export default () => undefined;\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not require the optional fetch.preconnect optimization', () => {
    expect(typeof Reflect.get(globalThis.fetch, 'preconnect')).not.toBe('function');
    expect(ApplicationQueryClient).toBeTypeOf('function');
    expect(ApplicationCommandClient).toBeTypeOf('function');
    expect(installApplik8sNitroRequestRuntime).toBeTypeOf('function');
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });

  it('loads the SSR identity snapshot through the request-scoped gateway transport', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://application.test/__applik8s/v1/identity/session');
      return Response.json({
        protocol: 'applik8s.identityHttp/v1alpha1',
        kind: 'session',
        authenticated: false,
        assurance: [],
      });
    });
    const fetch = Object.assign(request, { preconnect: vi.fn() });
    const inbound = new Request('https://application.test/workspaces', {
      headers: { cookie: 'application_session=opaque' },
    });

    const session = await runWithApplik8sServerRequest({
      request: inbound,
      fetch,
      // The transport clients are inert in this identity-only adapter test.
      // typecast: no query call is admitted by the identity snapshot operation.
      queryClient: {} as ApplicationQueryClient,
      // typecast: no command is admitted by the identity snapshot operation.
      commandClient: {} as ApplicationCommandClient,
    }, () => loadApplicationIdentitySession());

    expect(session.authenticated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

function pluginName(value: unknown): string {
  return value && typeof value === 'object' ? String(Reflect.get(value, 'name') ?? '') : '';
}
