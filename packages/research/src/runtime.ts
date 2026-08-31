import type {
  ApplicationResearchArtifactLink,
  ApplicationResearchArtifactLinkInput,
  ApplicationResearchEvidenceCommit,
  ApplicationResearchEvidenceListInput,
  ApplicationResearchEvidencePage,
  ApplicationResearchEvidenceProvider,
  ApplicationResearchEvidenceRecord,
} from './contracts.js';
import postgres from 'postgres';
import { createDeterministicResearchEvidenceProvider } from './memory.js';
import { createPostgresResearchEvidenceProvider } from './postgres.js';

let provider: ApplicationResearchEvidenceProvider | undefined;
let configuration: string | undefined;

export async function commitResearchEvidence(
  input: ApplicationResearchEvidenceCommit,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationResearchEvidenceRecord> {
  return evidenceProvider(environment).commit(input);
}

export async function listResearchEvidence(
  input: ApplicationResearchEvidenceListInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationResearchEvidencePage> {
  return evidenceProvider(environment).list(input);
}

export async function linkResearchArtifactEvidence(
  input: ApplicationResearchArtifactLinkInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationResearchArtifactLink> {
  return evidenceProvider(environment).linkArtifact(input);
}

function evidenceProvider(
  environment: Readonly<Record<string, string | undefined>>,
): ApplicationResearchEvidenceProvider {
  const kind = environment.APPLIK8S_RESEARCH_EVIDENCE_KIND ?? 'memory';
  const connectionEnvName = environment.APPLIK8S_RESEARCH_EVIDENCE_CONNECTION_ENV ?? 'DATABASE_URL';
  const schema = environment.APPLIK8S_RESEARCH_EVIDENCE_SCHEMA ?? 'public';
  const nextConfiguration = `${kind}\0${connectionEnvName}\0${schema}`;
  if (environment !== process.env) {
    return create(kind, connectionEnvName, schema, environment);
  }
  if (!provider || configuration !== nextConfiguration) {
    configuration = nextConfiguration;
    provider = create(kind, connectionEnvName, schema, environment);
  }
  return provider;
}

function create(
  kind: string,
  connectionEnvName: string,
  schema: string,
  environment: Readonly<Record<string, string | undefined>>,
): ApplicationResearchEvidenceProvider {
  if (kind === 'memory') return createDeterministicResearchEvidenceProvider();
  if (kind !== 'postgres') throw new Error(`ResearchEvidence runtime kind ${JSON.stringify(kind)} is unsupported.`);
  const value = environment[connectionEnvName];
  if (!value?.trim()) throw new Error(`ResearchEvidence PostgreSQL runtime requires ${connectionEnvName}.`);
  return createPostgresResearchEvidenceProvider({
    connectionEnvName,
    schema,
    sql: postgres(value, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false }),
  });
}
