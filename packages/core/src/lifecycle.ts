import type { CompatibilityDecision, ManagedByMetadata, ObjectRef } from './common.js';
import type { ExternalEffectState } from './capability.js';
import type { BundleMetadata } from './manifest.js';

export interface LifecyclePlan { readonly action: import('./common.js').LifecycleAction; readonly fromBundle?: BundleMetadata; readonly toBundle?: BundleMetadata; readonly compatibility: CompatibilityReport; readonly domainDataPolicy: DomainDataPolicy; }
export interface CompatibilityReport { readonly decision: CompatibilityDecision; readonly runtimeCompatible: boolean; readonly handlerAbiCompatible: boolean; readonly crdVersionsCompatible: boolean; readonly storageVersionsCompatible: boolean; readonly externalEffectsCompatible: boolean; readonly diagnostics: readonly import('./common.js').Diagnostic[]; }
export interface DomainDataPolicy { readonly preserveCrds: boolean; readonly preserveInstances: boolean; readonly destructive: boolean; readonly requiresExplicitConfirmation: boolean; }
export interface ManagedObjectSnapshot { readonly ref: ObjectRef; readonly managedBy?: ManagedByMetadata; readonly generation?: number; readonly observedGeneration?: number; readonly storageVersion?: string; readonly externalEffects?: ExternalEffectState; }
