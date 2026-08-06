import { type } from '@applik8s/applik8s/dsl';
import { workflow } from '../app';
import { HomeTimeline } from '../streams/timeline';

/**
 * One bounded task owns the provider effects; Hatchet owns retries and durable
 * observation while Applik8s owns the generation, artifact, and switch rules.
 */
export const RebuildHomeTimelines = workflow('timeline.rebuild.v1', {
  input: type({ generation: 'string' }),
  output: type({
    generation: 'string', previousGeneration: 'string',
    sourceWatermark: 'number.integer >= 0', publishedWatermark: 'number.integer >= 0',
    events: 'number.integer >= 0', rows: 'number.integer >= 0',
    manifest: {
      store: 'string',
      key: 'string',
      size: 'number.integer >= 0',
      contentType: 'string',
      sha256: 'string',
    },
  }),
}, {
  retries: 3,
  executionTimeoutSeconds: 3_600,
  scheduleTimeoutSeconds: 7_200,
  idempotencyKey: ({ generation }) => generation,
}, async ({ generation }) => {
  const result = await HomeTimeline.rebuild({ generation });
  return {
    generation: result.generation,
    previousGeneration: result.previousGeneration,
    sourceWatermark: result.sourceWatermark,
    publishedWatermark: result.publishedWatermark,
    events: result.events,
    rows: result.rows,
    manifest: result.manifest,
  };
});
