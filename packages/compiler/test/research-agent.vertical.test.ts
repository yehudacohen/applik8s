// typecast-file-boundary: the external fixture proves maintained research composition lowering through public package boundaries.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emitGeneratedApplicationAgents } from '../src/application-agents/index.js';
import {
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../src/application-operations/index.js';
import { discoverApplicationGraphWithExports } from '../src/pipeline/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('maintained researchAgent compiler integration', () => {
  it('hydrates package-owned search, retrieval, and evidence operations without replaying authoring setup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-research-agent-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'migrations'));
    await writeFile(join(directory, 'migrations', '0000_agent.sql'), '-- fixture\n');
    const entrypoint = join(directory, 'entrypoint.ts');
    await writeFile(entrypoint, `
import { AI } from '@applik8s/ai';
import { app, IdentityProvider } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { conversations } from '@applik8s/conversations';
import { LocalResearchEvidence, ResearchEvidence, researchAgent } from '@applik8s/research';
import { LocalSourceRetriever, LocalWebSearch, SourceRetriever, WebSearch } from '@applik8s/web-search';
import { pgTable, text } from 'drizzle-orm/pg-core';

const application = app('research-compiler-proof', {
  namespace: 'research-system',
  spec: type({ profile: "'starter' | 'external'" }),
  status: type({ ready: 'boolean' }),
});
application.provide(AI, AI.deterministic({ fixture: { response: 'fixture' } }));
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter', application: 'research-compiler-proof', subject: 'member',
  audience: ['research-compiler-proof'], catalogRevision: 'catalog-test', authorityRevision: 'authority-test',
}));
const reports = pgTable('research_reports', { id: text('id').primaryKey(), body: text('body').notNull() });
const database = application.database.postgres('application', {
  schema: { reports }, migrations: { path: './migrations' },
});
application.include(conversations);
const Report = application.model(reports, { name: 'ResearchReport', database, access: 'global' });
const Search = WebSearch.named('research');
const Retrieve = SourceRetriever.named('research');
const Evidence = ResearchEvidence.named('research');
application.profile(application.installation.spec, 'profile').provide(Search)
  .starter(() => LocalWebSearch.deterministic()).external(() => LocalWebSearch.deterministic()).exhaustive();
application.profile(application.installation.spec, 'profile').provide(Retrieve)
  .starter(() => LocalSourceRetriever.deterministic({ sources: [] }))
  .external(() => LocalSourceRetriever.deterministic({ sources: [] })).exhaustive();
application.profile(application.installation.spec, 'profile').provide(Evidence)
  .starter(() => LocalResearchEvidence.deterministic()).external(() => LocalResearchEvidence.deterministic()).exhaustive();
const identity = application.serviceIdentity('researcher');
identity.can(Report.create);
export const Researcher = application.include(researchAgent('market-research.v1', {
  identity,
  model: AI.model('research', { capabilities: [AI.chat, AI.tools, AI.streaming] }),
  search: Search,
  retrieve: Retrieve,
  evidence: Evidence,
  tools: [Report.create],
}));
export const researchStack = application.composition;
`);
    const discovered = await discoverApplicationGraphWithExports(entrypoint, 'researchStack');
    expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
    if (!discovered.ok) return;
    const agent = discovered.value.graph.nodes.find((node) => node.kind === 'aiAgent');
    expect(agent?.kind === 'aiAgent' ? agent.providerBindings : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: expect.objectContaining({ member: 'search' }) }),
        expect.objectContaining({ operation: expect.objectContaining({ member: 'retrieve' }) }),
        expect.objectContaining({ operation: expect.objectContaining({ member: 'commit' }) }),
      ]),
    );
    const catalog = compileApplicationOperationCatalog(discovered.value.graph);
    const authority = compileApplicationWorkloadAuthority(discovered.value.graph, catalog);
    const output = join(directory, 'generated');
    const [artifact] = await emitGeneratedApplicationAgents({
      graph: discovered.value.graph,
      operationCatalog: catalog,
      workloadAuthority: authority,
      outDir: output,
      entrypoint,
    });
    if (!artifact) throw new Error('Expected one generated research agent.');
    const handler = await readFile(join(dirname(artifact.sourcePath), 'handler.generated.ts'), 'utf8');
    const runtime = await readFile(join(dirname(artifact.sourcePath), 'agent.generated.ts'), 'utf8');
    expect(handler).toContain("@applik8s/research/agent-runtime");
    expect(handler).toContain('searchSources');
    expect(handler).toContain('retrieveSource');
    expect(handler).toContain('commitEvidence');
    expect(handler).not.toContain('application.inject');
    expect(runtime).toContain("@applik8s/web-search/runtime");
    expect(runtime).toContain("@applik8s/web-search/source-runtime");
    expect(runtime).toContain("@applik8s/research/runtime");
  }, 60_000);
});
