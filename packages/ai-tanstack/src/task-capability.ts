// typecast-file-boundary: TanStack AI's erased middleware/tool contracts are narrowed through runtime shape checks before wrapping and returned with their original generic tool identities.
import type { ApplicationAIModelDefinition } from '@applik8s/ai';
import type { AnyTextAdapter, ChatMiddleware } from '@tanstack/ai';

export interface ApplicationTanStackTaskExecution {
  readonly operationId: string;
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly signal: AbortSignal;
}

export interface ApplicationTanStackTaskContext
  extends ApplicationTanStackTaskExecution {
  readonly applik8s: { readonly persistenceMiddleware: ChatMiddleware };
}

/** Handler-safe native TanStack capability bound to one admitted task. */
export interface ApplicationTanStackTaskCapability {
  readonly context: ApplicationTanStackTaskContext;
  adapter(model: ApplicationAIModelDefinition): AnyTextAdapter;
}

export interface ApplicationTanStackTaskEffectExecution {
  readonly id: string;
  readonly name: string;
}

export type ApplicationTanStackTaskEffectExecutionScope = (
  execution: ApplicationTanStackTaskEffectExecution,
  invoke: () => Promise<unknown>,
) => Promise<unknown>;

export function createApplicationTanStackTaskCapability(options: {
  readonly persistenceMiddleware: ChatMiddleware;
  readonly execution: ApplicationTanStackTaskExecution;
  readonly adapter: (model: ApplicationAIModelDefinition) => AnyTextAdapter;
  readonly runTaskEffect?: ApplicationTanStackTaskEffectExecutionScope;
}): ApplicationTanStackTaskCapability {
  if (!options.persistenceMiddleware || typeof options.persistenceMiddleware !== 'object') {
    throw new TypeError('Native TanStack task capability requires persistence middleware.');
  }
  if (typeof options.adapter !== 'function') {
    throw new TypeError('Native TanStack task capability requires a model adapter resolver.');
  }
  const operationId = required(options.execution.operationId, 'operationId');
  const invocationId = required(options.execution.invocationId, 'invocationId');
  const idempotencyKey = required(options.execution.idempotencyKey, 'idempotencyKey');
  if (!Number.isSafeInteger(options.execution.attempt) || options.execution.attempt < 1) {
    throw new TypeError('Native TanStack task capability attempt must be a positive integer.');
  }
  const persistenceMiddleware = options.runTaskEffect
    ? withApplicationTanStackTaskToolExecution(
        options.persistenceMiddleware,
        options.runTaskEffect,
      )
    : options.persistenceMiddleware;
  const context = Object.freeze({
    ...options.execution,
    operationId,
    invocationId,
    idempotencyKey,
    applik8s: Object.freeze({ persistenceMiddleware }),
  });
  return Object.freeze({
    context,
    adapter(model: ApplicationAIModelDefinition) {
      if (model.apiVersion !== 'applik8s.aiModel/v1alpha1' || !model.name.trim()) {
        throw new TypeError('Native TanStack task capability requires an AI.model(...) definition.');
      }
      return options.adapter(model);
    },
  });
}

/** Wrap every native server-tool execution in one framework effect scope. */
export function withApplicationTanStackTaskToolExecution(
  persistenceMiddleware: ChatMiddleware,
  run: ApplicationTanStackTaskEffectExecutionScope,
): ChatMiddleware {
  if (typeof run !== 'function') {
    throw new TypeError('Native TanStack task tool execution requires a scope function.');
  }
  const wrapped = new WeakMap<object, object>();
  const wrap = (tool: object): object => {
    const existing = wrapped.get(tool);
    if (existing) return existing;
    const execute = Reflect.get(tool, 'execute');
    if (typeof execute !== 'function') return tool;
    const next = {
      ...tool,
      execute: async (...args: readonly unknown[]) => {
        const rawCall = args[1];
        const call = typeof rawCall === 'object' && rawCall !== null
          ? rawCall as Record<string, unknown>
          : {};
        const id = required(
          typeof call.toolCallId === 'string' ? call.toolCallId : undefined,
          'toolCallId',
        );
        const name = required(
          typeof call.toolName === 'string'
            ? call.toolName
            : typeof Reflect.get(tool, 'name') === 'string'
              ? Reflect.get(tool, 'name') as string
              : undefined,
          'toolName',
        );
        return run({ id, name }, () =>
          Promise.resolve(Reflect.apply(execute, tool, args)));
      },
    };
    wrapped.set(tool, next);
    return next;
  };
  const middleware: ChatMiddleware = {
    ...persistenceMiddleware,
    async onConfig(context, config) {
      const transformed = await persistenceMiddleware.onConfig?.(context, config);
      const effective = transformed ? { ...config, ...transformed } : config;
      return {
        ...(transformed ?? {}),
        tools: effective.tools.map((tool) =>
          wrap(tool as unknown as object) as typeof tool),
      };
    },
  };
  return Object.freeze(middleware);
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized !== value) {
    throw new TypeError(`Native TanStack task capability ${name} is required.`);
  }
  return normalized;
}
