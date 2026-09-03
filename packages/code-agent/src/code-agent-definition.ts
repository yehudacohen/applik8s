// typecast-file-boundary: maintained code-agent composition joins provider
// generics, application graph metadata, and fixed runtime operation schemas at
// one package boundary while preserving its ordinary Promise-returning API.
import {
  type ApplicationQualifiedProviderToken,
  type ApplicationServiceIdentityBinding,
  defineApplicationModule,
  type KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  applicationQualifiedProviderRef,
  registerApplicationGraphExtension,
} from '@applik8s/applik8s/graph-extension-runtime';
import type { ApplicationAIModelDefinition } from '@applik8s/ai';
import {
  createApplicationRuntimeOperation,
  type ApplicationOperation,
} from '@applik8s/client';
import type {
  ApplicationCodeAgentNode,
  ApplicationMessageContractSchema,
  ApplicationOperationId,
} from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import { type as schema } from 'arktype';
import type {
  ApplicationAgentHarnessProvider,
  ApplicationCodeAgentResult,
  ApplicationCodeWorkspaceLease,
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
  readonly identity: ApplicationServiceIdentityBinding;
  readonly model: ApplicationAIModelDefinition;
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

export type ApplicationCodeAgentBinding = ApplicationOperation<
  ApplicationCodeAgentRequest,
  ApplicationCodeAgentResult
> & {
  readonly kind: 'applicationAgent';
  readonly specialization: 'code';
  readonly name: string;
  readonly capabilities: {
    readonly harness: string;
    readonly workspace: string;
    readonly source: string;
    readonly process: string;
  };
  readonly cancel: ApplicationOperation<
    ApplicationCodeAgentCancellationRequest,
    { readonly status: 'cancelled' | 'alreadyTerminal' }
  >;
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
    const timeoutMs = boundedInteger(
      options.timeoutMs ?? 10 * 60_000,
      1_000,
      60 * 60_000,
      'timeoutMs',
    );
    const workspaceTtlMs = boundedInteger(
      options.workspacePolicy?.ttlMs ?? 30 * 60_000,
      1_000,
      24 * 60 * 60_000,
      'workspacePolicy.ttlMs',
    );
    const validation = Object.freeze(
      (options.validation ?? []).map((command, index) => ({
        executable: boundedText(command.executable, `validation[${index}].executable`, 1, 1_024),
        ...(command.arguments ? { arguments: Object.freeze([...command.arguments]) } : {}),
        ...(command.timeoutMs !== undefined
          ? { timeoutMs: boundedInteger(command.timeoutMs, 1, 60 * 60_000, `validation[${index}].timeoutMs`) }
          : {}),
      })),
    );
    const runOperationId = codeAgentOperationId(name, 'run');
    const cancelOperationId = codeAgentOperationId(name, 'cancel');
    const invoke = createApplicationRuntimeOperation<ApplicationCodeAgentRequest, ApplicationCodeAgentResult>(
      {
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: runOperationId,
        model: name,
        name: 'run',
        operation: 'custom',
        transport: 'runtime',
        version: versionForCodeAgentId(id),
      },
      async (input) => executeCodeAgent({
        name,
        input,
        model: options.model,
        timeoutMs,
        workspaceTtlMs,
        workspaceDisposition: options.workspacePolicy?.disposition ?? 'retain',
        validation,
        harness,
        workspace,
        source,
        process,
      }),
      { input: codeAgentRequestSchema, output: codeAgentTerminalSchema },
    );
    const cancel = createApplicationRuntimeOperation<
      ApplicationCodeAgentCancellationRequest,
      { readonly status: 'cancelled' | 'alreadyTerminal' }
    >(
      {
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: cancelOperationId,
        model: name,
        name: 'cancel',
        operation: 'custom',
        transport: 'runtime',
        version: versionForCodeAgentId(id),
      },
      async (input) => {
        validateCodeAgentCancellationRequest(input);
        const runId = codeAgentRunId(name, input.repositoryId, input.idempotencyKey);
        return harness.cancel({
          runId,
          fencingToken: codeAgentFence(runId),
          workspace: input.repositoryId,
        });
      },
      { input: codeAgentCancellationSchema, output: codeAgentCancellationResultSchema },
    );

    options.identity.can(invoke, cancel);

    const harnessRef = applicationQualifiedProviderRef(harness, 'AgentHarness');
    const workspaceRef = applicationQualifiedProviderRef(workspace, 'CodeWorkspace');
    const sourceRef = applicationQualifiedProviderRef(source, 'SourceRepository');
    const processRef = applicationQualifiedProviderRef(process, 'ProcessRunner');
    const nodeId = `codeAgent.${stableGraphSegment(name)}`;
    const node: ApplicationCodeAgentNode = {
      id: nodeId,
      kind: 'codeAgent',
      name,
      stability: 'experimental',
      definition: {
        id,
        serviceIdentity: options.identity.identity,
        invocation: {
          input: messageContract(codeAgentRequestSchema, `${name}.input`),
          output: messageContract(codeAgentTerminalSchema, `${name}.output`),
          key: 'repositoryId',
        },
        model: {
          apiVersion: options.model.apiVersion,
          name: options.model.name,
          capabilities: options.model.capabilities.map(({ name: capability }) => capability),
          constraints: options.model.constraints,
          ...(options.model.inference ? { inference: options.model.inference } : {}),
        },
        validation,
        workspace: {
          ttlMs: workspaceTtlMs,
          disposition: options.workspacePolicy?.disposition ?? 'retain',
        },
        timeoutMs,
      },
      harness: harnessRef,
      workspace: workspaceRef,
      source: sourceRef,
      process: processRef,
      operations: {
        run: runOperationId,
        cancel: cancelOperationId,
        transport: 'runtime',
      },
      semantics: {
        placement: 'providerManaged',
        isolationKey: 'agentAndRepository',
        hostLifetime: 'providerManaged',
        admission: 'idempotentReceipt',
        fencing: 'workspaceLease',
        durability: 'providerManaged',
      },
    };
    registerApplicationGraphExtension(application, {
      node,
      edges: [harnessRef, workspaceRef, sourceRef, processRef].map((provider) => ({
        from: { nodeId: provider.nodeId },
        to: { nodeId },
        relationship: 'provides' as const,
      })),
    });

    Object.defineProperties(invoke, {
      kind: { value: 'applicationAgent', enumerable: true },
      specialization: { value: 'code', enumerable: true },
      name: { value: name, enumerable: true, configurable: true },
      capabilities: {
        value: Object.freeze({
          harness: options.harness.qualification.key,
          workspace: options.workspace.qualification.key,
          source: options.source.qualification.key,
          process: options.process.qualification.key,
        }),
        enumerable: true,
      },
      cancel: { value: cancel, enumerable: true },
    });
    return invoke as ApplicationCodeAgentBinding;
  };
  return defineApplicationModule(
    (application: KubernetesApplicationBuilder<object, object>) => install(application),
    { name: `code-agent:${name}`, install },
  );
}

interface ExecuteCodeAgentOptions {
  readonly name: string;
  readonly input: ApplicationCodeAgentRequest;
  readonly model: ApplicationAIModelDefinition;
  readonly timeoutMs: number;
  readonly workspaceTtlMs: number;
  readonly workspaceDisposition: 'retain' | 'release';
  readonly validation: readonly {
    readonly executable: string;
    readonly arguments?: readonly string[];
    readonly timeoutMs?: number;
  }[];
  readonly harness: ApplicationAgentHarnessProvider;
  readonly workspace: ApplicationCodeWorkspaceProvider;
  readonly source: ApplicationSourceRepositoryProvider;
  readonly process: ApplicationProcessRunnerProvider;
}

async function executeCodeAgent(options: ExecuteCodeAgentOptions): Promise<ApplicationCodeAgentResult> {
  validateCodeAgentRequest(options.input);
  const runId = codeAgentRunId(
    options.name,
    options.input.repositoryId,
    options.input.idempotencyKey,
  );
  const fencingToken = codeAgentFence(runId);
  let lease: ApplicationCodeWorkspaceLease | undefined;
  try {
    lease = await options.workspace.lease({
      workspace: options.input.repositoryId,
      runId,
      fencingToken,
      ttlMs: options.workspaceTtlMs,
    });
    const snapshot = await options.source.inspect({ lease });
    const harnessResult = await options.harness.run({
      apiVersion: 'applik8s.agentHarnessRun/v1alpha1',
      runId,
      fencingToken,
      workspace: lease,
      instruction: options.input.instruction,
      model: options.model,
      source: snapshot,
      deadline: new Date(Date.now() + options.timeoutMs).toISOString(),
      grants: [
        'ai.invoke',
        'filesystem.read',
        'repository.read',
        'process.execute',
      ],
      ...(options.validation.length > 0 ? { processTools: options.validation } : {}),
    });
    if (harnessResult.status !== 'completed') {
      const terminal: ApplicationCodeAgentResult = {
        status: harnessResult.status === 'cancelled' ? 'cancelled' : 'failed',
        runId,
        workspace: workspaceReference(lease),
        reason: harnessResult.summary,
      };
      await options.workspace.release({ lease, disposition: 'retain' });
      return terminal;
    }
    const updated = harnessResult.changes.length > 0
      ? await options.source.apply({ lease, changes: harnessResult.changes })
      : snapshot;
    const validation = [];
    for (const [index, command] of options.validation.entries()) {
      validation.push(await options.process.run({
        lease,
        idempotencyKey: `${runId}:validation:${index}`,
        executable: command.executable,
        ...(command.arguments ? { arguments: command.arguments } : {}),
        ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
      }));
    }
    const failed = validation.find((result) => result.exitCode !== 0);
    if (failed) {
      throw new Error(`Validation command ${failed.command} exited ${failed.exitCode}.`);
    }
    await options.workspace.release({
      lease,
      disposition: options.workspaceDisposition,
    });
    return {
      status: 'completed',
      runId,
      workspace: workspaceReference(lease),
      revision: updated.revision,
      summary: harnessResult.summary,
      harness: {
        sessionId: harnessResult.sessionId,
        receipt: harnessResult.receipt,
      },
      validation,
    };
  } catch (error) {
    if (lease) {
      await options.workspace.release({ lease, disposition: 'retain' }).catch(() => undefined);
    }
    return {
      status: 'failed',
      runId,
      ...(lease ? { workspace: workspaceReference(lease) } : {}),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

const codeAgentRequestSchema = schema({
  repositoryId: 'string',
  instruction: 'string',
  idempotencyKey: 'string',
});

const codeAgentCancellationSchema = schema({
  repositoryId: 'string',
  idempotencyKey: 'string',
});

const codeAgentCancellationResultSchema = schema({
  status: "'cancelled' | 'alreadyTerminal'",
});

const codeAgentTerminalSchema = schema({
  status: "'completed' | 'failed' | 'cancelled'",
  runId: 'string',
  'workspace?': {
    apiVersion: "'applik8s.codeWorkspaceReference/v1alpha1'",
    id: 'string',
    workspace: 'string',
    runId: 'string',
  },
  'revision?': 'string',
  'summary?': 'string',
  'harness?': 'object',
  'validation?': 'object[]',
  'reason?': 'string',
});

function messageContract(value: SchemaInput<object>, label: string): ApplicationMessageContractSchema {
  const emitted = normalizeSchema(value, label).emitJsonSchema();
  if (!emitted.ok) {
    throw new Error(`Code-agent schema ${label} cannot be serialized: ${emitted.error.message}`);
  }
  return {
    kind: 'declared',
    runtime: 'arktype',
    jsonSchema: emitted.value.schema,
  };
}

function workspaceReference(lease: ApplicationCodeWorkspaceLease) {
  return Object.freeze({
    apiVersion: 'applik8s.codeWorkspaceReference/v1alpha1' as const,
    id: lease.id,
    workspace: lease.workspace,
    runId: lease.runId,
  });
}

function codeAgentOperationId(name: string, operation: 'run' | 'cancel'): ApplicationOperationId {
  return `applik8s://code-agents/${name}/operations/${operation}`;
}

function codeAgentRunId(name: string, repositoryId: string, idempotencyKey: string): string {
  return `code:${name}:${repositoryId}:${idempotencyKey}`;
}

function codeAgentFence(runId: string): string {
  return `fence:${runId}`;
}

function versionForCodeAgentId(value: string): string {
  return value.slice(value.lastIndexOf('.') + 1);
}

function stableGraphSegment(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function stableCodeAgentId(value: string): string {
  const match = /^(?<name>[a-z][a-z0-9.-]*)\.v[1-9][0-9]*$/u.exec(value);
  if (!match?.groups?.name) {
    throw new Error(
      `codeAgent() id ${JSON.stringify(value)} must end in a stable version such as product-builder.v1.`,
    );
  }
  return value;
}

function validateCodeAgentRequest(input: ApplicationCodeAgentRequest): void {
  boundedText(input.repositoryId, 'repositoryId', 1, 200);
  boundedText(input.idempotencyKey, 'idempotencyKey', 1, 500);
  boundedText(input.instruction, 'instruction', 1, 20_000);
}

function validateCodeAgentCancellationRequest(input: ApplicationCodeAgentCancellationRequest): void {
  boundedText(input.repositoryId, 'repositoryId', 1, 200);
  boundedText(input.idempotencyKey, 'idempotencyKey', 1, 500);
}

function boundedText(value: string, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum} to ${maximum} characters.`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
