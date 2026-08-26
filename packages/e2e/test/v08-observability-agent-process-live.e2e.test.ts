// typecast-file-boundary: Live generated-process and OTLP payloads are narrowed
// only after their authoritative protocol boundaries are exercised.
import { type ChildProcess, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  ApplicationAIAgentNode,
  ApplicationGraph,
  ApplicationModelNode,
} from '@applik8s/core';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { emitGeneratedApplicationAgents } from '../../compiler/src/application-agents/index.js';
import { emitGeneratedApplicationMigrations } from '../../compiler/src/application-migrations/index.js';
import {
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../../compiler/src/application-operations/index.js';
import { discoverApplicationGraphWithExports } from '../../compiler/src/pipeline/index.js';
import { applicationRuntimeEndpointEnvironmentName } from '../../deployment-contract/src/runtime-artifact.js';
import {
  availableGeneratedProcessPort,
  emitGeneratedFetchGatewayProcess,
  startGeneratedProcess,
  startTestOtlpReceiver,
  stopGeneratedProcess,
  testOtlpAttribute,
  waitForGeneratedHttp,
  waitForGeneratedProcess,
} from './support/generated-process.js';

const databaseUrl = process.env.APPLIK8S_V08_OBSERVABILITY_AGENT_DATABASE_URL;
const fixture = new URL(
  './fixtures/v08-observability-agent-process/app.ts',
  import.meta.url,
).pathname;
const execFileAsync = promisify(execFile);

describe('v0.8 generated agent process observability chain', () => {
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    await Promise.all([...children].map((child) => stopGeneratedProcess(child, 'SIGKILL')));
    children.clear();
  });

  it.skipIf(!databaseUrl)(
    'links front HTTP, durable agent, inference, and a typed tool across restart, replay, and cancellation',
    async () => {
      const selectedDatabaseUrl = databaseUrl;
      if (!selectedDatabaseUrl) {
        throw new Error('Generated agent process evidence requires a PostgreSQL endpoint.');
      }
      const suffix = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const postId = '10000000-0000-0000-0000-000000000808';
      const sensitiveSegment = `private-agent-carrier-${suffix}`;
      const generatedRoot = join(process.cwd(), '.applik8s-tmp');
      await mkdir(generatedRoot, { recursive: true });
      const outDir = await mkdtemp(join(generatedRoot, 'v08-agent-process-'));
      const collector = await startTestOtlpReceiver();
      const sql = postgres(selectedDatabaseUrl, {
        max: 6,
        idle_timeout: 5,
        connect_timeout: 5,
        prepare: false,
        onnotice: () => undefined,
      });
      let graph: ApplicationGraph | undefined;
      let model: ApplicationModelNode | undefined;
      const outputs: Array<() => string> = [];
      const agentPort = await availableGeneratedProcessPort();
      process.env.APPLIK8S_V08_AGENT_PROCESS_PORT = String(agentPort);
      try {
        const discovered = await discoverApplicationGraphWithExports(
          fixture,
          'v08ObservabilityAgentProcess',
        );
        expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
        if (!discovered.ok) return;
        graph = discovered.value.graph;
        const agent = graph.nodes.find(
          (node): node is ApplicationAIAgentNode => node.kind === 'aiAgent',
        );
        model = graph.nodes.find(
          (node): node is ApplicationModelNode => node.kind === 'model' && node.name === 'Post',
        );
        if (!agent || !model?.runtime) {
          throw new Error('Generated agent fixture lost its agent or native Post model.');
        }
        expect(agent.deployment.port).toBe(agentPort);

        const [migration] = await emitGeneratedApplicationMigrations({
          graph,
          entrypoint: fixture,
          outDir: join(outDir, 'migrations'),
        });
        if (!migration) throw new Error('Generated agent graph emitted no native migration artifact.');
        await execFileAsync(
          'psql',
          [selectedDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', migration.sourcePath],
          { env: process.env },
        );
        await sql.unsafe(
          `INSERT INTO ${quoteIdentifier(model.runtime.tableName)} (id, body, state, revision)
           VALUES ($1, $2, $3, $4)`,
          [postId, 'draft body', 'draft', 'initial'],
        );

        const catalog = compileApplicationOperationCatalog(graph);
        const authority = compileApplicationWorkloadAuthority(graph, catalog);
        const [artifact] = await emitGeneratedApplicationAgents({
          graph,
          operationCatalog: catalog,
          workloadAuthority: authority,
          outDir: join(outDir, 'agent'),
          entrypoint: fixture,
        });
        if (!artifact) throw new Error('Generated agent graph emitted no agent process.');
        const frontSource = await emitGeneratedFetchGatewayProcess(
          graph,
          join(outDir, 'front'),
        );
        const agentEndpointEnvironment = applicationRuntimeEndpointEnvironmentName(agent.id);
        const commonEnvironment = {
          APPLIK8S_APPLICATION_NAME: graph.metadata.name,
          APPLIK8S_DEPLOYMENT_TARGET: 'local',
          APPLIK8S_ENVIRONMENT_ID: 'generated-agent-process-live',
          APPLIK8S_NAMESPACE: graph.metadata.namespace as string,
          APPLIK8S_INTERNAL_OPERATION_SECRET: 'agent-operation-key-v08'.repeat(3),
          APPLIK8S_CURSOR_SECRET: 'agent-cursor-key-v08'.repeat(3),
          APPLIK8S_CONTEXT_SECRET: 'agent-context-key-v08'.repeat(3),
          DATABASE_URL: selectedDatabaseUrl,
          [model.runtime.connectionEnvName]: selectedDatabaseUrl,
          OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint,
        };

        let agentProcess = startGeneratedProcess(artifact.sourcePath, commonEnvironment);
        children.add(agentProcess.child);
        outputs.push(agentProcess.output);
        await waitForGeneratedHttp(`http://127.0.0.1:${agentPort}/readyz`, agentProcess);

        const frontPort = await availableGeneratedProcessPort();
        const frontProcess = startGeneratedProcess(frontSource, {
          ...commonEnvironment,
          APPLIK8S_HTTP_PORT: String(frontPort),
          [agentEndpointEnvironment]: `http://127.0.0.1:${agentPort}`,
        });
        children.add(frontProcess.child);
        outputs.push(frontProcess.output);
        const endpoint = `http://127.0.0.1:${frontPort}`;
        await waitForGeneratedHttp(`${endpoint}/ready`, frontProcess);

        const first = await invokeAgent(
          endpoint,
          'thread-qualified',
          'run-qualified',
          sensitiveSegment,
          { 'x-applik8s-telemetry': `${sensitiveSegment}-malformed` },
        );
        expect(first.status).toBe(200);
        expect(first.body).toContain('"type":"TOOL_CALL_START"');
        expect(first.body).toContain('The post was published through the typed operation.');
        expect(
          await postState(sql, model.runtime.tableName, postId),
          `${first.body}\n${agentProcess.output()}`,
        ).toEqual({
          body: 'published by the generated agent process',
          state: 'published',
        });

        expect(
          await stopGeneratedProcess(agentProcess.child),
          agentProcess.output(),
        ).toBe(true);
        children.delete(agentProcess.child);
        agentProcess = startGeneratedProcess(artifact.sourcePath, commonEnvironment);
        children.add(agentProcess.child);
        outputs.push(agentProcess.output);
        await waitForGeneratedHttp(`http://127.0.0.1:${agentPort}/readyz`, agentProcess);

        const replay = await invokeAgent(
          endpoint,
          'thread-qualified',
          'run-qualified',
          sensitiveSegment,
        );
        expect(replay.status, `${replay.body}\n${agentProcess.output()}`).toBe(200);
        expect(sseEvents(replay.body)).toEqual(sseEvents(first.body));
        expect(await toolProposalCount(sql)).toBe(1);

        const cancellation = new AbortController();
        const cancelRequest = fetch(`${endpoint}/__applik8s/v1/ai/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(agentBody(
            'thread-cancelled',
            'run-cancelled',
            'cancel before inference completes',
          )),
          signal: cancellation.signal,
        });
        await waitForGeneratedProcess(
          async () => (await attemptStates(sql)).some((state) =>
            state === 'dispatching' || state === 'streaming'
          ),
          agentProcess,
        );
        // Dispatching is committed before TanStack begins consuming the
        // provider stream. Give the generated process one bounded turn to
        // enter that stream, while remaining well inside the fixture's 350ms
        // deterministic provider latency.
        await new Promise((resolve) => setTimeout(resolve, 100));
        cancellation.abort(new Error('browser disconnected'));
        await cancelRequest
          .then(async (response) => {
            expect(response.status).toBe(200);
            await response.text();
          })
          .catch(() => undefined);
        await waitForGeneratedProcess(
          async () => (await attemptStates(sql)).includes('cancelled'),
          agentProcess,
        );

        const replayAfterCancellation = await invokeAgent(
          endpoint,
          'thread-qualified',
          'run-qualified',
          sensitiveSegment,
        );
        expect(sseEvents(replayAfterCancellation.body)).toEqual(
          sseEvents(first.body),
        );
        expect(await toolProposalCount(sql)).toBe(1);

        expect(await stopGeneratedProcess(agentProcess.child)).toBe(true);
        children.delete(agentProcess.child);
        expect(await stopGeneratedProcess(frontProcess.child)).toBe(true);
        children.delete(frontProcess.child);
        await collector.waitForTraces();

        const spans = collector.spans();
        const agentSpans = spans.filter(
          (span) => testOtlpAttribute(span, 'applik8s.boundary.kind') === 'agent',
        );
        const providerSpans = spans.filter(
          (span) => testOtlpAttribute(span, 'applik8s.boundary.kind') === 'provider',
        );
        const toolSpans = spans.filter(
          (span) => testOtlpAttribute(span, 'applik8s.boundary.kind') === 'operation'
            && String(testOtlpAttribute(span, 'applik8s.operation')).includes('publishPost'),
        );
        const httpSpans = spans.filter(
          (span) => testOtlpAttribute(span, 'applik8s.boundary.kind') === 'http',
        );
        const summary = spans.map((span) => ({
          kind: testOtlpAttribute(span, 'applik8s.boundary.kind'),
          operation: testOtlpAttribute(span, 'applik8s.operation'),
          execution: testOtlpAttribute(span, 'applik8s.execution'),
          traceId: span.traceId,
        }));
        expect(agentSpans, JSON.stringify(summary)).toHaveLength(2);
        expect(providerSpans.length).toBeGreaterThanOrEqual(3);
        expect(toolSpans, JSON.stringify(summary)).toHaveLength(1);
        for (const agentSpan of agentSpans) {
          expect(agentSpan.links?.some((link) => httpSpans.some(
            (http) => http.traceId === link.traceId && http.spanId === link.spanId,
          )), JSON.stringify(summary)).toBe(true);
        }
        for (const nested of [...providerSpans, ...toolSpans]) {
          expect(agentSpans.some((agentSpan) => agentSpan.traceId === nested.traceId)).toBe(true);
        }
        const exported = JSON.stringify(collector.payloads());
        expect(exported).not.toContain(sensitiveSegment);
        expect(outputs.map((output) => output()).join('\n')).not.toContain(sensitiveSegment);
      } finally {
        delete process.env.APPLIK8S_V08_AGENT_PROCESS_PORT;
        await Promise.all([...children].map((child) => stopGeneratedProcess(child, 'SIGKILL')));
        children.clear();
        await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE').catch(() => undefined);
        await sql.unsafe('CREATE SCHEMA public').catch(() => undefined);
        await sql.end({ timeout: 5 }).catch(() => undefined);
        await collector.close();
        await rm(outDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

function agentBody(threadId: string, runId: string, content: string): object {
  return {
    threadId,
    runId,
    messages: [{ role: 'user', content }],
  };
}

async function invokeAgent(
  endpoint: string,
  threadId: string,
  runId: string,
  content: string,
  headers: HeadersInit = {},
): Promise<{ readonly status: number; readonly body: string }> {
  const response = await fetch(`${endpoint}/__applik8s/v1/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(agentBody(threadId, runId, content)),
  });
  return { status: response.status, body: await response.text() };
}

async function postState(
  sql: postgres.Sql,
  tableName: string,
  postId: string,
): Promise<{ readonly body: string; readonly state: string }> {
  const [row] = await sql.unsafe(
    `SELECT body, state FROM ${quoteIdentifier(tableName)} WHERE id = $1`,
    [postId],
  );
  return { body: String(row?.body), state: String(row?.state) };
}

async function toolProposalCount(sql: postgres.Sql): Promise<number> {
  const [row] = await sql.unsafe(
    'SELECT count(*)::int AS count FROM applik8s_ai_tool_proposals',
  );
  return Number(row?.count);
}

async function attemptStates(sql: postgres.Sql): Promise<readonly string[]> {
  const rows = await sql.unsafe(
    "SELECT record->>'state' AS state FROM applik8s_ai_attempts ORDER BY ordinal",
  );
  return rows.map((row) => String(row.state));
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sseEvents(source: string): readonly unknown[] {
  return source
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
}
