// typecast-file-boundary: workflow signal and structured-generation outputs are schema-validated before their provider-neutral domain shapes are restored.
import { StructuredGeneration } from '@applik8s/applik8s/structured-generation';
import { type } from '@applik8s/applik8s/dsl';
import { workflow } from '../app';
import { AutomationRun, AutomationControlCurrent } from '../domain/automation';
import { PostHomeTimeline, Post } from '../domain/post';

const GeneratedPost = type({ body: 'string' });

export const AutomationPostReview = workflow.signal(
  'automation.post-review.v1',
  {
    input: type({
      runId: 'string',
      automationId: 'string',
      postId: 'string',
      body: 'string',
      risk: 'number',
    }),
    actions: {
      approve: type({ 'comment?': 'string' }),
      reject: type({ reason: 'string' }),
    },
  },
);

export const AutomationPostReviewRequests = AutomationPostReview.subscribe(
  'automation-post-review-requests',
  {
    delivery: 'sse',
    authorize: ({ principal }) =>
      principal.roles?.includes('moderator') === true,
  },
);

export const scorePost = workflow(
  'posts.score.v1',
  {
    input: type({ postId: 'string', body: 'string' }),
    output: type({ postId: 'string', risk: 'number' }),
  },
  {
    retries: 3,
    idempotencyKey: ({ postId }) => postId,
  },
  async ({ postId, body }) => ({ postId, risk: body.includes('http://') ? 0.8 : 0.05 }),
);

export const moderatePost = workflow(
  'posts.moderate.v1',
  {
    input: type({ postId: 'string', body: 'string' }),
    output: type({ postId: 'string', approved: 'boolean', risk: 'number' }),
  },
  async (input) => {
    const result = await scorePost(input, { idempotencyKey: input.postId });
    return { postId: input.postId, approved: result.risk < 0.7, risk: result.risk };
  },
);

export const generatePost = workflow(
  'automation.generate-post.v1',
  {
    input: type({ runId: 'string', profile: 'string', persona: 'string', instructions: 'string', context: 'string[]' }),
    output: type({ body: 'string', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0' }),
  },
  {
    requires: [StructuredGeneration],
    retries: 2,
    executionTimeoutSeconds: 45,
    idempotencyKey: ({ runId }) => runId,
  },
  async (input, context) => {
    const generated = await context.use(StructuredGeneration).generate({
      profile: input.profile,
      input: { persona: input.persona, instructions: input.instructions, context: input.context.slice(0, 20) },
      output: GeneratedPost,
      idempotencyKey: input.runId,
      timeoutSeconds: 45,
      signal: context.signal,
    });
    return { body: generated.value.body, inputUnits: generated.usage.inputUnits, outputUnits: generated.usage.outputUnits };
  },
);

const AutomationExecutionResult = type({
  runId: 'string',
  postId: 'string | null',
  state: "'published' | 'rejected'",
  risk: 'number',
  inputUnits: 'number.integer >= 0',
  outputUnits: 'number.integer >= 0',
});

function automationWorkerPrincipal(input: {
  automationId: string;
  accountId: string;
}) {
  return {
    id: input.accountId,
    roles: ['automation-worker'],
    attributes: {
      kind: 'automation',
      automationId: input.automationId,
    },
    authorizationVersion: 'chirp-automation-v1',
    trustedContext: {
      automationId: input.automationId,
      executionAuthority: 'applik8s-workflow',
    },
  };
}

/**
 * An ordinary function-native workflow becomes the retryable preparation step.
 * The compiler captures its model/query/provider authority and keeps these
 * external effects out of durable orchestration history without public task
 * declarations.
 */
const prepareAutomationRun = workflow('automation.prepare-run.v1', {
  input: type({
    automationId: 'string', accountId: 'string',
    profile: 'string', persona: 'string', instructions: 'string', scheduledFor: 'string',
  }),
  output: type({
    runId: 'string',
    postId: 'string | null',
    body: 'string | null',
    disposition: "'ready' | 'rejected'",
    risk: 'number', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0',
  }),
}, {
  requires: [StructuredGeneration],
  authority: [
    AutomationRun.create.all(),
    AutomationRun.update.all(),
  ],
  principal: automationWorkerPrincipal,
  retries: 2,
  executionTimeoutSeconds: 120,
}, async (input, context) => {
  const runId = context.invocationId;
  let observedUsageUnits = 0;
  const run = await AutomationRun.create({
    id: runId,
    automationId: input.automationId,
    scheduledFor: input.scheduledFor,
  });
  try {
    const automationControl = await AutomationControlCurrent();
    if (!automationControl.enabled) {
      await AutomationRun.update({
        identity: runId,
        patch: { state: 'rejected', usageUnits: '0', resultReference: 'automation:disabled' },
      });
      return {
        runId,
        postId: null,
        body: null,
        disposition: 'rejected' as const,
        risk: 1,
        inputUnits: 0,
        outputUnits: 0,
      };
    }
    const recent = await PostHomeTimeline({ limit: 20 });
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
      await AutomationRun.update({
        identity: runId,
        patch: { state: 'rejected', usageUnits: String(usageUnits), resultReference: `quota:reserved:${reservedUnits}` },
      });
      return {
        runId,
        postId: null,
        body: null,
        disposition: 'rejected' as const,
        risk: 1,
        inputUnits: generated.usage.inputUnits,
        outputUnits: generated.usage.outputUnits,
      };
    }
    const postId = `${runId}:post`;
    return {
      runId,
      postId,
      body: generated.value.body,
      disposition: 'ready' as const,
      risk,
      inputUnits: generated.usage.inputUnits,
      outputUnits: generated.usage.outputUnits,
    };
  } catch (error) {
    await AutomationRun.update({
      identity: runId,
      patch: { state: 'failed', usageUnits: String(observedUsageUnits), resultReference: 'workflow:failed' },
    }).catch(() => undefined);
    throw error;
  }
});

const publishAutomationRun = workflow(
  'automation.publish-run.v1',
  {
    input: type({
      automationId: 'string',
      accountId: 'string',
      runId: 'string',
      postId: 'string',
      body: 'string',
      risk: 'number',
      inputUnits: 'number.integer >= 0',
      outputUnits: 'number.integer >= 0',
    }),
    output: AutomationExecutionResult,
  },
  {
    authority: [Post.create.all(), AutomationRun.update.all()],
    principal: automationWorkerPrincipal,
    retries: 2,
  },
  async (input) => {
    await Post.create({
      id: input.postId,
      body: input.body,
      visibility: 'public',
    });
    await AutomationRun.update({
      identity: input.runId,
      patch: {
        state: 'published',
        publishedPostId: input.postId,
        usageUnits: String(input.inputUnits + input.outputUnits),
        resultReference: `post:${input.postId}`,
      },
    });
    return {
      runId: input.runId,
      postId: input.postId,
      state: 'published' as const,
      risk: input.risk,
      inputUnits: input.inputUnits,
      outputUnits: input.outputUnits,
    };
  },
);

const rejectAutomationRun = workflow(
  'automation.reject-run.v1',
  {
    input: type({
      automationId: 'string',
      accountId: 'string',
      runId: 'string',
      risk: 'number',
      inputUnits: 'number.integer >= 0',
      outputUnits: 'number.integer >= 0',
      resultReference: 'string',
    }),
    output: AutomationExecutionResult,
  },
  {
    authority: [AutomationRun.update.all()],
    principal: automationWorkerPrincipal,
    retries: 2,
  },
  async (input) => {
    await AutomationRun.update({
      identity: input.runId,
      patch: {
        state: 'rejected',
        usageUnits: String(input.inputUnits + input.outputUnits),
        resultReference: input.resultReference,
      },
    });
    return {
      runId: input.runId,
      postId: null,
      state: 'rejected' as const,
      risk: input.risk,
      inputUnits: input.inputUnits,
      outputUnits: input.outputUnits,
    };
  },
);

/**
 * The recurring provider triggers one durable coordinator. Direct workflow
 * calls become compiler-owned steps; signal issuance and waiting stay in
 * workflow history. Application code never names or wires task primitives.
 */
export const executeAutomationRun = workflow(
  'automation.execute-run.v1',
  {
    input: type({
      automationId: 'string', accountId: 'string',
      profile: 'string', persona: 'string', instructions: 'string',
    }),
    output: AutomationExecutionResult,
  },
  async (input, context) => {
    const prepared = await prepareAutomationRun({
      ...input,
      scheduledFor: (await context.now()).toISOString(),
    }, { idempotencyKey: context.invocationId });
    if (
      prepared.disposition === 'rejected'
      || !prepared.postId
      || !prepared.body
    ) {
      return {
        runId: prepared.runId,
        postId: null,
        state: 'rejected',
        risk: prepared.risk,
        inputUnits: prepared.inputUnits,
        outputUnits: prepared.outputUnits,
      };
    }
    const effectInput = {
      automationId: input.automationId,
      accountId: input.accountId,
      runId: prepared.runId,
      postId: prepared.postId,
      body: prepared.body,
      risk: prepared.risk,
      inputUnits: prepared.inputUnits,
      outputUnits: prepared.outputUnits,
    };
    if (prepared.risk < 0.7) {
      return publishAutomationRun(effectInput);
    }
    const review = await workflow.emitSignal(AutomationPostReview, {
      input: {
        runId: prepared.runId,
        automationId: input.automationId,
        postId: prepared.postId,
        body: prepared.body,
        risk: prepared.risk,
      },
      expiresIn: '24h',
      target: {
        automationId: input.automationId,
        runId: prepared.runId,
        postId: prepared.postId,
      },
      authorize: [{ role: 'moderator' }],
    });
    const decision = await review();
    return decision.match({
      approve: async () =>
        publishAutomationRun(effectInput),
      reject: async () =>
        rejectAutomationRun({
          automationId: input.automationId,
          accountId: input.accountId,
          runId: prepared.runId,
          risk: prepared.risk,
          inputUnits: prepared.inputUnits,
          outputUnits: prepared.outputUnits,
          resultReference: `signal:${review.issuance.id}:rejected`,
        }),
      expired: async () =>
        rejectAutomationRun({
          automationId: input.automationId,
          accountId: input.accountId,
          runId: prepared.runId,
          risk: prepared.risk,
          inputUnits: prepared.inputUnits,
          outputUnits: prepared.outputUnits,
          resultReference: `signal:${review.issuance.id}:expired`,
        }),
    });
  },
);

/** Durable preparation only: publication remains an authorized Post.create operation. */
export const prepareAutomationPost = workflow(
  'automation.prepare-post.v1',
  {
    input: type({ runId: 'string', profile: 'string', persona: 'string', instructions: 'string', context: 'string[]' }),
    output: type({ body: 'string', approved: 'boolean', risk: 'number', inputUnits: 'number.integer >= 0', outputUnits: 'number.integer >= 0' }),
  },
  async (input) => {
    const generated = await generatePost(input, { idempotencyKey: input.runId });
    const moderation = await scorePost(
      { postId: input.runId, body: generated.body },
      { idempotencyKey: `${input.runId}:moderation` },
    );
    return { ...generated, approved: moderation.risk < 0.7, risk: moderation.risk };
  },
);
