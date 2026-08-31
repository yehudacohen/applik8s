import { AI } from '@applik8s/ai';
import { app, applicationGraphFor, IdentityProvider } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { LocalSourceRetriever, LocalWebSearch, SourceRetriever, WebSearch } from '@applik8s/web-search';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type {
  ApplicationTanStackToolExecutionContext,
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
} from '@applik8s/ai-tanstack';
import {
  ApplicationResearchAgentError,
  LocalResearchEvidence,
  ResearchEvidence,
  researchAgent,
} from '../src/index.js';
import { researchPublicationExecution } from '../src/agent-runtime.js';

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
    const Researcher = application.include(researchAgent('market-research.v1', {
      identity,
      model: AI.model('research', { capabilities: [AI.chat, AI.tools, AI.streaming] }),
      search: Search,
      retrieve: Retrieve,
      evidence: Evidence,
      publish: Report.create,
    }));
    identity.can(Report.create);

    expect(Researcher).toMatchObject({
      kind: 'applicationAgent',
      name: 'market-research.v1',
      specialization: 'research',
      capabilities: {
        search: Search.qualification.key,
        retrieve: Retrieve.qualification.key,
        evidence: Evidence.qualification.key,
      },
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

    expect(Researcher.handler).toBeTypeOf('function');
    const previousProfile = process.env.APPLIK8S_PROFILE_VARIANT;
    process.env.APPLIK8S_PROFILE_VARIANT = 'starter';
    try {
      await expect(Researcher.handler!({
        threadId: 'thread-1',
        messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', content: 'What evidence exists?' }] }],
      }, {
        runId: 'run-1',
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        principal: { id: 'person:one', kind: 'human' } as never,
        admission: {} as never,
        trustedContext: {},
        signal: new AbortController().signal,
        tanstack: {} as never,
      })).rejects.toBeInstanceOf(ApplicationResearchAgentError);
    } finally {
      if (previousProfile === undefined) delete process.env.APPLIK8S_PROFILE_VARIANT;
      else process.env.APPLIK8S_PROFILE_VARIANT = previousProfile;
    }
  });

  it('rejects ambiguous unversioned identities and unbounded policies', () => {
    const options = {
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

function toolOperation<TInput = unknown, TOutput = unknown>(
  id: string,
): ApplicationTanStackToolOperation<TInput, TOutput> {
  return Object.assign(
    async () => undefined,
    { operation: { id } },
  ) as ApplicationTanStackToolOperation<TInput, TOutput>;
}
