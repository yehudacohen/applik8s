import { task, type, workflow } from '@applik8s/applik8s/dsl';
import { app } from '../app';
import { ProjectionArtifacts } from '../media/objects';
import { HomeTimeline } from '../streams/timeline';

const BuildHomeTimelineGeneration = task('timeline.build-generation.v1', {
  input: type({ generation: 'string' }),
  output: type({
    generation: 'string', previousGeneration: 'string',
    sourceWatermark: 'number.integer >= 0', publishedWatermark: 'number.integer >= 0',
    events: 'number.integer >= 0', rows: 'number.integer >= 0', manifestKey: 'string',
  }),
});

const RebuildHomeTimelinesDefinition = workflow('timeline.rebuild.v1', {
  input: type({ generation: 'string' }),
  output: type({
    generation: 'string', previousGeneration: 'string',
    sourceWatermark: 'number.integer >= 0', publishedWatermark: 'number.integer >= 0',
    events: 'number.integer >= 0', rows: 'number.integer >= 0', manifestKey: 'string',
  }),
});

/**
 * One bounded task owns the provider effects; Hatchet owns retries and durable
 * observation while Applik8s owns the generation, artifact, and switch rules.
 */
export const buildHomeTimelineGeneration = app.task(BuildHomeTimelineGeneration, {
  projections: {
    homeTimeline: {
      projection: HomeTimeline,
      artifacts: ProjectionArtifacts,
      bounds: {
        batchSize: 500,
        maxSegments: 20_000,
        maxSegmentBytes: 8_000_000,
        maxEvents: 10_000_000,
        maxCatchUpRounds: 32,
      },
    },
  },
  retries: 3,
  executionTimeoutSeconds: 3_600,
  scheduleTimeoutSeconds: 7_200,
  idempotencyKey: ({ generation }) => generation,
}, async ({ generation }, context) => {
  const result = await context.projections.homeTimeline.rebuild({ generation });
  return {
    generation: result.generation,
    previousGeneration: result.previousGeneration,
    sourceWatermark: result.sourceWatermark,
    publishedWatermark: result.publishedWatermark,
    events: result.events,
    rows: result.rows,
    manifestKey: result.manifest.key,
  };
});

export const RebuildHomeTimelines = app.workflow(RebuildHomeTimelinesDefinition, {
  tasks: { buildGeneration: buildHomeTimelineGeneration },
}, async (input, context) => context.task('buildGeneration', input, { idempotencyKey: input.generation }));
