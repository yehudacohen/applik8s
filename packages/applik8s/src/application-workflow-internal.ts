import type { SchemaInput } from '@applik8s/sdk';

/**
 * Internal provider/compiler descriptor for a durable workflow step.
 *
 * Application authors declare ordinary closures and workflows. This shape
 * remains internal so runtimes can lower those closures to provider tasks
 * without exposing a second public authoring abstraction.
 */
export interface ApplicationWorkflowTaskDefinition<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly kind: 'applik8sTask';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
  readonly errors: {
    readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]>;
  };
}
