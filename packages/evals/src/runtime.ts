import type {
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
} from '@applik8s/ai-tanstack';
import { asTool } from '@applik8s/ai-tanstack';
import {
  createApplicationMutationOperation,
  type ApplicationOperationSchemaBinding,
} from '@applik8s/client';
import type { ApplicationExecutionPrincipal, JsonObject } from '@applik8s/core';
import { applicationAITextAdapter } from '@applik8s/runtime-ai';
import {
  chat,
  combineStrategies,
  maxIterations,
} from '@tanstack/ai';

export interface ApplicationDeterministicAgentCase<
  TInput extends object,
  TOutput,
> {
  readonly instructions: string;
  readonly request: string;
  /**
   * Compiler-normalized operation identity and schemas. Evaluation workers
   * intentionally do not import a live model handle: doing so would retain
   * application assembly and provider registration inside the isolated worker.
   */
  readonly operation: {
    readonly id: string;
    readonly schemas: ApplicationOperationSchemaBinding<TInput, TOutput>;
  };
  readonly operationInput: TInput;
  readonly operationOutput: TOutput;
  readonly principal: ApplicationExecutionPrincipal;
  readonly maximumTurns: number;
  readonly maximumToolCalls: number;
}

export interface ApplicationDeterministicAgentCaseEvidence {
  readonly operationId: string;
  readonly invocationCount: number;
  readonly invokedInput: unknown;
  readonly providerToolCallId: string;
  readonly response: string;
}

/**
 * Executes one exact operation through the same TanStack agent loop and typed
 * operation adapter used by application.agent(...), while routing the effect
 * into an isolated receipt sink. This is a deterministic runtime-contract
 * gate: it proves agent-loop, schema, tool, and invocation wiring without
 * mutating product state or claiming to measure model quality.
 */
export async function executeApplicationDeterministicAgentCase<
  TInput extends object,
  TOutput,
>(
  options: ApplicationDeterministicAgentCase<TInput, TOutput>,
): Promise<ApplicationDeterministicAgentCaseEvidence> {
  if (!options.instructions.trim()) {
    throw new Error('Deterministic agent execution requires instructions.');
  }
  if (!options.request.trim()) {
    throw new Error('Deterministic agent execution requires a case request.');
  }
  if (!Number.isSafeInteger(options.maximumTurns) || options.maximumTurns < 1) {
    throw new Error('Deterministic agent execution requires a positive maximumTurns.');
  }
  if (
    !Number.isSafeInteger(options.maximumToolCalls)
    || options.maximumToolCalls < 1
  ) {
    throw new Error(
      'Deterministic agent execution requires a positive maximumToolCalls.',
    );
  }

  const invocations: {
    readonly operationId: string;
    readonly input: unknown;
    readonly providerToolCallId: string;
  }[] = [];
  const operation = createApplicationMutationOperation<TInput, TOutput>(
    {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: options.operation.id,
      model: 'EvaluationOperation',
      name: 'execute',
      operation: 'custom',
      transport: 'command',
      version: 'v1',
    },
    undefined,
    options.operation.schemas,
  );
  const adapter = applicationAITextAdapter({
    kind: 'deterministic',
    response: 'The isolated typed operation completed.',
    // typecast: the exact operation schema validates this structurally typed model input before the provider fixture crosses the JSON boundary.
    tool: { input: options.operationInput as unknown as JsonObject },
  });
  const tool = asTool(operation, {
    name: 'applik8s_evaluation_operation',
    needsApproval: false,
  });
  const response = await chat({
    adapter,
    messages: [{ role: 'user', content: options.request }],
    systemPrompts: [options.instructions],
    tools: [tool],
    stream: false,
    agentLoopStrategy: combineStrategies([
      maxIterations(options.maximumTurns),
      ({ toolCallCount }) => toolCallCount < options.maximumToolCalls,
    ]),
    context: {
      principal: options.principal,
      invocationId: `evaluation:${crypto.randomUUID()}`,
      attemptId: `evaluation-attempt:${crypto.randomUUID()}`,
      async invoke<TCandidateInput, TCandidateOutput>(
        candidate: ApplicationTanStackToolOperation<
          TCandidateInput,
          TCandidateOutput
        >,
        input: TCandidateInput,
        invocation: ApplicationTanStackToolInvocation,
      ) {
        if (candidate.operation.id !== operation.operation.id) {
          throw new Error(
            `Deterministic agent execution invoked unexpected operation ${candidate.operation.id}.`,
          );
        }
        invocations.push({
          operationId: candidate.operation.id,
          input,
          providerToolCallId: invocation.providerToolCallId,
        });
        // typecast: the isolated receipt sink returns the output already validated by the exact operation schema selected above.
        return options.operationOutput as unknown as TCandidateOutput;
      },
    },
  });
  const invocation = invocations[0];
  if (!invocation || invocations.length !== 1) {
    throw new Error(
      `Deterministic agent execution expected one typed operation invocation, observed ${invocations.length}.`,
    );
  }
  if (!response.trim()) {
    throw new Error(
      'Deterministic agent execution completed without a terminal response.',
    );
  }
  return Object.freeze({
    operationId: invocation.operationId,
    invocationCount: invocations.length,
    invokedInput: structuredClone(invocation.input),
    providerToolCallId: invocation.providerToolCallId,
    response,
  });
}
