import { describe, expect, it } from 'vitest';

import { ImageJob, imagePipeline } from '../../../examples/imagejob.js';
import { testing } from '../src/index.js';

describe('local performance smoke', () => {
  it('reconciles multiple ImageJob objects without shared-state drift', async () => {
    const runs = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
      const image = ImageJob({
        name: `hero-image-${index}`,
        namespace: 'media',
        spec: { sourceUrl: `s3://bucket/hero-${index}.png`, formats: ['webp', 'avif'], priority: 'normal' },
      });

      return testing
        .testOperator(imagePipeline)
        .given(image)
        .expectApply({ apiVersion: 'v1', kind: 'ConfigMap', name: `hero-image-${index}-output`, namespace: 'media' })
        .expectStatus({ phase: 'Processing', outputUrls: [`s3://processed/hero-image-${index}.webp`, `s3://processed/hero-image-${index}.avif`] })
        .expectRequeue(30)
        .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: `hero-image-${index}`, namespace: 'media' } });
    }));

    expect(runs.every((run) => run.ok)).toBe(true);
    for (const run of runs) {
      if (run.ok) {
        expect(run.value.assertionFailures).toEqual([]);
        expect(run.value.normalizedPlan).toBeDefined();
        if (!run.value.normalizedPlan) {
          continue;
        }
        expect(run.value.normalizedPlan.operations.map((operation) => operation.kind)).toEqual(['finalizer', 'apply', 'status', 'event', 'requeue']);
      }
    }
  });
});
