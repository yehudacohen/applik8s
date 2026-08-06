import type {
  Applik8sError,
  OperatorDefinition,
  Result,
} from '@applik8s/core';
import type {
  CompiledTypeKroComposition,
  TypeKroCompositionResource,
} from './index.js';

type ResourceSerializer = (
  resource: unknown,
  index: number,
) => TypeKroCompositionResource;

export function portableOperatorDefinition(
  operator: OperatorDefinition,
): OperatorDefinition {
  // Operator definitions intentionally retain executable handlers here. The
  // static dispatcher owns closure capture and serializes the remaining graph.
  return operator;
}

export function compiledTypeKroComposition(
  value: unknown,
  serialize: ResourceSerializer,
): Result<CompiledTypeKroComposition> {
  try {
    const resources = rawCompositionResources(value);
    // Validate the complete boundary now, while retaining TypeKro's callable
    // composition object and its factory/plan methods for artifact emission.
    resources.forEach(serialize);
    if (
      value
      && (typeof value === 'object' || typeof value === 'function')
      && Array.isArray(Reflect.get(value, 'resources'))
    ) {
      // Preserving the callable object retains TypeKro's deployment machinery.
      // typecast: its reflected resources array was structurally validated above.
      return { ok: true, value: value as CompiledTypeKroComposition };
    }
    return {
      ok: true,
      value: {
        resources: resources.map(serialize),
      },
    };
  } catch (cause) {
    return error(
      cause instanceof Error
        ? cause.message
        : 'Resolved TypeKro composition has an invalid resource shape.',
    );
  }
}

export function compositionResources(
  composition: CompiledTypeKroComposition,
  serialize: ResourceSerializer,
): readonly TypeKroCompositionResource[] {
  return composition.resources.map((resource, index) =>
    serialize(resource, index),
  );
}

function rawCompositionResources(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (
    value
    && (typeof value === 'object' || typeof value === 'function')
  ) {
    const resources = Reflect.get(value, 'resources');
    if (Array.isArray(resources)) return resources;
  }
  throw new Error(
    'Resolved TypeKro composition must be an array of Kubernetes resources or an object with a resources array.',
  );
}

function error<T = never>(message: string): Result<T> {
  const diagnostic: Applik8sError = {
    code: 'BUNDLE_INVALID',
    message,
    severity: 'error',
    context: {},
    recovery: { summary: message },
  };
  return { ok: false, error: diagnostic };
}
