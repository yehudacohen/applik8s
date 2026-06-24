import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { emitRuntimeContractArtifact } from '../src/index.js';

describe('compiler runtime contract artifact', () => {
  it('emits the canonical runtime contract with payload schemas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-runtime-contract-'));

    try {
      const result = await emitRuntimeContractArtifact({ outDir: dir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const artifact = JSON.parse(await readFile(result.value.path, 'utf8'));

        expect(artifact.abiVersion).toBe('applik8s.handler/v1alpha1');
        expect(artifact.runtimeAdapterKind).toBe('wasmComponent');
        expect(artifact.payloadSchemas.handlerInput.required).toContain('object');
        expect(artifact.payloadSchemas.normalizedOperationPlan.properties.operations.type).toBe('array');
        expect(artifact.payloadSchemas.operatorManifest.properties.apiVersion.const).toBe('applik8s.operator/v1alpha1');
        expect(artifact.payloadSchemas.capabilityRequest.required).toContain('reconcileId');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
