// typecast-file-boundary: profile transition planning validates schema-derived selections and graph identities before restoring transition contracts.

import type {
  ApplicationGraph,
  ApplicationProviderNode,
} from './application-graph.js';
import type {
  ApplicationProfileProviderSelectionContract,
  ApplicationProfileTransitionContract,
} from './application-profile.js';
import type { JsonObject, JsonValue } from './common.js';

export interface ApplicationProfileTransitionInstallation {
  readonly namespace: string;
  readonly name: string;
}

export interface ApplicationProfileTransitionPlanEntry {
  readonly profileId: string;
  readonly qualification: string;
  readonly from: string;
  readonly to: string;
  readonly transition: ApplicationProfileTransitionContract;
  readonly sourceImplementation: string;
  readonly destinationImplementation: string;
  readonly requiredAcknowledgement?: string;
}

export interface ApplicationProfileTransitionPlan {
  readonly apiVersion: 'applik8s.profileTransitionPlan/v1alpha1';
  readonly installation: ApplicationProfileTransitionInstallation;
  readonly mode: 'fresh' | 'unchanged' | 'transition';
  readonly entries: readonly ApplicationProfileTransitionPlanEntry[];
  readonly acknowledgements: readonly string[];
  /** Deterministic input that deployment backends include in plan identity. */
  readonly identityInput: JsonObject;
}

export interface PlanApplicationProfileTransitionsOptions {
  readonly graph: ApplicationGraph;
  readonly installation: ApplicationProfileTransitionInstallation;
  readonly previousInstallationSpec?: JsonObject;
  readonly desiredInstallationSpec: JsonObject;
  readonly acknowledgements?: readonly string[];
}

/** Plan a profile change without performing provider or Kubernetes effects. */
export function planApplicationProfileTransitions(
  options: PlanApplicationProfileTransitionsOptions,
): ApplicationProfileTransitionPlan {
  assertInstallation(options.installation);
  const selections = applicationProfileSelections(options.graph);
  const supplied = new Set(
    (options.acknowledgements ?? []).map((value) => value.trim()),
  );
  if (supplied.has('')) {
    throw new Error('Profile transition acknowledgements must not be empty.');
  }
  if (supplied.size !== (options.acknowledgements ?? []).length) {
    throw new Error('Profile transition acknowledgements must be distinct.');
  }

  if (!options.previousInstallationSpec) {
    if (supplied.size > 0) {
      throw new Error(
        'A fresh installation has no profile transition to acknowledge.',
      );
    }
    return profileTransitionPlan(options.installation, 'fresh', [], []);
  }

  const entries: ApplicationProfileTransitionPlanEntry[] = [];
  const consumed = new Set<string>();
  for (const selection of selections) {
    const from = profileVariant(
      options.previousInstallationSpec,
      selection,
      'previous',
    );
    const to = profileVariant(
      options.desiredInstallationSpec,
      selection,
      'desired',
    );
    if (from === to) continue;
    const transition = selection.transitions.find(
      (candidate) => candidate.from === from && candidate.to === to,
    );
    if (!transition) {
      throw new Error(
        `Profile provider ${selection.qualification.key} has no transition policy for ${from} -> ${to}.`,
      );
    }
    if (transition.kind === 'unsupported') {
      throw new Error(
        `Profile provider ${selection.qualification.key} does not support ${from} -> ${to}.`,
      );
    }
    const source = selection.branches.find((branch) => branch.variant === from);
    const destination = selection.branches.find(
      (branch) => branch.variant === to,
    );
    if (!source || !destination) {
      throw new Error(
        `Profile provider ${selection.qualification.key} cannot resolve both ${from} and ${to} branches.`,
      );
    }
    const requiredAcknowledgement = transition.destructive
      ? profileTransitionAcknowledgement(
          options.installation,
          selection,
          transition,
        )
      : undefined;
    if (requiredAcknowledgement && !supplied.has(requiredAcknowledgement)) {
      throw new Error(
        `Destructive profile transition ${selection.qualification.key} ${from} -> ${to} requires --acknowledge ${JSON.stringify(requiredAcknowledgement)}.`,
      );
    }
    if (requiredAcknowledgement) consumed.add(requiredAcknowledgement);
    entries.push(
      Object.freeze({
        profileId: selection.profileId,
        qualification: selection.qualification.key,
        from,
        to,
        transition,
        sourceImplementation: source.implementation,
        destinationImplementation: destination.implementation,
        ...(requiredAcknowledgement ? { requiredAcknowledgement } : {}),
      }),
    );
  }

  const stale = [...supplied].filter((value) => !consumed.has(value));
  if (stale.length > 0) {
    throw new Error(
      `Profile transition acknowledgements do not match this exact installation plan: ${stale.join(', ')}.`,
    );
  }
  return profileTransitionPlan(
    options.installation,
    entries.length === 0 ? 'unchanged' : 'transition',
    entries,
    [...consumed].sort(),
  );
}

export function profileTransitionAcknowledgement(
  installation: ApplicationProfileTransitionInstallation,
  selection: ApplicationProfileProviderSelectionContract,
  transition: ApplicationProfileTransitionContract,
): string {
  const acknowledgement = transition.acknowledgement?.trim();
  if (!transition.destructive || !acknowledgement) {
    throw new Error(
      `Profile provider ${selection.qualification.key} transition ${transition.from} -> ${transition.to} is not an acknowledgeable destructive transition.`,
    );
  }
  assertInstallation(installation);
  return [
    'profile-transition',
    installation.namespace,
    installation.name,
    selection.profileId,
    selection.qualification.key,
    `${transition.from}->${transition.to}`,
    acknowledgement,
  ].join('/');
}

function applicationProfileSelections(
  graph: ApplicationGraph,
): readonly ApplicationProfileProviderSelectionContract[] {
  const selections: ApplicationProfileProviderSelectionContract[] = [];
  const authorities = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'provider') continue;
    const selection = applicationProfileSelection(node);
    if (!selection) continue;
    const existing = authorities.get(selection.qualification.key);
    if (existing) {
      throw new Error(
        `Profile qualification ${selection.qualification.key} is provided by both ${existing} and ${node.id}.`,
      );
    }
    authorities.set(selection.qualification.key, node.id);
    selections.push(selection);
  }
  return Object.freeze(
    selections.sort((left, right) =>
      left.qualification.key.localeCompare(right.qualification.key),
    ),
  );
}

function applicationProfileSelection(
  node: ApplicationProviderNode,
): ApplicationProfileProviderSelectionContract | undefined {
  const profile = node.config?.profile;
  if (
    !profile
    || typeof profile !== 'object'
    || Array.isArray(profile)
    || Reflect.get(profile, 'apiVersion')
      !== 'applik8s.profileProvider/v1alpha1'
  ) {
    return undefined;
  }
  // typecast-boundary: graph validation owns the complete profile shape.
  return profile as unknown as ApplicationProfileProviderSelectionContract;
}

function profileVariant(
  spec: JsonObject,
  selection: ApplicationProfileProviderSelectionContract,
  side: 'previous' | 'desired',
): string {
  const value = valueAtPath(spec, selection.descriptor.discriminator);
  if (
    typeof value !== 'string'
    || !selection.descriptor.variants.includes(value)
  ) {
    throw new Error(
      `${side} installation profile ${selection.descriptor.discriminator} must be one of ${selection.descriptor.variants.join(', ')} for ${selection.profileId}.`,
    );
  }
  return value;
}

function valueAtPath(value: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue = value;
  for (const segment of path.split('.')) {
    if (
      !segment
      || !current
      || typeof current !== 'object'
      || Array.isArray(current)
    ) {
      return undefined;
    }
    // typecast-boundary: the null, primitive, and array branches were rejected
    // above; TypeScript does not narrow readonly JsonArray with Array.isArray.
    const next: JsonValue | undefined = (current as JsonObject)[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function profileTransitionPlan(
  installation: ApplicationProfileTransitionInstallation,
  mode: ApplicationProfileTransitionPlan['mode'],
  entries: readonly ApplicationProfileTransitionPlanEntry[],
  acknowledgements: readonly string[],
): ApplicationProfileTransitionPlan {
  const identityEntries = entries.map((entry) => ({
    profileId: entry.profileId,
    qualification: entry.qualification,
    from: entry.from,
    to: entry.to,
    kind: entry.transition.kind,
    destructive: entry.transition.destructive,
    authority: entry.transition.authority,
    drainDependents: entry.transition.drainDependents,
    rollback: entry.transition.rollback,
    sourceImplementation: entry.sourceImplementation,
    destinationImplementation: entry.destinationImplementation,
    ...(entry.requiredAcknowledgement
      ? { requiredAcknowledgement: entry.requiredAcknowledgement }
      : {}),
  }));
  return Object.freeze({
    apiVersion: 'applik8s.profileTransitionPlan/v1alpha1',
    installation: Object.freeze({ ...installation }),
    mode,
    entries: Object.freeze([...entries]),
    acknowledgements: Object.freeze([...acknowledgements]),
    identityInput: Object.freeze({
      apiVersion: 'applik8s.profileTransitionPlan/v1alpha1',
      installation: { ...installation },
      mode,
      entries: identityEntries,
      acknowledgements: [...acknowledgements],
    }),
  });
}

function assertInstallation(
  installation: ApplicationProfileTransitionInstallation,
): void {
  if (!installation.namespace.trim() || !installation.name.trim()) {
    throw new Error(
      'Profile transition planning requires an exact installation namespace and name.',
    );
  }
}
