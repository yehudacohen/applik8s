import { describe, expect, it, vi } from 'vitest';
import { ApplicationCommandClient, ApplicationQueryClient } from '@applik8s/client';
import { applik8sStart } from '../src/vite.js';
import { installApplik8sNitroRequestRuntime } from '../src/server.js';

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
});

function pluginName(value: unknown): string {
  return value && typeof value === 'object' ? String(Reflect.get(value, 'name') ?? '') : '';
}
