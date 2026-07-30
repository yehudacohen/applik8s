import { execFile } from 'node:child_process';
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { applicationAgenticStartDefinition } from './definition.js';

const execFileAsync = promisify(execFile);

export interface ApplicationStartCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

export interface CreateApplicationAgenticStartOptions {
  readonly targetDirectory: string;
  readonly projectName?: string;
  readonly applik8sVersion?: string;
  readonly install?: boolean;
  readonly run?: (command: ApplicationStartCommand) => Promise<void>;
}

export interface CreatedApplicationAgenticStart {
  readonly targetDirectory: string;
  readonly projectName: string;
  readonly files: readonly string[];
  readonly upstream: {
    readonly package: '@tanstack/cli';
    readonly version: string;
  };
}

export async function createApplicationAgenticStart(
  options: CreateApplicationAgenticStartOptions,
): Promise<CreatedApplicationAgenticStart> {
  const targetDirectory = resolve(options.targetDirectory);
  const projectName = normalizedProjectName(
    options.projectName ?? basename(targetDirectory),
  );
  const parent = dirname(targetDirectory);
  const run = options.run ?? runCommand;
  const upstream = applicationAgenticStartDefinition.generator.upstream;
  await run({
    executable: 'bunx',
    arguments: [
      `${upstream.package}@${upstream.version}`,
      'create',
      projectName,
      '--target-dir',
      targetDirectory,
      '--blank',
      '--package-manager',
      'bun',
      '--no-git',
      '--no-install',
      '-y',
    ],
    cwd: parent,
  });
  await assertOfficialScaffold(targetDirectory);
  const packageVersion = options.applik8sVersion ?? '^0.7.0';
  const files = agenticStartFiles(projectName);
  for (const [path, source] of Object.entries(files)) {
    const output = resolve(targetDirectory, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, source);
  }
  await updateGeneratedPackage(targetDirectory, projectName, packageVersion);
  if (options.install !== false) {
    await run({
      executable: 'bun',
      arguments: ['install'],
      cwd: targetDirectory,
    });
    await run({
      executable: 'bun',
      arguments: ['run', 'db:generate'],
      cwd: targetDirectory,
    });
    await run({
      executable: 'bun',
      arguments: ['run', 'generate-routes'],
      cwd: targetDirectory,
    });
  }
  return {
    targetDirectory,
    projectName,
    files: Object.keys(files),
    upstream: {
      package: upstream.package,
      version: upstream.version,
    },
  };
}

async function runCommand(command: ApplicationStartCommand): Promise<void> {
  await execFileAsync(command.executable, [...command.arguments], {
    cwd: command.cwd,
    env: {
      ...process.env,
      CI: process.env.CI ?? '1',
      DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? '1',
    },
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function assertOfficialScaffold(targetDirectory: string): Promise<void> {
  const packagePath = resolve(targetDirectory, 'package.json');
  const routePath = resolve(targetDirectory, 'src/routes/index.tsx');
  try {
    await Promise.all([stat(packagePath), stat(routePath)]);
  } catch {
    throw new Error(
      'The pinned official TanStack CLI did not produce the expected Start file-router scaffold.',
    );
  }
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  if (!packageJson.dependencies?.['@tanstack/react-start']) {
    throw new Error(
      'The upstream scaffold is not a TanStack Start application.',
    );
  }
}

async function updateGeneratedPackage(
  targetDirectory: string,
  projectName: string,
  version: string,
): Promise<void> {
  const packagePath = resolve(targetDirectory, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    applik8s?: Record<string, string>;
  };
  manifest.name = projectName;
  manifest.scripts = {
    ...manifest.scripts,
    'db:generate': 'drizzle-kit generate',
    plan: 'applik8s plan',
    deploy: 'applik8s deploy',
    status: 'applik8s status',
    destroy: 'applik8s destroy',
  };
  manifest.applik8s = {
    entrypoint: 'src/application.ts',
    compositionName: 'application',
    instance: 'kubernetes/application.yaml',
    outDir: '.applik8s/deploy',
  };
  manifest.dependencies = {
    ...manifest.dependencies,
    '@tanstack/react-router':
      applicationAgenticStartDefinition.compatibility.tanstackStart,
    '@tanstack/react-start':
      applicationAgenticStartDefinition.compatibility.tanstackStart,
    '@applik8s/ai': version,
    '@applik8s/ai-tanstack': version,
    '@applik8s/applik8s': version,
    '@applik8s/approvals': version,
    '@applik8s/artifacts': version,
    '@applik8s/conversations': version,
    '@applik8s/evals': version,
    '@applik8s/operations-ui': version,
    '@applik8s/react': version,
    '@applik8s/start-agentic': version,
    '@applik8s/tanstack-start': version,
    '@applik8s/usage': version,
    '@tanstack/ai': '0.42.0',
    '@tanstack/ai-react':
      applicationAgenticStartDefinition.compatibility.tanstackAIReact,
    arktype: '^2.1.20',
    'drizzle-orm': '^0.45.1',
  };
  manifest.devDependencies = {
    ...manifest.devDependencies,
    '@tanstack/router-cli':
      applicationAgenticStartDefinition.compatibility.tanstackStart,
    '@applik8s/cli': version,
    'drizzle-kit': '0.31.10',
  };
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function normalizedProjectName(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9-]/gu, '-');
  if (!/^[a-z][a-z0-9-]*$/u.test(normalized)) {
    throw new Error(
      `Agentic Start project name ${JSON.stringify(value)} must contain a lower-case package name.`,
    );
  }
  return normalized;
}

function agenticStartFiles(
  projectName: string,
): Readonly<Record<string, string>> {
  return {
    'src/installation.ts': `import { type } from 'arktype';

export const Installation = type({
  name: 'string',
  profile: "'starter' | 'dedicated' | 'external'",
});

export const InstallationStatus = type({
  ready: 'boolean',
});
`,
    'src/app.ts': `import { app } from '@applik8s/applik8s';
import { Installation, InstallationStatus } from './installation';

export const application = app(${JSON.stringify(projectName)}, {
  namespace: applicationNamespace(${JSON.stringify(projectName)}),
  spec: Installation,
  status: InstallationStatus,
});

function applicationNamespace(name: string): string {
  return name + '-system';
}
`,
    'src/features/research/schema.ts': `import { text, timestamp, pgTable } from 'drizzle-orm/pg-core';

export const researchNotes = pgTable('research_notes', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
`,
    'src/database-schema.ts': `export * from '@applik8s/approvals';
export * from '@applik8s/artifacts';
export * from '@applik8s/conversations';
export * from '@applik8s/evals';
export * from '@applik8s/usage';
export { researchNotes } from './features/research/schema';
`,
    'src/providers.ts': `import { AI } from '@applik8s/ai';
import { IdentityProvider, TransactionalDatabase } from '@applik8s/applik8s';
import { applicationAgenticModuleSchema } from '@applik8s/start-agentic';
import { application } from './app';
import { researchNotes } from './features/research/schema';

const deployment = application.profile(application.installation.spec, 'profile');
const PrimaryDatabase = TransactionalDatabase.named('primary');
const Inference = AI.named('inference');

deployment
  .provide(PrimaryDatabase)
  .starter(() => TransactionalDatabase.postgres({
    clusterName: 'application-db',
    connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'application-db-app' },
    database: 'application',
    instances: 1,
  }))
  .dedicated(() => TransactionalDatabase.postgres({
    clusterName: 'application-db',
    connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'application-db-app' },
    database: 'application',
    instances: 3,
  }))
  .external(() => TransactionalDatabase.postgres({
    clusterName: 'application-db',
    connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'application-db-app' },
    database: 'application',
    provision: false,
    cluster: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'application-db', namespace: 'data' },
  }))
  .exhaustive();

deployment
  .provide(Inference)
  .starter(() => AI.deterministic({ fixture: { response: 'Ready for research.' } }))
  .dedicated(() => AI.deterministic({ fixture: { response: 'Configure the reviewed Envoy profile before production.' } }))
  .external(() => AI.deterministic({ fixture: { response: 'Configure an external inference provider before production.' } }))
  .exhaustive();

export const database = application.database.bind('application', {
  provider: application.inject(PrimaryDatabase),
  schema: { ...applicationAgenticModuleSchema, researchNotes },
  migrations: { path: '../drizzle' },
});
export const inference = application.inject(Inference);
application.provide(
  IdentityProvider,
  IdentityProvider.deterministic({
    mode: 'starter',
    application: ${JSON.stringify(projectName)},
    subject: 'local-developer',
    audience: [${JSON.stringify(projectName)}],
    catalogRevision: 'starter-catalog-v1',
    authorityRevision: 'starter-authority-v1',
  }),
);
`,
    'src/modules.ts': `import { approvals } from '@applik8s/approvals';
import { artifacts } from '@applik8s/artifacts';
import { conversations } from '@applik8s/conversations';
import { evaluations } from '@applik8s/evals';
import { operationsControlCenter } from '@applik8s/operations-ui';
import { usage } from '@applik8s/usage';
import { application } from './app';
import { database } from './providers';

const processor = {
  group: 'agentic-commands',
  deployment: {
    replicas: 1,
    concurrency: 8,
    maxInFlight: 8,
  },
} as const;

export const Conversations = conversations(application, { database, processor });
export const Approvals = approvals(application, { database, processor });
export const Artifacts = artifacts(application, { database, processor });
export const Evaluations = evaluations(application, { database, processor });
export const Usage = usage(application, { database, processor });
export const Operations = operationsControlCenter(application, {
  database,
  models: {
    Conversation: Conversations.Conversation,
    ProtocolRun: Conversations.ProtocolRun,
    ApprovalReview: Approvals.ApprovalReview,
    Artifact: Artifacts.Artifact,
    EvaluationRun: Evaluations.EvaluationRun,
    UsageFact: Usage.UsageFact,
  },
});

const maintainedModels = [
  ...Object.values(Conversations),
  ...Object.values(Approvals),
  ...Object.values(Artifacts),
  ...Object.values(Evaluations),
  ...Object.values(Usage),
] as const;

export const maintainedCommands = maintainedModels.flatMap((model) => [
  model.create,
  model.update,
  model.delete,
]);
`,
    'src/features/research/model.ts': `import { AI } from '@applik8s/ai';
import { chat } from '@tanstack/ai';
import { application } from '../../app';
import { database, inference } from '../../providers';
import { researchNotes } from './schema';

export const ResearchNote = application.model(researchNotes, {
  name: 'ResearchNote',
  database,
  processor: {
    group: 'agentic-commands',
    deployment: {
      replicas: 1,
      concurrency: 8,
      maxInFlight: 8,
    },
  },
  revision: false,
});

export const ResearcherIdentity = application.serviceIdentity('researcher');
export const FastModel = AI.model('fast', {
  inference,
  capabilities: [AI.chat, AI.tools, AI.streaming],
});

export const Researcher = application.agent(
  'researcher',
  {
    identity: ResearcherIdentity,
    model: FastModel,
    instructions: 'Help the user organize research notes with explicit evidence.',
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

ResearcherIdentity.can(ResearchNote.create);
`,
    'src/application.ts': `import { ApplicationHost } from '@applik8s/applik8s';
import { application } from './app';
import { ResearchNote } from './features/research/model';
import { maintainedCommands, Operations } from './modules';

export const gateway = application.gateway('web', {
  commands: [
    ResearchNote.create,
    ResearchNote.update,
    ResearchNote.delete,
    ...maintainedCommands,
  ],
  queries: [Operations.snapshot],
  authorizeCommand: ({ principal }) => principal.id.length > 0,
  deployment: {
    namespace: ${JSON.stringify(`${projectName}-system`)},
    cursorSecret: { name: ${JSON.stringify(`${projectName}-gateway-cursor`)}, key: 'key' },
  },
});

export const host = application.provide(
  ApplicationHost,
  ApplicationHost.kubernetes({
    name: ${JSON.stringify(`${projectName}-app`)},
    namespace: ${JSON.stringify(`${projectName}-system`)},
    replicas: 1,
    resources: {
      requests: { cpu: '100m', memory: '192Mi' },
      limits: { memory: '512Mi' },
    },
  }),
);

export { application };
`,
    'src/features/research/view.tsx': `import { createApplicationTanStackConnection } from '@applik8s/ai-tanstack/client';
import { useChat } from '@tanstack/ai-react';
import { type FormEvent, useId, useMemo, useState } from 'react';

export function ResearchHome() {
  const reactId = useId();
  const threadId = 'research-' + reactId.replaceAll(':', '');
  const connection = useMemo(
    () => createApplicationTanStackConnection({
      forwardedProps: { agent: 'researcher' },
    }),
    [],
  );
  const { messages, sendMessage, isLoading, error, stop } = useChat({
    connection,
    threadId,
  });
  const [draft, setDraft] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setDraft('');
    await sendMessage(message);
  }

  return (
    <main>
      <p className="eyebrow">Applik8s Agentic Start</p>
      <h1>Research workspace</h1>
      <p>
        One typed application graph now owns conversations, agents, tools,
        workflows, reviews, artifacts, evaluations, usage, and deployment.
      </p>
      <section aria-label="Research conversation">
        {messages.map((message) => (
          <article key={message.id} data-role={message.role}>
            <strong>{message.role}</strong>
            {message.parts.map((part, index) =>
              part.type === 'text'
                ? <p key={index}>{part.content}</p>
                : null,
            )}
          </article>
        ))}
        {error ? <p role="alert">{error.message}</p> : null}
      </section>
      <form onSubmit={submit}>
        <label htmlFor="research-prompt">Research prompt</label>
        <textarea
          id="research-prompt"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !draft.trim()}>
          {isLoading ? 'Researching…' : 'Send'}
        </button>
        {isLoading ? <button type="button" onClick={stop}>Stop</button> : null}
      </form>
    </main>
  );
}
`,
    'src/routes/index.tsx': `import { createFileRoute } from '@tanstack/react-router';
import { ResearchHome } from '../features/research/view';

export const Route = createFileRoute('/')({
  component: ResearchHome,
});
`,
    'src/routes/operations.tsx': `import { ApplicationOperationsControlCenter } from '@applik8s/operations-ui/react';
import { createFileRoute } from '@tanstack/react-router';
import { Operations } from '../modules';

export const Route = createFileRoute('/operations')({
  component: () => (
    <ApplicationOperationsControlCenter
      snapshot={Operations.snapshot}
      title=${JSON.stringify(`${projectName} operations`)}
    />
  ),
});
`,
    'vite.config.ts': `import { applik8sStart } from '@applik8s/tanstack-start/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  oxc: { jsx: { development: false } },
  plugins: [
    tanstackStart(),
    applik8sStart({ application: './src/application.ts' }),
    react(),
  ],
});
`,
    'drizzle.config.ts': `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database-schema.ts',
  out: './drizzle',
});
`,
    'kubernetes/application.yaml': `apiVersion: ${projectName}.applik8s.dev/v1alpha1
kind: ${applicationKind(projectName)}
metadata:
  name: ${projectName}
  namespace: default
spec:
  name: ${projectName}
  profile: starter
`,
    '.env.example': `# Starter is credential-free and explicitly non-production.
APPLIK8S_PROFILE=starter
# The CLI never adopts kubectl's ambient current context implicitly.
APPLIK8S_CONTEXT=orbstack
`,
  };
}

function applicationKind(projectName: string): string {
  return projectName
    .split('-')
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join('');
}
