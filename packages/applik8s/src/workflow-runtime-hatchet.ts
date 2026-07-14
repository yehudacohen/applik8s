import { HatchetClient, type JsonObject, Priority } from '@hatchet-dev/typescript-sdk/v1';

import type { ApplicationHatchetWorkflowEngineProvider } from './application-providers.js';
import type { ApplicationWorkflowInvocationMetadata, ApplicationWorkflowRun, ApplicationWorkflowRuntime } from './workflow-runtime.js';

export function createHatchetWorkflowRuntime(provider: ApplicationHatchetWorkflowEngineProvider): ApplicationWorkflowRuntime {
  const token = process.env.HATCHET_CLIENT_TOKEN;
  const hostPort = provider.hostPort ?? process.env.HATCHET_CLIENT_HOST_PORT;
  const apiUrl = provider.apiUrl ?? process.env.HATCHET_CLIENT_API_URL;
  // typecast: Hatchet's JsonObject boundary accepts schema-validated application inputs; the literal TLS strategy retains its SDK discriminant.
  const client = HatchetClient.init({
    ...(token ? { token } : {}),
    ...(hostPort ? { host_port: hostPort } : {}),
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...(provider.tls !== true ? { tls_config: { tls_strategy: 'none' as const } } : {}), // typecast: retain Hatchet's literal TLS strategy discriminant.
  });
  return {
    async run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      // typecast: schema-validated application input satisfies Hatchet's JSON object transport boundary.
      const reference = await client.runNoWait<JsonObject, JsonObject>(contract, input as JsonObject, hatchetRunOptions(metadata));
      return waitForHatchetResult<TOutput>(client, await reference.runId);
    },
    async start<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      // typecast: schema-validated application input satisfies Hatchet's JSON object transport boundary.
      const reference = await client.runNoWait<JsonObject, JsonObject>(contract, input as JsonObject, hatchetRunOptions(metadata));
      const id = await reference.runId;
      return {
        id,
        result: () => waitForHatchetResult<TOutput>(client, id),
        cancel: async () => { await client.runs.cancel({ ids: [id] }); },
      } satisfies ApplicationWorkflowRun<TOutput>;
    },
    async schedule(contract, input, at, metadata) {
      const declaration = client.workflow({ name: contract });
      const scheduled = await declaration.schedule(at, input, hatchetRunOptions(metadata));
      const id = Reflect.get(scheduled, 'metadata')?.id ?? Reflect.get(scheduled, 'id');
      return { id: typeof id === 'string' ? id : `${contract}:${at.toISOString()}` };
    },
    async signal(contract, runId, signal, payload, metadata) {
      await client.events.push(`${contract}.${signal}`, payload, {
        scope: runId,
        additionalMetadata: applicationMetadata(metadata),
      });
    },
  };
}

async function waitForHatchetResult<TOutput extends object>(client: HatchetClient, id: string): Promise<TOutput> {
  for (;;) {
    const details = await client.runs.get(id);
    if (details.run.status === 'COMPLETED') {
      // typecast: generated workers validate the declared workflow output before Hatchet persists it.
      return details.run.output as TOutput;
    }
    if (details.run.status === 'FAILED') throw new Error(`Hatchet workflow ${id} failed: ${details.run.errorMessage ?? 'no error message'}`);
    if (details.run.status === 'CANCELLED') throw new Error(`Hatchet workflow ${id} was cancelled.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function hatchetRunOptions(metadata: ApplicationWorkflowInvocationMetadata | undefined): { readonly additionalMetadata?: Record<string, string>; readonly priority?: Priority; readonly childKey?: string } {
  const additionalMetadata = applicationMetadata(metadata);
  const priority = metadata?.priority === 'high' ? Priority.HIGH : metadata?.priority === 'low' ? Priority.LOW : metadata?.priority === 'medium' ? Priority.MEDIUM : undefined;
  return {
    ...(Object.keys(additionalMetadata).length > 0 ? { additionalMetadata } : {}),
    ...(priority ? { priority } : {}),
    ...(metadata?.idempotencyKey ? { childKey: metadata.idempotencyKey } : {}),
  };
}

function applicationMetadata(metadata: ApplicationWorkflowInvocationMetadata | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries({
    'applik8s.idempotency-key': metadata?.idempotencyKey,
    'applik8s.tenant': metadata?.tenant,
    'applik8s.correlation-id': metadata?.correlationId,
    'applik8s.causation-id': metadata?.causationId,
    traceparent: metadata?.traceparent,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}
