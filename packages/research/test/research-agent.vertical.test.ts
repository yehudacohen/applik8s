import { AI } from '@applik8s/ai';
import { app, applicationGraphFor, IdentityProvider } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { LocalSourceRetriever, LocalWebSearch, SourceRetriever, WebSearch } from '@applik8s/web-search';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  ApplicationResearchAgentError,
  LocalResearchEvidence,
  ResearchEvidence,
  researchAgent,
} from '../src/index.js';

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
      tools: [Report.create],
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
      tools: [(() => undefined) as never],
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
