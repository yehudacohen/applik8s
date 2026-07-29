import { StructuredGeneration } from '@applik8s/applik8s/structured-generation';
import { task, type, workflow } from '@applik8s/applik8s/dsl';
import { app } from '../app';
import { AutomationControl, AutomationRun } from '../domain/automation';
import { Post } from '../domain/post';

const ScorePost = task('posts.score.v1', {
  input: type({ postId: 'string', body: 'string' }),
  output: type({ postId: 'string', risk: 'number' }),
});

const ModeratePost = workflow('posts.moderate.v1', {
  input: type({ postId: 'string', body: 'string' }),
  output: type({ postId: 'string', approved: 'boolean', risk: 'number' }),
});

const GeneratedPost = type({ body: 'string' });
const GeneratePost = task('automation.generate-post.v1', {
  input: type({ runId: 'string', profile: 'string', persona: 'string', instructions: 'string', context: 'string[]' }),
  output: type({ body: 'string', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0' }),
});

const PrepareAutomationPost = workflow('automation.prepare-post.v1', {
  input: type({ runId: 'string', profile: 'string', persona: 'string', instructions: 'string', context: 'string[]' }),
  output: type({ body: 'string', approved: 'boolean', risk: 'number', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0' }),
});

const ExecuteAutomationRunEffects = task('automation.execute-run.effects.v1', {
  input: type({
    automationId: 'string', accountId: 'string',
    profile: 'string', persona: 'string', instructions: 'string', scheduledFor: 'string',
  }),
  output: type({
    runId: 'string', postId: 'string | null', state: "'published' | 'rejected'",
    risk: 'number', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0',
  }),
});

const ExecuteAutomationRun = workflow('automation.execute-run.v1', {
  input: type({
    automationId: 'string', accountId: 'string',
    profile: 'string', persona: 'string', instructions: 'string',
  }),
  output: type({
    runId: 'string', postId: 'string | null', state: "'published' | 'rejected'",
    risk: 'number', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0',
  }),
});

export const scorePost = app.task(ScorePost, {
  retries: 3,
  idempotencyKey: ({ postId }) => postId,
}, async ({ postId, body }) => ({ postId, risk: body.includes('http://') ? 0.8 : 0.05 }));

export const moderatePost = app.workflow(ModeratePost, { tasks: { scorePost } }, async (input, context) => {
  const result = await context.task('scorePost', input, { idempotencyKey: input.postId });
  return { postId: input.postId, approved: result.risk < 0.7, risk: result.risk };
});

export const generatePost = app.task(GeneratePost, {
  requires: [StructuredGeneration],
  retries: 2,
  executionTimeoutSeconds: 45,
  idempotencyKey: ({ runId }) => runId,
}, async (input, context) => {
  const generated = await context.use(StructuredGeneration).generate({
    profile: input.profile,
    input: { persona: input.persona, instructions: input.instructions, context: input.context.slice(0, 20) },
    output: GeneratedPost,
    idempotencyKey: input.runId,
    timeoutSeconds: 45,
    signal: context.signal,
  });
  return { body: generated.value.body, inputUnits: generated.usage.inputUnits, outputUnits: generated.usage.outputUnits };
});

/**
 * The service principal is compiler-bound outside the handler. The handler can
 * invoke only these three existing model operations, and every mutation still
 * passes through the ordinary JetStream command processor and PostgreSQL
 * beforeCommit policy/outbox transaction.
 */
const executeAutomationRunEffects = app.task(ExecuteAutomationRunEffects, {
  requires: [StructuredGeneration],
  operations: {
    createRun: AutomationRun.create,
    updateRun: AutomationRun.update,
    publish: Post.create,
  },
  queries: { automationControl: AutomationControl.current, context: Post.homeTimeline },
  principal: (input) => ({
    id: input.accountId,
    claims: { kind: 'automation', role: 'automation-worker', automationId: input.automationId },
    authorizationVersion: 'chirp-automation-v1',
    trustedContext: { automationId: input.automationId, executionAuthority: 'applik8s-workflow' },
  }),
  retries: 2,
  executionTimeoutSeconds: 120,
}, async (input, context) => {
  const runId = context.invocationId;
  let observedUsageUnits = 0;
  const run = await context.operations.createRun({
    id: runId,
    automationId: input.automationId,
    scheduledFor: input.scheduledFor,
  }, { idempotencyKey: `${runId}:start` });
  try {
    const automationControl = await context.queries.automationControl({});
    if (!automationControl.enabled) {
      await context.operations.updateRun({
        identity: runId,
        patch: { state: 'rejected', usageUnits: '0', resultReference: 'automation:disabled' },
      }, { idempotencyKey: `${runId}:disabled` });
      return { runId, postId: null, state: 'rejected', risk: 1, inputUnits: 0, outputUnits: 0 };
    }
    const recent = await context.queries.context({ limit: 20 });
    const generationContext = recent.slice(0, 20).map((post) => `${post.authorHandle}: ${post.body}`.slice(0, 320));
    const generated = await context.use(StructuredGeneration).generate({
      profile: input.profile,
      input: { persona: input.persona, instructions: input.instructions, context: generationContext },
      output: GeneratedPost,
      idempotencyKey: runId,
      timeoutSeconds: 45,
      signal: context.signal,
    });
    const risk = generated.value.body.includes('http://') ? 0.8 : 0.05;
    const usageUnits = generated.usage.inputUnits + generated.usage.outputUnits;
    observedUsageUnits = usageUnits;
    const reservedUnits = Number(run.value.reservedUnits);
    if (!Number.isSafeInteger(reservedUnits) || usageUnits > reservedUnits) {
      await context.operations.updateRun({
        identity: runId,
        patch: { state: 'rejected', usageUnits: String(usageUnits), resultReference: `quota:reserved:${reservedUnits}` },
      }, { idempotencyKey: `${runId}:quota-rejected` });
      return { runId, postId: null, state: 'rejected', risk: 1, inputUnits: generated.usage.inputUnits, outputUnits: generated.usage.outputUnits };
    }
    if (risk >= 0.7) {
      await context.operations.updateRun({
        identity: runId,
        patch: { state: 'rejected', usageUnits: String(usageUnits), resultReference: `moderation:risk:${risk}` },
      }, { idempotencyKey: `${runId}:rejected` });
      return { runId, postId: null, state: 'rejected', risk, inputUnits: generated.usage.inputUnits, outputUnits: generated.usage.outputUnits };
    }
    const postId = `${runId}:post`;
    await context.operations.publish({ id: postId, body: generated.value.body, visibility: 'public' }, { idempotencyKey: `${runId}:publish` });
    await context.operations.updateRun({
      identity: runId,
      patch: { state: 'published', publishedPostId: postId, usageUnits: String(usageUnits), resultReference: `post:${postId}` },
    }, { idempotencyKey: `${runId}:published` });
    return { runId, postId, state: 'published', risk, inputUnits: generated.usage.inputUnits, outputUnits: generated.usage.outputUnits };
  } catch (error) {
    await context.operations.updateRun({
      identity: runId,
      patch: { state: 'failed', usageUnits: String(observedUsageUnits), resultReference: 'workflow:failed' },
    }, { idempotencyKey: `${runId}:failed` }).catch(() => undefined);
    throw error;
  }
});

/**
 * The recurring provider triggers a durable workflow, not the effect task
 * directly. `context.now()` is workflow-history-backed, so retries keep the
 * same quota window instead of observing a later wall-clock instant.
 */
export const executeAutomationRun = app.workflow(
  ExecuteAutomationRun,
  { tasks: { execute: executeAutomationRunEffects } },
  async (input, context) => context.task('execute', {
    ...input,
    scheduledFor: (await context.now()).toISOString(),
  }, { idempotencyKey: context.invocationId }),
);

/** Durable preparation only: publication remains an authorized Post.create operation. */
export const prepareAutomationPost = app.workflow(PrepareAutomationPost, { tasks: { generatePost, scorePost } }, async (input, context) => {
  const generated = await context.task('generatePost', input, { idempotencyKey: input.runId });
  const moderation = await context.task('scorePost', { postId: input.runId, body: generated.body }, { idempotencyKey: `${input.runId}:moderation` });
  return { ...generated, approved: moderation.risk < 0.7, risk: moderation.risk };
});
