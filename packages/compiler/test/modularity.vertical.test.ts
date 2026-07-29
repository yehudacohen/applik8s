import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const exclusions: Readonly<Record<string, readonly string[]>> = {
  'packages/applik8s/src/application.ts': ['function generatedApplicationAggregateSource', 'function generatedValkeyIndexerSource'],
  'packages/applik8s/src/application-generated-runtime-sources.ts': ['createApplicationContext', 'recordApplicationServerGraph'],
  'packages/compiler/src/pipeline/index.ts': ['function staticEntrypointCaptures', 'function discoverEntrypointExports'],
  'packages/compiler/src/pipeline/static-dispatcher.ts': ['emitTypeKroCompositionArtifacts', 'emitOperatorKubernetesYaml'],
  'packages/compiler/src/pipeline/entrypoint-discovery.ts': ['staticEntrypointCaptures', 'emitTypeKroCompositionArtifacts'],
};

// typecast: the tracked JSON file is the single release budget authority and is validated table-by-table below.
const budgets = JSON.parse(await readFile(resolve('benchmarks/v0.5/maintainability-budgets.json'), 'utf8')) as Readonly<Record<string, number>>;
const modules = Object.entries(budgets).map(([path, ceiling]) => ({ path, ceiling, excluded: exclusions[path] ?? [] }));

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
