import { describe, expect, it } from 'vitest';
import { applik8sStart } from '../src/vite.js';

describe('TanStack Start Vite adapter', () => {
  it('is a thin Nitro host around the framework-neutral Vite plugin', () => {
    const plugins = applik8sStart({ application: 'src/application.ts' }).flat().filter(Boolean);
    expect(plugins.some((plugin) => pluginName(plugin) === '@applik8s/vite')).toBe(true);
    expect(plugins.some((plugin) => pluginName(plugin).includes('nitro'))).toBe(true);
  });
});

function pluginName(value: unknown): string {
  return value && typeof value === 'object' ? String(Reflect.get(value, 'name') ?? '') : '';
}
