import { createHash } from 'node:crypto';
import {
  getApplicationOperationContract,
  isApplicationBoundOperation,
  isApplicationScopedOperation,
  type ApplicationBoundOperation,
  type ApplicationOperationLike,
  type ApplicationPermissionDefinition,
  type ApplicationScopedOperation,
} from '@applik8s/client';
import {
  applicationOperationId,
  intersectApplicationScopes,
  type ApplicationAuthorityManifestNode,
  type ApplicationIdentityReference,
  type ApplicationOperationId,
  type ApplicationOutcomeDefinition,
  type ApplicationScopeExpression,
  type ApplicationStaticAuthorityManifest,
  type ApplicationStaticGrantDefinition,
  type ApplicationStaticPermissionDefinition,
} from '@applik8s/core';
import type { ApplicationGraphState } from './application-graph-state.js';

export interface ApplicationPermissionBinding extends ApplicationPermissionDefinition {
  readonly kind: 'applicationPermission';
  readonly name: string;
  readonly declarations: readonly ApplicationStaticPermissionDefinition[];
}

export type ApplicationAuthoritySelection =
  | ApplicationOperationLike
  | ApplicationScopedOperation<ApplicationOperationLike, unknown>
  | ApplicationBoundOperation<ApplicationOperationLike, string, 'input' | 'event' | 'resource'>
  | ApplicationPermissionBinding;

export interface ApplicationServiceIdentityBinding {
  readonly kind: 'applicationServiceIdentity';
  readonly name: string;
  readonly identity: ApplicationIdentityReference;
  can(...selections: readonly ApplicationAuthoritySelection[]): ApplicationServiceIdentityBinding;
}

export interface ApplicationOutcomeBinding {
  readonly kind: 'applicationOutcome';
  readonly definition: ApplicationOutcomeDefinition;
}

export interface ApplicationOutcomeOptions {
  readonly subjectModel: string;
  readonly observe: ApplicationOperationLike;
  readonly accepts: ApplicationScopeExpression;
  readonly verifier: ApplicationServiceIdentityBinding;
  readonly timeoutSeconds: number;
  readonly failure?: ApplicationOutcomeDefinition['failure'];
}

export interface ApplicationAuthorityRegistrar {
  serviceIdentity(name: string): ApplicationServiceIdentityBinding;
  permission(name: string, ...selections: readonly Exclude<ApplicationAuthoritySelection, ApplicationPermissionBinding>[]): ApplicationPermissionBinding;
  outcome(name: string, options: ApplicationOutcomeOptions): ApplicationOutcomeBinding;
}

export interface ApplicationAuthorityGraphState extends ApplicationGraphState {
  readonly authorityApplicationName: string;
}

export function applicationAuthorityRegistrar(
  state: ApplicationAuthorityGraphState,
): ApplicationAuthorityRegistrar {
  return {
    serviceIdentity(name) {
      const normalized = authorityName(name, 'service identity');
      const identity: ApplicationIdentityReference = Object.freeze({
        id: `identity:${state.authorityApplicationName}:service:${normalized}`,
        kind: 'service',
        issuer: `applik8s://${state.authorityApplicationName}`,
        subject: normalized,
      });
      updateManifest(state, (manifest) => ({
        ...manifest,
        identities: uniqueBy([...manifest.identities, identity], (candidate) => candidate.id),
      }));
      const binding: ApplicationServiceIdentityBinding = {
        kind: 'applicationServiceIdentity',
        name: normalized,
        identity,
        can(...selections) {
          if (selections.length === 0) {
            throw new Error(`Application service identity ${normalized}.can(...) requires at least one operation or permission.`);
          }
          const declarations = selections.flatMap((selection, index) =>
            isPermissionBinding(selection)
              ? selection.declarations
              : [selectionPermission(
                  state.authorityApplicationName,
                  `identity-${normalized}-${index}`,
                  selection,
                )]);
          for (const declaration of declarations) classifySelection(selections, declaration);
          const grants = declarations.map((declaration): ApplicationStaticGrantDefinition => ({
            id: `grant:${state.authorityApplicationName}:${normalized}:${declaration.id}`,
            identity,
            permissionId: declaration.id,
            operationIds: declaration.operationIds,
            scope: declaration.scope,
            ...(declaration.audiences ? { audiences: declaration.audiences } : {}),
            ...(declaration.transports ? { transports: declaration.transports } : {}),
            issuedBy: applicationIdentity(state.authorityApplicationName),
            reason: `Static authority assigned by ${state.authorityApplicationName}.`,
          }));
          updateManifest(state, (manifest) => ({
            ...manifest,
            identities: uniqueBy(
              [...manifest.identities, identity, applicationIdentity(state.authorityApplicationName)],
              (candidate) => candidate.id,
            ),
            permissions: uniqueCompatible(
              manifest.permissions,
              declarations,
              (candidate) => candidate.id,
              'permission',
            ),
            grants: uniqueCompatible(
              manifest.grants,
              grants,
              (candidate) => candidate.id,
              'grant',
            ),
          }));
          return binding;
        },
      };
      return Object.freeze(binding);
    },
    permission(name, ...selections) {
      const normalized = authorityName(name, 'permission');
      if (selections.length === 0) {
        throw new Error(`Application permission ${normalized} requires at least one operation selection.`);
      }
      const declarations = selections.map((selection, index) =>
        selectionPermission(state.authorityApplicationName, `${normalized}-${index}`, selection));
      for (const [index, declaration] of declarations.entries()) {
        classifyOperation(selections[index], declaration);
      }
      updateManifest(state, (manifest) => ({
        ...manifest,
        permissions: uniqueCompatible(
          manifest.permissions,
          declarations,
          (candidate) => candidate.id,
          'permission',
        ),
      }));
      return Object.freeze({
        kind: 'applicationPermission',
        id: `permission:${state.authorityApplicationName}:${normalized}`,
        name: normalized,
        declarations: Object.freeze(declarations),
      });
    },
    outcome(name, options) {
      const normalized = authorityName(name, 'outcome');
      const contract = getApplicationOperationContract(options.observe);
      if (!contract) throw new Error(`Application outcome ${normalized} observe must be an application operation handle.`);
      if (!Number.isSafeInteger(options.timeoutSeconds) || options.timeoutSeconds < 1) {
        throw new Error(`Application outcome ${normalized} timeoutSeconds must be a positive integer.`);
      }
      const definition: ApplicationOutcomeDefinition = {
        apiVersion: 'applik8s.outcome/v1alpha1',
        id: `outcome:${state.authorityApplicationName}:${normalized}`,
        name: normalized,
        subjectModel: authorityName(options.subjectModel, 'outcome subject model'),
        verifier: options.verifier.identity,
        observationOperationId: canonicalOperationId(contract),
        predicate: options.accepts,
        timeoutSeconds: options.timeoutSeconds,
        failure: options.failure ?? 'escalate',
      };
      updateManifest(state, (manifest) => ({
        ...manifest,
        identities: uniqueBy(
          [...manifest.identities, options.verifier.identity],
          (candidate) => candidate.id,
        ),
        outcomes: uniqueCompatible(
          manifest.outcomes,
          [definition],
          (candidate) => candidate.id,
          'outcome',
        ),
      }));
      return Object.freeze({ kind: 'applicationOutcome', definition });
    },
  };
}

function selectionPermission(
  application: string,
  name: string,
  selection: Exclude<ApplicationAuthoritySelection, ApplicationPermissionBinding>,
): ApplicationStaticPermissionDefinition {
  const normalized = normalizedSelection(selection);
  return {
    id: `permission:${application}:${name}:${digest(normalized).slice(0, 16)}`,
    name,
    operationIds: [normalized.operationId],
    scope: normalized.scope,
    ...(normalized.transports ? { transports: normalized.transports } : {}),
    ...(normalized.audiences ? { audiences: normalized.audiences } : {}),
    grantable: normalized.grantable,
  };
}

function normalizedSelection(
  selection: Exclude<ApplicationAuthoritySelection, ApplicationPermissionBinding>,
): {
  readonly operationId: ApplicationOperationId;
  readonly scope: ApplicationScopeExpression;
  readonly transports?: readonly import('@applik8s/core').ApplicationOperationTransport[];
  readonly audiences?: readonly string[];
  readonly grantable: boolean;
} {
  const operation = isApplicationScopedOperation(selection) || isApplicationBoundOperation(selection)
    ? selection.operation
    : selection;
  const contract = getApplicationOperationContract(operation);
  if (!contract) throw new Error('Application authority selections must be operation handles or their typed scopes.');
  const authority = operation.authority;
  const scoped = isApplicationScopedOperation(selection) || isApplicationBoundOperation(selection)
    ? intersectApplicationScopes(selection.target, ...selection.predicates)
    : authority.scope;
  return {
    operationId: canonicalOperationId(contract),
    scope: scoped,
    ...(authority.transports ? { transports: authority.transports } : {}),
    ...(authority.audiences ? { audiences: authority.audiences } : {}),
    grantable: authority.grantable,
  };
}

function classifySelection(
  selections: readonly ApplicationAuthoritySelection[],
  declaration: ApplicationStaticPermissionDefinition,
): void {
  for (const selection of selections) {
    if (isPermissionBinding(selection)
      ? selection.declarations.some((candidate) => candidate.id === declaration.id)
      : normalizedSelection(selection).operationId === declaration.operationIds[0]) {
      classifyOperation(selection, declaration);
    }
  }
}

function classifyOperation(
  selection: ApplicationAuthoritySelection | undefined,
  declaration: ApplicationStaticPermissionDefinition,
): void {
  if (!selection || isPermissionBinding(selection)) return;
  const operation = isApplicationScopedOperation(selection) || isApplicationBoundOperation(selection)
    ? selection.operation
    : selection;
  const requires = Reflect.get(operation as object, 'requires');
  if (typeof requires !== 'function') {
    throw new Error(`Application operation ${declaration.operationIds[0]} does not expose its authorizable facet.`);
  }
  Reflect.apply(requires, operation, [{ id: declaration.id }]);
}

function updateManifest(
  state: ApplicationAuthorityGraphState,
  update: (manifest: ApplicationStaticAuthorityManifest) => ApplicationStaticAuthorityManifest,
): void {
  const id = 'authority-manifest.application';
  const existingIndex = state.graphNodes.findIndex((node) => node.id === id);
  const existing = existingIndex >= 0 ? state.graphNodes[existingIndex] : undefined;
  const manifest = existing?.kind === 'authorityManifest'
    ? existing.manifest
    : emptyManifest(state.authorityApplicationName);
  const updated = withManifestRevision(update(manifest));
  const node: ApplicationAuthorityManifestNode = {
    id,
    kind: 'authorityManifest',
    name: 'application-authority',
    stability: 'stable',
    manifest: updated,
  };
  if (existingIndex >= 0) state.graphNodes[existingIndex] = node;
  else state.graphNodes.push(node);
  state.onChange?.();
}

function emptyManifest(application: string): ApplicationStaticAuthorityManifest {
  return {
    apiVersion: 'applik8s.authorityManifest/v1alpha1',
    application,
    revision: 'sha256:empty',
    identities: [applicationIdentity(application)],
    permissions: [],
    roles: [],
    grants: [],
    outcomes: [],
  };
}

function withManifestRevision(manifest: ApplicationStaticAuthorityManifest): ApplicationStaticAuthorityManifest {
  return Object.freeze({
    ...manifest,
    revision: `sha256:${digest({
      application: manifest.application,
      identities: manifest.identities,
      permissions: manifest.permissions,
      roles: manifest.roles,
      grants: manifest.grants,
      outcomes: manifest.outcomes,
    })}`,
  });
}

function applicationIdentity(application: string): ApplicationIdentityReference {
  return {
    id: `identity:${application}:application`,
    kind: 'service',
    issuer: `applik8s://${application}`,
    subject: 'application-authority',
  };
}

function operationId(value: string): ApplicationOperationId {
  if (!value.startsWith('applik8s://')) {
    throw new Error(`Application authority operation ${value} has no canonical applik8s:// identity.`);
  }
  return value as ApplicationOperationId;
}

function canonicalOperationId(
  contract: ReturnType<typeof getApplicationOperationContract> & object,
): ApplicationOperationId {
  if (contract.id.startsWith('applik8s://')) return operationId(contract.id);
  return applicationOperationId({
    domain: contract.transport === 'query' ? 'queries' : 'models',
    owner: contract.model,
    operation: contract.name,
  });
}

function authorityName(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /[\s?#]/.test(normalized)) {
    throw new Error(`Application ${label} must be a non-empty stable name without whitespace, ?, or #.`);
  }
  return normalized;
}

function isPermissionBinding(value: ApplicationAuthoritySelection): value is ApplicationPermissionBinding {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'applicationPermission');
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const result = new Map<string, T>();
  for (const value of values) result.set(key(value), value);
  return [...result.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

function uniqueCompatible<T>(
  existing: readonly T[],
  added: readonly T[],
  key: (value: T) => string,
  label: string,
): readonly T[] {
  const result = new Map(existing.map((value) => [key(value), value]));
  for (const value of added) {
    const prior = result.get(key(value));
    if (prior && stable(prior) !== stable(value)) {
      throw new Error(`Application authority ${label} ${key(value)} is declared with incompatible definitions.`);
    }
    result.set(key(value), value);
  }
  return [...result.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

function digest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(',')}}`;
}
