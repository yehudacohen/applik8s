// typecast-file-boundary: the maintained composition validates its standard request and terminal protocol before narrowing the callable binding.
import {
  actor,
  type ApplicationQualifiedProviderToken,
  type ApplicationServiceIdentityBinding,
  defineApplicationModule,
  type KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import type { ApplicationActorKeySchema } from '@applik8s/applik8s/actor-runtime';
import { type as schema } from 'arktype';
import type {
  ApplicationAgentHarnessProvider,
  ApplicationCodeAgentResult,
  ApplicationCodeWorkspaceProvider,
  ApplicationProcessRunnerProvider,
  ApplicationSourceRepositoryProvider,
} from './contracts.js';
export interface ApplicationCodeAgentRequest {
  readonly repositoryId: string;
  readonly instruction: string;
  readonly idempotencyKey: string;
}

export interface ApplicationCodeAgentCancellationRequest {
  readonly repositoryId: string;
  readonly idempotencyKey: string;
}

export interface ApplicationCodeAgentOptions {
  readonly actor: { readonly key: ApplicationActorKeySchema };
  readonly identity: ApplicationServiceIdentityBinding;
  readonly harness: ApplicationQualifiedProviderToken<ApplicationAgentHarnessProvider>;
  readonly workspace: ApplicationQualifiedProviderToken<ApplicationCodeWorkspaceProvider>;
  readonly source: ApplicationQualifiedProviderToken<ApplicationSourceRepositoryProvider>;
  readonly process: ApplicationQualifiedProviderToken<ApplicationProcessRunnerProvider>;
  readonly validation?: readonly {
    readonly executable: string;
    readonly arguments?: readonly string[];
    readonly timeoutMs?: number;
  }[];
  readonly workspacePolicy?: {
    readonly ttlMs?: number;
    readonly disposition?: 'retain' | 'release';
  };
  readonly timeoutMs?: number;
}

export type ApplicationCodeAgentBinding = ((
  input: ApplicationCodeAgentRequest,
) => Promise<ApplicationCodeAgentResult>) & {
  readonly kind: 'applicationAgent';
  readonly specialization: 'code';
  readonly name: string;
  readonly actorId: string;
  readonly capabilities: {
    readonly harness: string;
    readonly workspace: string;
    readonly source: string;
    readonly process: string;
  };
  cancel(input: ApplicationCodeAgentCancellationRequest): Promise<{
    readonly status: 'cancelled' | 'alreadyTerminal';
  }>;
};

export function codeAgent(
  id: `${string}.v${number}`,
  options: ApplicationCodeAgentOptions,
) {
  const name = stableCodeAgentId(id);
  const install = (
    application: KubernetesApplicationBuilder<object, object>,
  ): ApplicationCodeAgentBinding => {
    const harness = application.inject(options.harness);
    const workspace = application.inject(options.workspace);
    const source = application.inject(options.source);
    const process = application.inject(options.process);
    const run = application.actor(`${name}-run`, {
      key: options.actor.key,
      state: schema({
        status: "'idle' | 'running' | 'completed' | 'failed' | 'cancelled'",
        'runId?': 'string',
        'terminal?': 'object',
      }),
      protocol: {
        execute: actor.command({
          input: schema({ repositoryId: 'string', instruction: 'string', idempotencyKey: 'string' }),
          output: codeAgentTerminalSchema,
        }),
      },
    });
    run.on.initialize(() => ({ status: 'idle' as const }));
    run.on.execute(async (turn, input) => {
      const runId = `code:${name}:${input.repositoryId}:${input.idempotencyKey}`;
      const current = await turn.state();
      if (current.runId === runId && current.terminal) {
        return current.terminal as never;
      }
      await turn.setState({ status: 'running', runId });
      const fencingToken = `fence:${runId}`;
      let lease: Awaited<ReturnType<typeof workspace.lease>> | undefined;
      try {
        lease = await workspace.lease({
          workspace: input.repositoryId,
          runId,
          fencingToken,
          ...(options.workspacePolicy?.ttlMs
            ? { ttlMs: options.workspacePolicy.ttlMs }
            : {}),
        });
        const snapshot = await source.inspect({ lease });
        const timeoutMs = boundedInteger(options.timeoutMs ?? 10 * 60_000, 1_000, 60 * 60_000, 'timeoutMs');
        const harnessResult = await harness.run({
          apiVersion: 'applik8s.agentHarnessRun/v1alpha1',
          runId,
          fencingToken,
          workspace: lease,
          instruction: input.instruction,
          source: snapshot,
          deadline: new Date(Date.now() + timeoutMs).toISOString(),
          grants: [
            options.harness.qualification.key,
            options.workspace.qualification.key,
            options.source.qualification.key,
            options.process.qualification.key,
          ],
        });
        if (harnessResult.status !== 'completed') {
          const terminal = {
            status: harnessResult.status === 'cancelled' ? 'cancelled' as const : 'failed' as const,
            runId,
            workspace: lease,
            reason: harnessResult.summary,
          };
          await turn.setState({ status: terminal.status, runId, terminal });
          return terminal;
        }
        const updated = harnessResult.changes.length > 0
          ? await source.apply({ lease, changes: harnessResult.changes })
          : snapshot;
        const validation = [];
        for (const [index, command] of (options.validation ?? []).entries()) {
          validation.push(await process.run({
            lease,
            idempotencyKey: `${runId}:validation:${index}`,
            executable: command.executable,
            ...(command.arguments ? { arguments: command.arguments } : {}),
            ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
          }));
        }
        const failed = validation.find((result) => result.exitCode !== 0);
        if (failed) throw new Error(`Validation command ${failed.command} exited ${failed.exitCode}.`);
        await workspace.release({
          lease,
          disposition: options.workspacePolicy?.disposition ?? 'retain',
        });
        const terminal = {
          status: 'completed' as const,
          runId,
          workspace: lease,
          revision: updated.revision,
          summary: harnessResult.summary,
          harness: {
            sessionId: harnessResult.sessionId,
            receipt: harnessResult.receipt,
          },
          validation: [...validation],
        };
        await turn.setState({ status: 'completed', runId, terminal });
        return terminal;
      } catch (error) {
        if (lease) {
          await workspace.release({ lease, disposition: 'retain' }).catch(() => undefined);
        }
        const terminal = {
          status: 'failed' as const,
          runId,
          ...(lease ? { workspace: lease } : {}),
          reason: error instanceof Error ? error.message : String(error),
        };
        await turn.setState({ status: 'failed', runId, terminal });
        return terminal;
      }
    });
    options.identity.can(run.execute);
    const invoke = async (input: ApplicationCodeAgentRequest) => {
      validateCodeAgentRequest(input);
      return run.execute(input.repositoryId, input, {
        idempotencyKey: `code:${name}:${input.repositoryId}:${input.idempotencyKey}`,
      }) as Promise<ApplicationCodeAgentResult>;
    };
    const cancel = async (input: ApplicationCodeAgentCancellationRequest) => {
      boundedText(input.repositoryId, 'repositoryId', 1, 200);
      boundedText(input.idempotencyKey, 'idempotencyKey', 1, 500);
      const runId = `code:${name}:${input.repositoryId}:${input.idempotencyKey}`;
      return harness.cancel({ runId, fencingToken: `fence:${runId}` });
    };
    Object.defineProperties(invoke, {
      kind: { value: 'applicationAgent', enumerable: true },
      specialization: { value: 'code', enumerable: true },
      name: { value: name, enumerable: true, configurable: true },
      actorId: { value: run.id, enumerable: true },
      capabilities: { value: Object.freeze({
        harness: options.harness.qualification.key,
        workspace: options.workspace.qualification.key,
        source: options.source.qualification.key,
        process: options.process.qualification.key,
      }), enumerable: true },
      cancel: { value: cancel, enumerable: true },
    });
    return invoke as ApplicationCodeAgentBinding;
  };
  return defineApplicationModule(
    (application: KubernetesApplicationBuilder<object, object>) => install(application),
    { name: `code-agent:${name}`, install },
  );
}

const codeAgentTerminalSchema = schema({
  status: "'completed' | 'failed' | 'cancelled'",
  runId: 'string',
  'workspace?': 'object',
  'revision?': 'string',
  'summary?': 'string',
  'harness?': 'object',
  'validation?': 'object[]',
  'reason?': 'string',
});

function stableCodeAgentId(value: string): string {
  const match = /^(?<name>[a-z][a-z0-9.-]*)\.v[1-9][0-9]*$/u.exec(value);
  if (!match?.groups?.name) throw new Error(`codeAgent() id ${JSON.stringify(value)} must end in a stable version such as product-builder.v1.`);
  return value;
}

function validateCodeAgentRequest(input: ApplicationCodeAgentRequest): void {
  boundedText(input.repositoryId, 'repositoryId', 1, 200);
  boundedText(input.idempotencyKey, 'idempotencyKey', 1, 500);
  boundedText(input.instruction, 'instruction', 1, 20_000);
}

function boundedText(value: string, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) throw new Error(`${label} must contain ${minimum} to ${maximum} characters.`);
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}
