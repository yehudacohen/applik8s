import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applicationCallbackModuleIsInstrumentable,
  applicationCallbackModuleOwnsDependencies,
  applicationPackageOwnsModule,
  instrumentApplicationCallbackRegistrations,
} from '../src/pipeline/entrypoint-discovery.js';

describe('application callback discovery instrumentation', () => {
  it('captures direct operations from app.http handlers without a dependency map', () => {
    const source = `
const api = application.http("public-api");
api.post(
  "create-post",
  "/posts",
  { input: CreatePostInput, output: CreatePostOutput, authorize: canCreatePost },
  async ({ input }) => Post.create(input),
);
`;
    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/http.ts',
      true,
      'src/http.ts',
    );

    expect(instrumented).toContain(
      'identifier: "Post.create", value: Post.create',
    );
    expect(instrumented).toContain('"Post.create": Post.create');
    expect(instrumented).toContain('registrar: "app.http.post"');
    expect(instrumented).toContain('property: "authorize"');
    expect(instrumented).toContain('property: "handler"');
  });

  it('captures maintained provider calls from app.http webhook authentication', () => {
    const source = `
const api = application.http("billing");
api.webhook(
  "receive-payment",
  "/webhooks/payments",
  {
    event: PaymentEvent,
    output: PaymentResult,
    authenticate: request => Billing.verifyWebhook(request),
  },
  async ({ input }) => Billing.PaymentEvent.create(input),
);
`;
    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/billing.ts',
      true,
      'src/billing.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [Billing.PaymentEvent.create, Billing.verifyWebhook]',
    );
    expect(instrumented).toContain(
      '"Billing.verifyWebhook": Billing.verifyWebhook',
    );
    expect(instrumented).toContain('registrar: "app.http.webhook"');
    expect(instrumented).toContain('property: "authenticate"');
  });

  it('decorates an ordinary typed domain function before same-module authority and tool registration', () => {
    const source = `
const PublishInput = type({ postId: "string" });
const PublishOutput = type({ revision: "number" });

export async function publishPost(
  input: typeof PublishInput.infer,
): Promise<typeof PublishOutput.infer> {
  return Post.edit(input.postId, async post => {
    await post.update({ state: "published" });
    PostPublished.emit({ postId: post.id });
    return { revision: post.revision + 1 };
  });
}

Publisher.can(publishPost);
application.agent("publisher", {
  identity: PublisherIdentity,
  model: FastModel,
  instructions: "Publish approved posts.",
  tools: [publishPost],
}, runPublisher);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/publishing.ts',
      true,
      'src/publishing.ts',
    );

    const metadata = instrumented.indexOf(
      'Symbol.for("applik8s.generatedFunctionOperation")',
    );
    const authority = instrumented.indexOf('Publisher.can(publishPost)');
    expect(metadata).toBeGreaterThan(-1);
    expect(metadata).toBeLessThan(authority);
    expect(instrumented).toContain(
      'id: "applik8s://functions/src%2Fpublishing.ts%23publishPost/operations/invoke"',
    );
    expect(instrumented).toContain(
      'schemas: { input: PublishInput, output: PublishOutput }',
    );
    expect(instrumented).toContain(
      'identifier: "Post.edit", value: Post.edit',
    );
    expect(instrumented).toContain(
      'identifier: "PostPublished", value: PostPublished',
    );
  });

  it('derives collision-free operation identities from the exported module symbol', () => {
    const source = `
const Input = type({ id: "string" });
const Output = type({ id: "string" });
export async function publish(
  input: typeof Input.infer,
): Promise<typeof Output.infer> {
  return Model.edit(input.id, async value => ({ id: value.id }));
}
`;
    const posts = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/posts.ts',
      true,
      'src/posts.ts',
    );
    const comments = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/comments.ts',
      true,
      'src/comments.ts',
    );

    expect(posts).toContain(
      'applik8s://functions/src%2Fposts.ts%23publish/operations/invoke',
    );
    expect(comments).toContain(
      'applik8s://functions/src%2Fcomments.ts%23publish/operations/invoke',
    );
  });

  it('does not expose a private helper as a public function operation', () => {
    const source = `
const Input = type({ id: "string" });
const Output = type({ id: "string" });
async function publish(
  input: typeof Input.infer,
): Promise<typeof Output.infer> {
  return Model.edit(input.id, async value => ({ id: value.id }));
}
`;
    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/posts.ts',
      true,
      'src/posts.ts',
    );

    expect(instrumented).not.toContain(
      'applik8s.generatedFunctionOperation',
    );
    expect(instrumented).toContain(
      'applik8s.applicationCallbackDependencies',
    );
  });

  it('does not treat nested workspace packages as application-owned helper modules', () => {
    const rootEntrypoint = join(process.cwd(), 'application.ts');

    expect(applicationPackageOwnsModule(
      rootEntrypoint,
      join(process.cwd(), 'src', 'application-helper.ts'),
    )).toBe(true);
    expect(applicationPackageOwnsModule(
      rootEntrypoint,
      join(process.cwd(), 'packages', 'sdk', 'src', 'handler-dispatch.ts'),
    )).toBe(false);
  });

  it('instruments callback registrars from packed Applik8s packages before esbuild rewrites them', () => {
    expect(applicationCallbackModuleIsInstrumentable(
      '/tmp/consumer/node_modules/@applik8s/start-agentic/dist/profiles.js',
    )).toBe(true);
    expect(applicationCallbackModuleIsInstrumentable(
      String.raw`C:\consumer\node_modules\@applik8s\start-agentic\dist\profiles.js`,
    )).toBe(true);
    expect(applicationCallbackModuleIsInstrumentable(
      '/tmp/consumer/node_modules/unrelated-framework/dist/index.js',
    )).toBe(false);
    expect(applicationCallbackModuleIsInstrumentable(
      '/workspace/src/application.ts',
    )).toBe(true);
  });

  it('retains recursive helper metadata for maintained workspace and packed packages only', () => {
    const rootEntrypoint = join(process.cwd(), 'application.ts');

    expect(applicationCallbackModuleOwnsDependencies(
      rootEntrypoint,
      join(process.cwd(), 'packages', 'notifications', 'src', 'index.ts'),
    )).toBe(true);
    expect(applicationCallbackModuleOwnsDependencies(
      rootEntrypoint,
      '/tmp/consumer/node_modules/@applik8s/notifications/dist/index.js',
    )).toBe(true);
    expect(applicationCallbackModuleOwnsDependencies(
      rootEntrypoint,
      '/tmp/consumer/node_modules/unrelated-framework/dist/index.js',
    )).toBe(false);
    expect(applicationCallbackModuleOwnsDependencies(
      rootEntrypoint,
      join(process.cwd(), 'src', 'application-helper.ts'),
    )).toBe(true);
  });

  it('can defer maintained-package dependency reads until after module initialization', () => {
    const source = `
export function validate() {
  return transports.has('command');
}
const transports = new Set(['command']);
`;
    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/packages/core/src/authority.ts',
      true,
      'src/authority.ts',
      true,
    );

    expect(instrumented).toContain('get: () => [{ identifier: "transports.has"');
    expect(instrumented.indexOf('get: () =>')).toBeLessThan(
      instrumented.indexOf('const transports'),
    );
  });

  it('does not mistake mutable maintained-package runtime state for an application dependency', () => {
    const source = `
let cachedProvider: { deliver(input: unknown): Promise<unknown> } | undefined;
export async function deliver(input: unknown) {
  cachedProvider ??= createProvider();
  return cachedProvider.deliver(input);
}
const createProvider = () => Provider.create();
`;
    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/packages/notifications/src/runtime.ts',
      true,
      'src/runtime.ts',
      true,
    );

    expect(instrumented).not.toContain('identifier: "cachedProvider.deliver"');
    expect(instrumented).toContain('identifier: "Provider.create"');
  });

  it('preserves stream.process handler source without capturing the transpiler Symbol', () => {
    const source = `
const reconcileSchedule = async (_changed, context) => {
  await context.schedules.run.reconcile({ state: 'present' });
};

AutomationScheduleChanged.process('automation-schedule', {
  schedules: { run: ExecuteAutomationRun },
}, async (changed, context) => reconcileSchedule(changed, context));
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/streams/automation.ts');

    expect(instrumented).toContain('Symbol.for("applik8s.applicationCallbackSource")');
    expect(instrumented).toContain('registrar: "stream.process"');
    expect(instrumented).toContain('property: "handler"');
    expect(instrumented).toContain('source: "async (changed, context) => reconcileSchedule(changed, context)"');
  });

  it('preserves Stream.onEvent handler identity with and without options', () => {
    const source = `
Events.onEvent({ retry: { maxAttempts: 3 } }, async function publishEvent(event) {
  await publish(event);
});
function recordAudit() {}
Audit.onEvent(recordAudit);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/events.ts');

    expect(instrumented.match(/registrar: "stream.onEvent"/g)).toHaveLength(2);
    expect(instrumented.match(/property: "handler"/g)).toHaveLength(2);
    expect(instrumented).toContain('name: "publishEvent"');
    expect(instrumented).toContain('name: "recordAudit"');
  });

  it('instruments Stream.onBatch as one callback-native frozen batch handler', () => {
    const source = `
PostPublished.onBatch(
  {
    batch: { maxItems: 500, maxBytes: '4MiB', maxWait: '1s' },
    ordering: 'partition',
    concurrency: 8,
  },
  async function indexPosts(batch) {
    await BulkIndex({ posts: batch.events.map(event => event.value) });
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/indexing.ts',
    );

    expect(instrumented).toContain('registrar: "stream.onBatch"');
    expect(instrumented).toContain('name: "indexPosts"');
    expect(instrumented).toContain('__generatedCalls: [BulkIndex]');
  });

  it('captures a directly called workflow from Stream.onEvent options', () => {
    const source = `
Uploads.onEvent(
  { retry: { maxAttempts: 3 } },
  async function verifyUpload(upload) {
    await verifyMedia(upload);
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/media.ts');

    expect(instrumented).toContain('__generatedCalls: [verifyMedia]');
    expect(instrumented).not.toContain('workflows:');
  });

  it('captures function-native model transactions through ordinary helpers', () => {
    const source = `
async function publishPost(input) {
  return Post.edit(input.postId, async post => {
    const account = await Account.require(post.accountId);
    await post.update({ state: 'published', actor: account.identity });
    PostChanged.emit({ postId: post.id });
  });
}

PostRequested.onEvent(async function handlePostRequested(input) {
  return publishPost(input);
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/posts.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [Post.edit, Account.require, PostChanged]',
    );
    expect(instrumented).toContain(
      '__generatedBindings: { "Post.edit": Post.edit, "Account.require": Account.require, "PostChanged": PostChanged }',
    );
    expect(instrumented).not.toContain('__generatedCalls: [publishPost]');
  });

  it('captures helper call graphs from function-native Model.on.create handlers', () => {
    const source = `
async function beginAccessReview(created) {
  await reviewAccessRequest.start({
    requestId: created.value.id,
  }, { idempotencyKey: created.value.id });
}

AccessRequest.on.create(
  { processor: { replicas: 1, concurrency: 8 } },
  beginAccessReview,
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/access.ts',
    );

    expect(instrumented).toContain('registrar: "Model.on.create"');
    expect(instrumented).toContain('name: "beginAccessReview"');
    expect(instrumented).toContain('await reviewAccessRequest.start({');
    expect(instrumented).toContain('__generatedCalls: [reviewAccessRequest]');
    expect(instrumented).toContain(
      '__generatedBindings: { "reviewAccessRequest": reviewAccessRequest }',
    );
  });

  it('preserves app.agent handler provenance so module imports can be bundled', () => {
    const source = `
import { chat } from '@tanstack/ai';

export const Researcher = application.agent(
  'researcher',
  {
    identity: ResearcherIdentity,
    model: FastModel,
    instructions: 'Research carefully.',
    tools: [ResearchNote.create],
  },
  async (request, context) => chat({
    adapter: context.tanstack.adapter,
    messages: request.messages,
    threadId: request.threadId,
    runId: context.runId,
    tools: context.tanstack.tools,
    context: context.tanstack.execution,
  }),
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/features/research/model.ts',
    );

    expect(instrumented).toContain('registrar: "agent"');
    expect(instrumented).toContain('property: "handler"');
    expect(instrumented).toContain('source: "async (request, context) => chat({');
  });

  it('does not mistake direct child-workflow invocation metadata for a registration callback', () => {
    const source = `
app.workflow(Flow, {}, async (input, context) =>
  run(input, { idempotencyKey: context.invocationId }));
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/workflow.ts');

    expect(instrumented.match(/applik8s\.applicationCallbackSource/g)).toHaveLength(2);
    expect(instrumented).toContain('registrar: "workflow"');
    expect(instrumented).not.toContain('registrar: "run", property: "handler"');
    expect(instrumented).toContain('{ idempotencyKey: context.invocationId }');
  });

  it('captures direct child workflow handles without exposing an alias map', () => {
    const source = `
app.workflow(ModeratePost, {}, async (input) => {
  const score = await scorePost(input, { idempotencyKey: input.postId });
  return { ...input, score };
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/workflow.ts');

    expect(instrumented).toContain('__generatedCalls: [scorePost]');
    expect(instrumented).not.toContain('workflows:');
    expect(instrumented).not.toContain('context.child');
  });

  it('captures function-native workflow calls from the four-argument surface', () => {
    const source = `
workflow(
  'posts.moderate.v1',
  { input: ModerateInput, output: ModerateOutput },
  { retries: 3 },
  async (input) => {
    const score = await scorePost(input);
    return { ...input, score };
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/workflow.ts',
    );

    expect(instrumented).toContain('registrar: "workflow"');
    expect(instrumented).toContain('__generatedCalls: [scorePost]');
    expect(instrumented).toContain(
      '{ retries: 3, __generatedCalls: [scorePost], __generatedBindings: { "scorePost": scorePost } }',
    );
  });

  it('captures direct projection rebuild handles from function-native workflows', () => {
    const source = `
workflow(
  'timeline.rebuild.v1',
  { input: RebuildInput, output: RebuildOutput },
  { retries: 3 },
  async ({ generation }) => {
    const result = await HomeTimeline.rebuild({ generation });
    return { generation: result.generation };
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/workflow.ts',
    );

    expect(instrumented).toContain('__generatedCalls: [HomeTimeline]');
    expect(instrumented).not.toContain('projections:');
  });

  it('captures transaction-scoped model reads without an authored participant map', () => {
    const source = `
Automation.create.beforeCommit({ history: true }, async (_automation, input) => {
  const account = await Account.get(input.accountId);
  if (!account) throw new Error('missing');
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/automation.ts',
    );

    expect(instrumented).toContain('__generatedCalls: [Account]');
    expect(instrumented).toContain('__generatedModelBindings: { \"Account\": Account }');
    expect(instrumented).not.toContain('transaction:');
  });

  it('captures function-native events and commands as ambient transaction effects', () => {
    const source = `
Account.create.beforeCommit({ history: true }, async (account, input) => {
  AccountChanged.emit({
    accountId: account.id,
    displayName: input.displayName,
  });
  CreateCredentialLink({
    id: input.credentialId,
    accountId: account.id,
  });
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/accounts.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [AccountChanged, CreateCredentialLink]',
    );
    expect(instrumented).toContain(
      '__generatedModelBindings: { "AccountChanged": AccountChanged, "CreateCredentialLink": CreateCredentialLink }',
    );
    expect(instrumented).not.toContain('events:');
    expect(instrumented).not.toContain('transaction:');
  });

  it('captures model commands staged through the transaction context', () => {
    const source = `
Review.create.beforeCommit({ history: true }, async (review, _input, context) => {
  context.send(Document.update, {
    identity: review.value.documentId,
    patch: { state: 'in-review' },
  });
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/reviews.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [Document, Document.update]',
    );
    expect(instrumented).toContain(
      '__generatedModelBindings: { "Document": Document, "Document.update": Document.update }',
    );
  });

  it('preserves direct dependency inference through same-file named callbacks', () => {
    const source = `
async function createAccount(account, input) {
  AccountChanged.emit({ accountId: account.id });
  void CreateCredentialLink({ id: input.credentialId, accountId: account.id });
}

const updateAccount = async (account, input) => {
  const credential = await CredentialLink.get(input.credentialId);
  if (!credential) throw new Error('missing credential');
  AccountChanged.emit({ accountId: account.id });
};

Account.create.beforeCommit({ history: true }, createAccount);
Account.update.beforeCommit({ history: true }, updateAccount);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/accounts.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [AccountChanged, CreateCredentialLink]',
    );
    expect(instrumented).toContain(
      '__generatedModelBindings: { "AccountChanged": AccountChanged, "CreateCredentialLink": CreateCredentialLink }',
    );
    expect(instrumented).toContain(
      '__generatedCalls: [CredentialLink, AccountChanged]',
    );
  });

  it('recursively captures capability leaves through same-file helpers', () => {
    const source = `
function stageCredential(credentialId, accountId) {
  void CreateCredentialLink({ id: credentialId, accountId });
}

function publishAccount(account) {
  AccountChanged.emit({ accountId: account.id });
  stageCredential(account.credentialId, account.id);
}

Account.create.beforeCommit({ history: true }, async account => {
  publishAccount(account);
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/accounts.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [AccountChanged, CreateCredentialLink]',
    );
    expect(instrumented).not.toContain('__generatedCalls: [publishAccount]');
  });

  it('does not capture parameters of recursively analyzed helpers', () => {
    const source = `
function matchesContentType(contentType, expected) {
  return contentType.toLowerCase() === expected.toLowerCase();
}

workflow('media.verify.v1', Contract, async input => {
  const metadata = await Attachments.head(input.objectKey);
  if (!metadata || !matchesContentType(metadata.contentType, input.contentType)) {
    throw new Error('content type mismatch');
  }
  await Media.update({ identity: input.id, patch: { state: 'ready' } });
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/media.ts',
    );

    expect(instrumented).toContain('__generatedCalls: [Attachments, Media.update]');
    expect(instrumented).not.toContain('value: contentType.toLowerCase');
    expect(instrumented).not.toContain('value: expected.toLowerCase');
  });

  it('preserves typed delete operations while retaining opaque handle ownership', () => {
    const source = `
Post.on.create({}, async created => {
  await Note.delete({ identity: created.value.noteId });
  await Attachments.delete(created.value.objectKey);
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/lifecycle.ts',
    );

    expect(instrumented).toContain(
      '__generatedCalls: [Note, Note.delete, Attachments, Attachments.delete]',
    );
    expect(instrumented).toContain(
      '"Note.delete": Note.delete',
    );
    expect(instrumented).toContain(
      '"Attachments": Attachments',
    );
    expect(instrumented).toContain(
      'identifier: "Note.delete", value: Note.delete, awaited: true',
    );
    expect(instrumented).toContain(
      'identifier: "Attachments.delete", value: Attachments.delete, awaited: true',
    );
  });

  it('carries imported callback dependencies through module-owned metadata', async () => {
    const directory = new URL(
      './fixtures/recursive-application-callback/',
      import.meta.url,
    );
    const application = new URL('app.ts', directory).pathname;
    const handlers = new URL('handlers.ts', directory).pathname;
    const nested = new URL('nested.ts', directory).pathname;

    const instrumentedApplication = instrumentApplicationCallbackRegistrations(
      await readFile(application, 'utf8'),
      application,
    );
    const instrumentedHandlers = instrumentApplicationCallbackRegistrations(
      await readFile(handlers, 'utf8'),
      handlers,
    );
    const instrumentedNested = instrumentApplicationCallbackRegistrations(
      await readFile(nested, 'utf8'),
      nested,
    );

    expect(instrumentedApplication).toContain(
      '__generatedCalls: [createAccount]',
    );
    expect(instrumentedHandlers).toContain(
      '"applik8s.applicationCallbackDependencies"',
    );
    expect(instrumentedHandlers).toContain('value: AccountChanged');
    expect(instrumentedHandlers).toContain('value: stageCredential');
    expect(instrumentedNested).toContain('value: CreateCredentialLink');
  });

  it('never emits hoisted function-local helpers as module-scope metadata values', () => {
    const source = `
import { boundFetch } from './transport.js';
export function createTransport() {
  const request = boundFetch();
  return createMultiplexer(request);
}
function createMultiplexer(request) {
  run();
  function run() {
    request('/events');
    scheduleRestart();
  }
  function scheduleRestart() {
    queueMicrotask(run);
  }
  return { run };
}
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/transport.ts',
    );

    expect(instrumented).toContain('identifier: "boundFetch", value: boundFetch');
    expect(instrumented).not.toContain('identifier: "run", value: run');
    expect(instrumented).not.toContain(
      'identifier: "scheduleRestart", value: scheduleRestart',
    );
    expect(instrumented).not.toContain(
      'identifier: "queueMicrotask", value: queueMicrotask',
    );
  });

  it('captures guarded relational handles without evaluating their methods during discovery', () => {
    const source = `
const Database = application.database.postgres('catalog', options);
async function owned(input) {
  return Database.select({ id: Card.id }).from(Card);
}
Card.view(contract, owned);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/models.ts',
    );

    expect(instrumented).toContain('value: Database');
    expect(instrumented).not.toContain('value: Database.select');
  });

  it('fails closed when a named callback cannot be analyzed for direct dependencies', () => {
    const source = `
import { createAccount } from './handlers.js';
Account.create.beforeCommit({ history: true }, createAccount);
`;

    expect(() =>
      instrumentApplicationCallbackRegistrations(
        source,
        '/workspace/src/accounts.ts',
      )).toThrow(
      'cannot be analyzed for application dependencies',
    );
  });

  it('records awaited calls so command misuse can fail during application discovery', () => {
    const source = `
Account.create.beforeCommit({ history: true }, async (account, input) => {
  await Account.get(account.id);
  await CreateCredentialLink({ id: input.credentialId, accountId: account.id });
  void UpdateAccount({ identity: account.id, patch: { ready: true } });
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/accounts.ts',
    );

    expect(instrumented).toContain(
      '__generatedAwaitedCalls: { "Account": Account, "CreateCredentialLink": CreateCredentialLink }',
    );
  });

  it('records awaited direct model operations for named lifecycle callbacks', () => {
    const source = `
async function evaluateRun(created) {
  await Evaluations.EvaluationRun.update({
    identity: created.value.id,
    patch: { status: 'running' },
  });
  for (const result of created.value.results) {
    await Evaluations.EvaluationResult.create(result);
  }
}

Evaluations.EvaluationRun.on.create(
  { processor: { replicas: 1 } },
  evaluateRun,
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/evaluations.ts',
    );

    expect(instrumented).toContain(
      '__generatedAwaitedCalls: { "Evaluations.EvaluationRun.update": Evaluations.EvaluationRun.update, "Evaluations.EvaluationResult.create": Evaluations.EvaluationResult.create }',
    );
  });

  it('inserts compiler-owned options for an optionless workflow only when captures are required', () => {
    const source = `
workflow(
  'posts.moderate.v1',
  { input: ModerateInput, output: ModerateOutput },
  async input => scorePost(input),
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/workflow.ts',
    );

    expect(instrumented).toContain(
      '{ __generatedCalls: [scorePost], __generatedBindings: { "scorePost": scorePost } }, (__applik8sApplicationCallback',
    );
  });

  it('retains authored callback names when bundling would rename duplicate local functions', () => {
    const source = `
Post.view({
  run: async function viewerState() { return []; },
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/views.ts');

    expect(instrumented).toContain('name: "viewerState"');
  });

  it('captures workflow starts inside resource callbacks without treating job.track as a dependency', () => {
    const source = `
ImageJob.on.reconcile(async job => {
  const run = await ProcessImage.start(
    { source: job.spec.sourceUrl },
    { idempotencyKey: job.metadata.uid },
  );
  await job.track('process-image', run);
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(
      source,
      '/workspace/src/app.ts',
    );

    expect(instrumented).toContain(
      'identifier: "ProcessImage", value: ProcessImage, awaited: true',
    );
    expect(instrumented).toContain('registrar: "Resource.on.reconcile"');
    expect(instrumented).not.toContain('identifier: "job.track"');
  });

  it('instruments the function-native Model.view contract and implementation separately', () => {
    const source = `
Post.view(
  {
    input: TimelineInput,
    output: TimelineOutput,
    authorize: canReadTimeline,
  },
  async function timeline(input) {
    return Post.where(post => post.authorId.in(input.authorIds)).all();
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/views.ts');

    expect(instrumented).toContain('property: "authorize"');
    expect(instrumented).toContain('property: "run"');
    expect(instrumented).toContain('name: "timeline"');
    expect(instrumented).toContain('source: "async function timeline(input)');
  });

  it('instruments the function-native one-shot Model.query contract and implementation separately', () => {
    const source = `
Post.query(
  {
    input: TimelineInput,
    output: TimelineOutput,
    authorize: canReadTimeline,
  },
  async function timelineSnapshot(input) {
    return Post.where(post => post.authorId.in(input.authorIds)).all();
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/queries.ts');

    expect(instrumented).toContain('registrar: "query"');
    expect(instrumented).toContain('property: "authorize"');
    expect(instrumented).toContain('property: "run"');
    expect(instrumented).toContain('name: "timelineSnapshot"');
  });

  it('instruments function-native Kubernetes selection and projection callbacks separately', () => {
    const source = `
Policy.view(
  {
    input: CurrentPolicyInput,
    output: CurrentPolicyOutput,
    authorize: canReadPolicy,
    select: {
      namespace: policyNamespace,
      labelSelector: policyLabels,
      fieldSelector: currentPolicy,
      where: isReady,
      orderBy: newestPolicy,
      limit: onePolicy,
    },
  },
  function current(policy) {
    return policy.spec;
  },
);
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/policy.ts');

    expect(instrumented).toContain('property: "authorize"');
    expect(instrumented).toContain('property: "namespace"');
    expect(instrumented).toContain('property: "labelSelector"');
    expect(instrumented).toContain('property: "fieldSelector"');
    expect(instrumented).toContain('property: "where"');
    expect(instrumented).toContain('property: "orderBy"');
    expect(instrumented).toContain('property: "limit"');
    expect(instrumented).toContain('property: "kubernetes.project"');
    expect(instrumented).toContain('name: "current"');
  });

  it('retains authored Kubernetes view projection names', () => {
    const source = `
Policy.view({
  kubernetes: {
    project: function current({ value }) { return value.spec; },
  },
});
`;

    const instrumented = instrumentApplicationCallbackRegistrations(source, '/workspace/src/policy.ts');

    expect(instrumented).toContain('property: "project"');
    expect(instrumented).toContain('name: "current"');
  });

  it('records the defining module for an imported IdentityProvider callback', async () => {
    const application = new URL('./fixtures/callback-provenance/app.ts', import.meta.url).pathname;
    const identity = new URL('./fixtures/callback-provenance/identity.ts', import.meta.url).pathname;
    const instrumented = instrumentApplicationCallbackRegistrations(await readFile(application, 'utf8'), application);

    expect(instrumented).toContain(`file: ${JSON.stringify(identity)}`);
    expect(instrumented).toContain('registrar: "IdentityProvider"');
    expect(instrumented).toContain('property: "authenticate"');
  });

  it('preserves imported identity, OAuth, and authorization readiness callback provenance', () => {
    const source = `
import { authenticate, decide, identityReady, oauthReady, authorizationReady } from './identity';

IdentityProvider.from(authenticate, { ready: identityReady });
OAuthAuthorizationServer.from('primary', decide, { ready: oauthReady });
Authorization.from(decide, { ready: authorizationReady });
`;
    const sourceFile = '/workspace/src/app.ts';
    const instrumented = instrumentApplicationCallbackRegistrations(source, sourceFile);

    expect(instrumented).toContain('registrar: "IdentityProvider"');
    expect(instrumented).toContain('property: "ready"');
    expect(instrumented).toContain('registrar: "OAuthAuthorizationServer"');
    expect(instrumented).toContain('registrar: "Authorization"');
    expect(instrumented).toContain('property: "decide"');
    expect(instrumented.match(/property: "ready"/g)).toHaveLength(3);
  });
});
