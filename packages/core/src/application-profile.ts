import type { JsonObject } from './common.js';

export interface ApplicationProviderQualificationContract {
  readonly apiVersion: 'applik8s.providerQualification/v1alpha1';
  readonly capability: string;
  readonly name: string;
  readonly compatibilityRevision: string;
  readonly key: `${string}@${string}:${string}`;
}

export interface ApplicationProfileDescriptor {
  readonly apiVersion: 'applik8s.profile/v1alpha1';
  readonly id: string;
  readonly application: string;
  readonly discriminator: string;
  readonly schemaRevision: string;
  readonly variants: readonly string[];
  readonly installationIdentity: string;
}

export type ApplicationProfileTransitionKind =
  | 'in-place'
  | 'replicate-cutover'
  | 'export-import'
  | 'replace'
  | 'unsupported';

export interface ApplicationProfileTransitionContract {
  readonly from: string;
  readonly to: string;
  readonly kind: ApplicationProfileTransitionKind;
  readonly destructive: boolean;
  readonly acknowledgement?: string;
  readonly authority: 'source-until-cutover' | 'destination-after-validation' | 'external';
  readonly drainDependents: boolean;
  readonly rollback: 'automatic' | 'manual' | 'unsupported';
}

export interface ApplicationProfileProviderBranch {
  readonly variant: string;
  readonly implementation: string;
  readonly config?: JsonObject;
  readonly credentialReferences: readonly string[];
  readonly resources: readonly string[];
  readonly provenance: 'application' | 'start-default' | 'application-override';
}

export interface ApplicationProfileProviderSelectionContract {
  readonly apiVersion: 'applik8s.profileProvider/v1alpha1';
  readonly profileId: string;
  readonly descriptor: ApplicationProfileDescriptor;
  readonly qualification: ApplicationProviderQualificationContract;
  readonly branches: readonly ApplicationProfileProviderBranch[];
  readonly transitions: readonly ApplicationProfileTransitionContract[];
  readonly selectedBy: string;
  readonly inactiveBranches: 'plan-only';
}

export function validateApplicationProfileDescriptor(
  descriptor: ApplicationProfileDescriptor,
): readonly string[] {
  const diagnostics: string[] = [];
  if (!descriptor.id.trim() || !descriptor.application.trim()) {
    diagnostics.push('Application profile requires stable id and application identity.');
  }
  if (!descriptor.discriminator.trim()) {
    diagnostics.push(`Application profile ${descriptor.id} requires a discriminator path.`);
  }
  if (!descriptor.schemaRevision.trim()) {
    diagnostics.push(`Application profile ${descriptor.id} requires a schema revision.`);
  }
  const variants = descriptor.variants.map((variant) => variant.trim());
  if (variants.length < 2 || variants.some((variant) => !variant)) {
    diagnostics.push(`Application profile ${descriptor.id} requires at least two non-empty variants.`);
  }
  if (new Set(variants).size !== variants.length) {
    diagnostics.push(`Application profile ${descriptor.id} contains duplicate variants.`);
  }
  return diagnostics;
}

export function validateApplicationProfileProviderSelection(
  selection: ApplicationProfileProviderSelectionContract,
  descriptor: ApplicationProfileDescriptor,
): readonly string[] {
  const diagnostics: string[] = [];
  if (selection.profileId !== descriptor.id) {
    diagnostics.push(
      `Profile provider ${selection.qualification.key} belongs to ${selection.profileId}, not ${descriptor.id}.`,
    );
  }
  const branchVariants = new Set(selection.branches.map((branch) => branch.variant));
  const missing = descriptor.variants.filter((variant) => !branchVariants.has(variant));
  const extra = [...branchVariants].filter((variant) => !descriptor.variants.includes(variant));
  if (missing.length > 0) {
    diagnostics.push(
      `Profile provider ${selection.qualification.key} is missing variants: ${missing.join(', ')}.`,
    );
  }
  if (extra.length > 0) {
    diagnostics.push(
      `Profile provider ${selection.qualification.key} contains unknown variants: ${extra.join(', ')}.`,
    );
  }
  if (selection.branches.some((branch) => !branch.implementation.trim())) {
    diagnostics.push(
      `Profile provider ${selection.qualification.key} has a branch without an implementation identity.`,
    );
  }
  const transitionPairs = new Set<string>();
  for (const transition of selection.transitions) {
    const pair = `${transition.from}\u0000${transition.to}`;
    if (
      transition.from === transition.to
      || !descriptor.variants.includes(transition.from)
      || !descriptor.variants.includes(transition.to)
    ) {
      diagnostics.push(
        `Profile provider ${selection.qualification.key} has invalid transition ${transition.from} -> ${transition.to}.`,
      );
    }
    if (transitionPairs.has(pair)) {
      diagnostics.push(
        `Profile provider ${selection.qualification.key} duplicates transition ${transition.from} -> ${transition.to}.`,
      );
    }
    transitionPairs.add(pair);
    if (transition.destructive && !transition.acknowledgement?.trim()) {
      diagnostics.push(
        `Profile provider ${selection.qualification.key} destructive transition ${transition.from} -> ${transition.to} requires acknowledgement.`,
      );
    }
  }
  for (const from of descriptor.variants) {
    for (const to of descriptor.variants) {
      if (from !== to && !transitionPairs.has(`${from}\u0000${to}`)) {
        diagnostics.push(
          `Profile provider ${selection.qualification.key} has no transition policy for ${from} -> ${to}.`,
        );
      }
    }
  }
  return diagnostics;
}
