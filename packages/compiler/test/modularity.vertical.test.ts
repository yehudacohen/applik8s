import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// typecast: readonly literal entries keep file-specific ceiling and exclusion contracts intact for the table-driven test.
const modules = [
  { path: 'packages/applik8s/src/application.ts', ceiling: 3_800, excluded: ['function generatedApplicationAggregateSource', 'function generatedValkeyIndexerSource'] },
  { path: 'packages/applik8s/src/application-generated-runtime-sources.ts', ceiling: 750, excluded: ['createApplicationContext', 'recordApplicationServerGraph'] },
  { path: 'packages/compiler/src/pipeline/index.ts', ceiling: 1_200, excluded: ['function staticEntrypointCaptures', 'function discoverEntrypointExports'] },
  { path: 'packages/compiler/src/pipeline/static-dispatcher.ts', ceiling: 600, excluded: ['emitTypeKroCompositionArtifacts', 'emitOperatorKubernetesYaml'] },
  { path: 'packages/compiler/src/pipeline/entrypoint-discovery.ts', ceiling: 140, excluded: ['staticEntrypointCaptures', 'emitTypeKroCompositionArtifacts'] },
] as const;

describe('v0.5 maintainability boundary', () => {
  it.each(modules)('$path remains a focused orchestration module', async ({ path, ceiling, excluded }) => {
    const source = await readFile(resolve(path), 'utf8');
    const lines = source.split('\n').length;
    expect(lines, `${path} crossed its reviewed ${ceiling}-line architecture ceiling`).toBeLessThanOrEqual(ceiling);
    for (const responsibility of excluded) {
      expect(source, `${path} reabsorbed ${responsibility}`).not.toContain(responsibility);
    }
  });
});
