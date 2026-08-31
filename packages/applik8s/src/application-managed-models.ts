// typecast-file-boundary: schema-generic managed-model facets retain their declaration-time types across erased application replay registries.
import type { JsonValue, SourceLocation } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import type { ApplicationQualifiedProviderToken } from './application-providers.js';
import {
  type ApplicationManagedModelStoreProvider,
  ManagedModelStore,
} from './application-providers.js';

export const applicationManagedModelProtocol = 'applik8s.managed-model/v1alpha1' as const;

export interface ApplicationManagedModelOptions<TStatus extends object> {
  readonly status: SchemaInput<TStatus>;
  readonly statusSchemaVersion?: string;
  readonly resync?: {
    readonly interval?: string;
    readonly maximumItems?: number;
  };
  readonly lease?: {
    readonly duration?: string;
  };
}

export interface ApplicationManagedModelMetadata {
  readonly uid: string;
  readonly generation: number;
  readonly resourceVersion: string;
  readonly createdAt: string;
  readonly deletionTimestamp?: string;
  readonly finalizers: readonly string[];
}

export interface ApplicationManagedModelCondition {
  readonly type: string;
  readonly status: 'True' | 'False' | 'Unknown';
  readonly observedGeneration: number;
  readonly reason: string;
  readonly message: string;
  readonly lastTransitionTime: string;
}

export interface ApplicationManagedModelConditionInput<TType extends string = string> {
  readonly type: TType;
  readonly status: 'True' | 'False' | 'Unknown';
  readonly reason: string;
  readonly message: string;
}

export interface ApplicationManagedModelWriteReceipt {
  readonly protocol: typeof applicationManagedModelProtocol;
  readonly uid: string;
  readonly generation: number;
  readonly resourceVersion: string;
  readonly fence: string;
  readonly committedAt: string;
}

export interface ApplicationManagedModelObject<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly id: TIdentity;
  readonly value: Readonly<TValue>;
  readonly metadata: ApplicationManagedModelMetadata;
  readonly status: {
    readonly current: Readonly<TStatus>;
    update(next: TStatus): Promise<ApplicationManagedModelWriteReceipt>;
  };
  readonly conditions: {
    readonly current: readonly ApplicationManagedModelCondition[];
    set<TType extends string>(
      next: ApplicationManagedModelConditionInput<TType>,
    ): Promise<ApplicationManagedModelWriteReceipt>;
    remove(type: string): Promise<ApplicationManagedModelWriteReceipt>;
  };
}

export interface ApplicationManagedModelRequeue {
  readonly kind: 'managedModelRequeue';
  readonly afterSeconds: number;
}

export interface ApplicationManagedModelReconcileContext {
  readonly protocol: typeof applicationManagedModelProtocol;
  readonly reconcileId: string;
  readonly fence: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly causalPrincipalId?: string;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  requeueAfter(duration: string): ApplicationManagedModelRequeue;
  throwIfCancelled(): void;
}

export type ApplicationManagedModelHandler<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> = (
  object: ApplicationManagedModelObject<TIdentity, TValue, TStatus>,
  context: ApplicationManagedModelReconcileContext,
// biome-ignore lint/suspicious/noConfusingVoidType: ordinary async TypeScript handlers infer Promise<void>; requiring authored `return undefined` would degrade the function-native API.
) => void | ApplicationManagedModelRequeue | Promise<void | ApplicationManagedModelRequeue>;

export interface ApplicationManagedModelFinalizerOptions<TName extends string = string> {
  readonly finalizer: TName;
}

export interface ApplicationManagedModelRegistration {
  readonly kind: 'applicationManagedModelRegistration';
  readonly model: string;
  readonly event: 'reconcile' | 'finalize';
  readonly finalizer?: string;
}

export interface ApplicationManagedModelLifecycleRegistrar<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  reconcile(
    handler: ApplicationManagedModelHandler<TIdentity, TValue, TStatus>,
  ): ApplicationManagedModelRegistration;
  finalize<const TFinalizer extends string>(
    handler: ApplicationManagedModelHandler<TIdentity, TValue, TStatus>,
    options: ApplicationManagedModelFinalizerOptions<TFinalizer>,
  ): ApplicationManagedModelRegistration;
}

export interface ApplicationManagedModelFacet<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly protocol: typeof applicationManagedModelProtocol;
  readonly status: SchemaInput<TStatus>;
  readonly statusSchemaVersion: string;
  readonly store: ApplicationQualifiedProviderToken<
    ApplicationManagedModelStoreProvider,
    string
  >;
  readonly on: ApplicationManagedModelLifecycleRegistrar<TIdentity, TValue, TStatus>;
}

/** @internal Registrar installed only by application.model(...) or app.crd(...). */
export interface ApplicationManagedModelRegistrar<
  TIdentity,
  TValue extends object,
> {
  register<TStatus extends object>(
    options: ApplicationManagedModelOptions<TStatus>,
  ): ApplicationManagedModelFacet<TIdentity, TValue, TStatus>;
}

export interface ApplicationManagedModelHandlerSource {
  readonly source: string;
  readonly dependencies?: { readonly source: string; readonly resolveDir: string };
  readonly location?: SourceLocation;
  readonly unresolved?: readonly string[];
}

export function managedModelStoreRequirement(
  modelName: string,
): ApplicationQualifiedProviderToken<ApplicationManagedModelStoreProvider, string> {
  const qualifier = modelName
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!qualifier) throw new Error(`Managed model ${JSON.stringify(modelName)} has no stable store qualifier.`);
  return ManagedModelStore.named(qualifier);
}

export function managedModelDurationSeconds(value: string, label: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new TypeError(`${label} must be a whole-number duration such as 30s, 5m, or 1h.`);
  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  const milliseconds = amount * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 0);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000) {
    throw new TypeError(`${label} must be at least 1s and remain within a safe integer range.`);
  }
  return milliseconds / 1_000;
}
