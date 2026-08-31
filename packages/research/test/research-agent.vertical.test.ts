// typecast-file-boundary: research orchestration tests use focused provider, actor, AI, and operation doubles to prove boundary validation and recovery.
import { AI } from '@applik8s/ai';
import { asTool } from '@applik8s/ai-tanstack';
import {
  app,
  applicationGraphFor,
  createDeterministicApplicationActorRuntime,
  IdentityProvider,
  installApplicationAgentInvocationRuntimeResolver,
  installApplicationActorRuntimeResolver,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { createApplicationMutationOperation } from '@applik8s/client';
import { applicationAITextAdapter } from '@applik8s/runtime-ai';
import { memoryPersistence } from '@tanstack/ai-persistence';
import { LocalSourceRetriever, LocalWebSearch, SourceRetriever, WebSearch } from '@applik8s/web-search';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type {
  ApplicationTanStackToolExecutionContext,
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
} from '@applik8s/ai-tanstack';
import {
  LocalResearchEvidence,
  ResearchEvidence,
  researchAgent,
} from '../src/index.js';
import {
  executeApplicationResearchAgent,
  researchPublicationExecution,
} from '../src/agent-runtime.js';

describe('maintained researchAgent composition', () => {
  it('expands search, retrieval, evidence, model, identity, and publication authority into ordinary graph nodes', async () => {
    const application = app('research-agent-proof', {
      spec: type({ profile: "'starter' | 'external'" }),
      status: type({ ready: 'boolean' }),
    });
    application.provide(AI, AI.deterministic({ fixture: { response: 'fixture' } }));
    application.provide(IdentityProvider, IdentityProvider.deterministic({
      mode: 'starter',
      application: 'research-agent-proof',
      subject: 'researcher',
      audience: ['research-agent-proof'],
      catalogRevision: 'catalog-test',
      authorityRevision: 'authority-test',
    }));
    const reports = pgTable('research_reports', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const database = application.database.postgres('application', {
      schema: { reports },
      migrations: { path: './drizzle' },
    });
    const Report = application.model(reports, { name: 'ResearchReport', database, access: 'global' });
    const Search = WebSearch.named('research');
    const Retrieve = SourceRetriever.named('research');
    const Evidence = ResearchEvidence.named('research');
    application.profile(application.installation.spec, 'profile')
      .provide(Search)
      .starter(() => LocalWebSearch.deterministic())
      .external(() => LocalWebSearch.deterministic())
      .exhaustive();
    application.profile(application.installation.spec, 'profile')
      .provide(Retrieve)
      .starter(() => LocalSourceRetriever.deterministic({ sources: [] }))
      .external(() => LocalSourceRetriever.deterministic({ sources: [] }))
      .exhaustive();
    application.profile(application.installation.spec, 'profile')
      .provide(Evidence)
      .starter(() => LocalResearchEvidence.deterministic())
      .external(() => LocalResearchEvidence.deterministic())
      .exhaustive();
    const identity = application.serviceIdentity('market-researcher');
    const ResearchRequest = type({ threadId: 'string', question: 'string' });
    const ResearchReport = type({ body: 'string' });
    const Researcher = application.include(researchAgent('market-research.v1', {
      contract: { input: ResearchRequest, output: ResearchReport },
      actor: { key: type('string') },
      identity,
      model: AI.model('research', { capabilities: [AI.chat, AI.tools, AI.streaming] }),
      search: Search,
      retrieve: Retrieve,
      evidence: Evidence,
      publish: Report.create,
    }));
    identity.can(Report.create);

    expect(Researcher).toBeTypeOf('function');
    expect(Researcher.kind).toBe('applicationAgent');
    expect(Researcher.name).toBe('market-research.v1');
    expect(Researcher.specialization).toBe('research');
    expect(Researcher.capabilities).toEqual({
      search: Search.qualification.key,
      retrieve: Retrieve.qualification.key,
      evidence: Evidence.qualification.key,
    });
    const graph = applicationGraphFor(application.composition);
    const agent = graph?.nodes.find((node) => node.kind === 'aiAgent' && node.name === 'market-research.v1');
    expect(agent).toMatchObject({ kind: 'aiAgent' });
    expect(agent?.kind === 'aiAgent' ? agent.providerBindings : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: expect.objectContaining({ member: 'search' }),
          provider: expect.objectContaining({ nodeId: expect.stringContaining('web-search') }),
        }),
        expect.objectContaining({
          operation: expect.objectContaining({ member: 'retrieve' }),
          provider: expect.objectContaining({ nodeId: expect.stringContaining('source-retriever') }),
        }),
        expect.objectContaining({
          operation: expect.objectContaining({ member: 'commit' }),
          provider: expect.objectContaining({ nodeId: expect.stringContaining('research-evidence') }),
        }),
        expect.objectContaining({
          operation: expect.objectContaining({ member: 'linkArtifact' }),
          provider: expect.objectContaining({ nodeId: expect.stringContaining('research-evidence') }),
        }),
      ]),
    );

    const uninstallAgentRuntime = installApplicationAgentInvocationRuntimeResolver(
      () => ({
        async invoke<TInput extends object, TResult>(request: {
          readonly agent: string;
          readonly input: TInput;
          readonly key: string;
          readonly idempotencyKey?: string;
        }): Promise<TResult> {
          expect(request).toMatchObject({
            agent: 'market-research.v1',
            key: 'thread-1',
            input: { threadId: 'thread-1', question: 'What evidence exists?' },
          });
          return {
            status: 'completed',
            value: { body: 'Grounded report' },
            artifact: { id: 'report-1' },
            evidenceIds: ['evidence-1'],
          } as unknown as TResult;
        },
      }),
    );
    try {
      await expect(Researcher({
        threadId: 'thread-1',
        question: 'What evidence exists?',
      })).resolves.toEqual({
        status: 'completed',
        value: { body: 'Grounded report' },
        artifact: { id: 'report-1' },
        evidenceIds: ['evidence-1'],
      });
    } finally {
      uninstallAgentRuntime();
    }

    expect(Researcher.handler).toBeTypeOf('function');
    const previousProfile = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'starter';
    const actorRuntime = createDeterministicApplicationActorRuntime();
    const uninstallActorRuntime = installApplicationActorRuntimeResolver(
      () => actorRuntime,
    );
    try {
      const request = {
        threadId: 'thread-1',
        input: { threadId: 'thread-1', question: 'What evidence exists?' },
        messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', content: 'What evidence exists?' }] }],
      } as const;
      const context = {
        runId: 'run-1',
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        principal: { id: 'person:one', kind: 'human' } as never,
        admission: {} as never,
        trustedContext: {},
        signal: new AbortController().signal,
        tanstack: {} as never,
      } as const;
      const expected = {
        status: 'failed',
        evidenceIds: [],
        reason: expect.stringContaining('found no sources'),
      };
      await expect(Researcher.handler!(request as never, context as never)).resolves.toEqual(expected);
      // A retry for the same stable run reattaches to actor-owned terminal
      // state and does not need inference or provider execution again.
      await expect(Researcher.handler!(request as never, context as never)).resolves.toEqual(expected);
    } finally {
      uninstallActorRuntime();
      if (previousProfile === undefined) delete process.env.APPLIK8S_PROFILE_VARIANT;
      else process.env.APPLIK8S_PROFILE_VARIANT = previousProfile;
    }
  });

  it('rejects ambiguous unversioned identities and unbounded policies', () => {
    const options = {
      contract: {
        input: type({ threadId: 'string', question: 'string' }),
        output: type({ body: 'string' }),
      },
      actor: { key: type('string') },
      identity: { kind: 'applicationServiceIdentity' } as never,
      model: AI.model('research', { capabilities: [AI.chat] }),
      search: WebSearch.named('research'),
      retrieve: SourceRetriever.named('research'),
      evidence: ResearchEvidence.named('research'),
      publish: (() => undefined) as never,
    };
    expect(() => researchAgent('research' as never, options)).toThrow(/stable version/u);
    const module = researchAgent('research.v1', { ...options, query: { maximumSources: 100 } });
    const application = app('invalid-research-agent');
    expect(() => module(application as never)).toThrow(/maximumSources/u);
    const invalidSafeSearch = researchAgent('safe-search.v1', {
      ...options,
      query: { safeSearch: 'unsafe' as never },
    });
    expect(() => invalidSafeSearch(application as never)).toThrow(/safeSearch/u);
  });
});

describe('research publication evidence linkage', () => {
  const principal = { id: 'person:one', kind: 'human' } as unknown as ApplicationTanStackToolInvocation['principal'];
  const invocation: ApplicationTanStackToolInvocation = {
    principal,
    invocationId: 'invocation-1',
    attemptId: 'attempt-1',
    providerToolCallId: 'tool-call-1',
  };

  it('links committed evidence before returning a successful publication result', async () => {
    const events: string[] = [];
    const execution: ApplicationTanStackToolExecutionContext = {
      principal,
      invocationId: 'invocation-1',
      attemptId: 'attempt-1',
      async invoke<TInput, TOutput>() {
        events.push('publish');
        return { value: { id: 'artifact-1' } } as TOutput;
      },
    };
    const wrapped = researchPublicationExecution({
      execution,
      publicationOperationId: 'applik8s://models/ResearchReport/operations/create',
      principalScope: 'workspace:one',
      runId: 'run-1',
      evidenceIds: ['evidence-1', 'evidence-2'],
      async linkArtifact(input) {
        events.push('link');
        expect(input).toEqual({
          principalScope: 'workspace:one',
          runId: 'run-1',
          artifactId: 'artifact-1',
          evidenceIds: ['evidence-1', 'evidence-2'],
          claims: [{
            claim: 'Grounded report',
            evidenceIds: ['evidence-1', 'evidence-2'],
          }],
        });
        return {
          apiVersion: 'applik8s.researchArtifactEvidence/v1alpha1',
          id: 'link-1',
          ...input,
          linkedAt: '2026-08-31T00:00:00.000Z',
        };
      },
    });

    const result = await wrapped.invoke(
      toolOperation('applik8s://models/ResearchReport/operations/create'),
      { title: 'Grounded report' },
      invocation,
    );
    expect(result).toEqual({ value: { id: 'artifact-1' } });
    expect(events).toEqual(['publish', 'link']);
  });

  it('does not link supporting tools and fails closed for an unidentifiable publication', async () => {
    let links = 0;
    const execution: ApplicationTanStackToolExecutionContext = {
      principal,
      invocationId: 'invocation-1',
      attemptId: 'attempt-1',
      async invoke<TInput, TOutput>(
        operation: ApplicationTanStackToolOperation<TInput, TOutput>,
      ) {
        return (operation.operation.id.endsWith('/search')
          ? { values: [] }
          : { accepted: true }) as TOutput;
      },
    };
    const wrapped = researchPublicationExecution({
      execution,
      publicationOperationId: 'applik8s://models/ResearchReport/operations/create',
      principalScope: 'workspace:one',
      runId: 'run-1',
      evidenceIds: ['evidence-1'],
      async linkArtifact() {
        links += 1;
        throw new Error('must not be reached');
      },
    });

    await expect(wrapped.invoke(
      toolOperation('applik8s://models/ResearchReport/operations/search'),
      {},
      invocation,
    )).resolves.toEqual({ values: [] });
    await expect(wrapped.invoke(
      toolOperation('applik8s://models/ResearchReport/operations/create'),
      { body: 'report' },
      invocation,
    )).rejects.toMatchObject({ code: 'RESEARCH_EVIDENCE_INCOMPLETE' });
    expect(links).toBe(0);
  });

  it('does not report publication success when durable evidence linkage fails', async () => {
    const execution: ApplicationTanStackToolExecutionContext = {
      principal,
      invocationId: 'invocation-1',
      attemptId: 'attempt-1',
      async invoke<TInput, TOutput>() {
        return { id: 'artifact-1' } as TOutput;
      },
    };
    const wrapped = researchPublicationExecution({
      execution,
      publicationOperationId: 'publish',
      principalScope: 'workspace:one',
      runId: 'run-1',
      evidenceIds: ['evidence-1'],
      async linkArtifact() {
        throw new Error('evidence store unavailable');
      },
    });

    await expect(wrapped.invoke(
      toolOperation('publish'),
      { body: 'report' },
      invocation,
    )).rejects.toThrow('evidence store unavailable');
  });
});

describe('actor-backed research execution', () => {
  it('reattaches after a lost checkpoint response and returns one typed completed terminal', async () => {
    const Publish = createApplicationMutationOperation<
      { readonly body: string },
      { readonly id: string }
    >({
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: 'applik8s://models/ResearchReport/operations/create',
      model: 'ResearchReport',
      name: 'create',
      operation: 'create',
      transport: 'command',
    }, undefined, {
      input: type({ body: 'string' }),
      output: type({ id: 'string' }),
    });
    const search = LocalWebSearch.deterministic({ results: [{
      title: 'Primary evidence',
      url: 'https://evidence.example.test/report',
      snippet: 'A bounded rollout reduced failures.',
      source: 'Evidence Lab',
    }] });
    const retrieve = LocalSourceRetriever.deterministic({ sources: [{
      requestedUrl: 'https://evidence.example.test/report',
      canonicalUrl: 'https://evidence.example.test/report',
      mediaType: 'text/plain',
      text: 'A bounded rollout reduced failures in the observed cohort.',
      contentDigest: `sha256:${'a'.repeat(64)}`,
      sizeBytes: 58,
      retrievedAt: '2026-08-31T00:00:00.000Z',
      provider: 'fixture',
      receipt: {
        retrievalId: 'research-run-1:source:1',
        idempotencyKey: 'research-run-1:source:1',
        redirects: [],
        networkPolicy: 'fixture',
        contentPolicy: 'text-only',
      },
    }] });
    const evidence = LocalResearchEvidence.deterministic();
    const settled: object[] = [];
    const checkpoints: { readonly phase: string; readonly progress: object }[] = [];
    let loseFirstSearchCheckpointResponse = true;
    const execute = () => executeApplicationResearchAgent(
      {
        threadId: 'research-thread-1',
        input: { threadId: 'research-thread-1', question: 'What rollout evidence exists?' },
        messages: [],
      },
      {
        runId: 'research-run-1',
        invocationId: 'research-invocation-1',
        attemptId: 'research-attempt-1',
        principal: { id: 'person:one', kind: 'human' } as never,
        admission: {} as never,
        trustedContext: { workspaceId: 'workspace:one' },
        signal: new AbortController().signal,
        tanstack: {
          adapter: applicationAITextAdapter({
            kind: 'deterministic',
            response: 'Grounded synthesis complete.',
            structuredResponse: { body: 'Bounded rollout evidence is favorable.' },
            tool: { input: { body: 'Bounded rollout evidence is favorable.' } },
          }),
          tools: [asTool(Publish)],
          persistence: memoryPersistence(),
          execution: {
            principal: { id: 'person:one', kind: 'human' } as never,
            invocationId: 'research-invocation-1',
            attemptId: 'research-attempt-1',
            async invoke() { return { id: 'artifact-1' } as never; },
          },
        },
      },
      {
        name: 'market-research.v1',
        query: {
          maximumResults: 8,
          maximumSources: 4,
          maximumConcurrency: 2,
          timeoutMs: 5_000,
          safeSearch: 'moderate',
        },
        context: {
          maximumCharacters: 100_000,
          maximumCharactersPerSource: 25_000,
          snapshotPolicy: 'digest-only',
        },
        publicationOperationId: Publish.operation.id,
      },
      {
        searchSources: search.search,
        retrieveSource: retrieve.retrieve,
        commitEvidence: evidence.commit,
        linkArtifact: evidence.linkArtifact,
        async beginResearchRun() { return { state: 'execute' }; },
        async checkpointResearchRun(_key, input) {
          checkpoints.push({ phase: input.phase, progress: input.progress });
          if (input.phase === 'searched' && loseFirstSearchCheckpointResponse) {
            loseFirstSearchCheckpointResponse = false;
            throw new Error('checkpoint response lost after commit');
          }
          return { committed: true };
        },
        async settleResearchRun(_key, input) {
          settled.push(input.terminal);
          return { committed: true };
        },
        outputSchema: {
          type: 'object',
          properties: { body: { type: 'string' } },
          required: ['body'],
          additionalProperties: false,
        },
      },
    );

    await expect(execute()).rejects.toThrow('checkpoint response lost after commit');
    expect(settled).toEqual([]);
    const result = await execute();
    expect(result).toEqual({
      status: 'completed',
      value: { body: 'Bounded rollout evidence is favorable.' },
      artifact: { id: 'artifact-1' },
      evidenceIds: [expect.stringMatching(/^evidence_/)],
    });
    expect(settled).toEqual([result]);
    expect(checkpoints.map(({ phase }) => phase)).toEqual([
      'searched',
      'searched',
      'evidence-committed',
      'synthesizing',
    ]);
    await expect(evidence.list({ principalScope: 'workspaceId:workspace:one', runId: 'research-run-1' }))
      .resolves.toMatchObject({ values: [expect.objectContaining({ id: expect.any(String) })] });
  });
});

function toolOperation<TInput = unknown, TOutput = unknown>(
  id: string,
): ApplicationTanStackToolOperation<TInput, TOutput> {
  return Object.assign(
    async () => undefined,
    { operation: { id } },
  ) as ApplicationTanStackToolOperation<TInput, TOutput>;
}
