import { ApplicationCommandClient, ApplicationQueryClient } from '@applik8s/client';
import { runWithApplik8sServerRequest } from '@applik8s/server';
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
