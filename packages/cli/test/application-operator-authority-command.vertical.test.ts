import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { ApplicationDeploymentEvidenceReceipt } from '@applik8s/operations';
import { publishApplicationDeploymentReceipt } from '../src/application-operator-authority-command.js';

describe('application operator deployment evidence', () => {
  it('treats an unavailable first-deployment authority store as absent evidence, not deployment failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-operator-evidence-'));
    // typecast: this negative-path fixture reaches the missing store before receipt fields are read.
    const receipt = {
      apiVersion: 'applik8s.deploymentEvidence/v1alpha1',
      kind: 'ApplicationDeploymentEvidenceReceipt',
    } as ApplicationDeploymentEvidenceReceipt;

    await expect(publishApplicationDeploymentReceipt(
      receipt,
      '.applik8s/deploy',
      { cwd: root, stdout() {} },
      { context: 'fresh-cluster', installationSpec: {} },
    )).resolves.toBe(false);
  });
});
