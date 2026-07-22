import type {
  ApplicationDiagnosticContract,
  ApplicationWatchScope,
  ApplicationWatchScopeLoweringContract,
  HandlerRegistration,
  PermissionRule,
  ResourceWatchAddress,
} from '@applik8s/core';
import { apiGroupForApiVersion } from './application-identifiers.js';

type ApplicationWatchSubject = {
  readonly apiVersion: string;
  readonly kind: string;
};

export function applicationOperatorWatchScopeContracts(
  operatorName: string,
  handlers: readonly HandlerRegistration<object, object>[],
): readonly ApplicationWatchScopeLoweringContract[] {
  return handlers
    .filter((handler) => Boolean(handler.watch))
    .map((handler) => applicationWatchScopeLoweringContract(operatorName, handler));
}

function applicationWatchScopeLoweringContract(operatorName: string, handler: HandlerRegistration<object, object>): ApplicationWatchScopeLoweringContract {
  const watch = handler.watch;
  const subject = applicationWatchSubject(handler);
  if (!watch) {
    return applicationFailClosedWatchScopeContract({ kind: 'mixed', scopes: [] }, subject, 'MissingWatchScope', `Operator ${operatorName} handler ${handler.id} did not declare a watch scope.`);
  }
  const diagnostics = applicationWatchScopeDiagnostics(operatorName, handler, watch, subject);
  const scope = applicationWatchScopeForHandler(handler, watch, diagnostics.length > 0);
  return {
    scope,
    lowering: applicationWatchScopeLowering(scope),
    runtime: { mode: scope.kind === 'finite' || scope.kind === 'exact' ? 'directWatch' : 'sharedInformer', resyncPolicy: scope.kind === 'exact' ? 'none' : 'bounded', cancellation: 'onScopeRemoved' },
    permissions: diagnostics.length > 0 ? [] : applicationWatchScopePermissions(handler),
    failurePolicy: 'failClosed',
    diagnostics,
  };
}

function applicationWatchScopeForHandler(handler: HandlerRegistration<object, object>, watch: ResourceWatchAddress, hasDiagnostics: boolean): ApplicationWatchScope {
  const resource = handler.resource;
  if (hasDiagnostics) return { kind: 'mixed', scopes: [] };
  if (watch.names && watch.names.length > 0) {
    return { kind: 'finite', refs: watch.names.map((name) => ({ apiVersion: resource.apiVersion, kind: resource.kind, name, ...(watch.namespace ? { namespace: watch.namespace } : {}) })) };
  }
  if (watch.name) {
    return { kind: 'exact', ref: { apiVersion: resource.apiVersion, kind: resource.kind, name: watch.name, ...(watch.namespace ? { namespace: watch.namespace } : {}) } };
  }
  if (watch.fieldSelector) {
    return { kind: 'fieldSelector', apiVersion: resource.apiVersion, resourceKind: resource.kind, ...(watch.namespace ? { namespace: watch.namespace } : {}), fieldSelector: watch.fieldSelector };
  }
  const labels = watch.labelSelector?.matchLabels;
  if (labels && Object.keys(labels).length > 0) {
    return { kind: 'labelSelector', apiVersion: resource.apiVersion, resourceKind: resource.kind, ...(watch.namespace ? { namespace: watch.namespace } : {}), labels };
  }
  return { kind: 'mixed', scopes: [] };
}

function applicationWatchScopeDiagnostics(operatorName: string, handler: HandlerRegistration<object, object>, watch: ResourceWatchAddress, subject: ApplicationWatchSubject): readonly ApplicationDiagnosticContract[] {
  const diagnostics: ApplicationDiagnosticContract[] = [];
  if (watch.labelSelector?.matchExpressions && watch.labelSelector.matchExpressions.length > 0) {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'UnsupportedLabelSelectorExpression', `Operator ${operatorName} handler ${handler.id} uses label selector expressions, which are not lowered into v0.3 watch scopes yet.`));
  }
  if (watch.labelSelector && !watch.labelSelector.matchLabels && !watch.labelSelector.matchExpressions) {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'EmptyLabelSelector', `Operator ${operatorName} handler ${handler.id} uses an empty label selector.`));
  }
  if (watch.names && watch.names.length === 0) {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'EmptyFiniteWatchScope', `Operator ${operatorName} handler ${handler.id} uses an empty finite watch scope.`));
  }
  if (watch.fieldSelector !== undefined && watch.fieldSelector.trim() === '') {
    diagnostics.push(applicationWatchScopeDiagnostic(subject, 'EmptyFieldSelector', `Operator ${operatorName} handler ${handler.id} uses an empty field selector.`));
  }
  return diagnostics;
}

function applicationFailClosedWatchScopeContract(scope: ApplicationWatchScope, subject: ApplicationWatchSubject, reason: string, message: string): ApplicationWatchScopeLoweringContract {
  return { scope, lowering: applicationWatchScopeLowering(scope), permissions: [], failurePolicy: 'failClosed', diagnostics: [applicationWatchScopeDiagnostic(subject, reason, message)] };
}

function applicationWatchScopeDiagnostic(subject: ApplicationWatchSubject, reason: string, message: string): ApplicationDiagnosticContract {
  return { event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject, reason, message, likelyFix: 'Use exact names, finite instances, matchLabels, or a non-empty fieldSelector for v0.3 watch scopes.', retryable: false };
}

function applicationWatchScopePermissions(handler: HandlerRegistration<object, object>): readonly PermissionRule[] {
  if (handler.permissions && handler.permissions.length > 0) return handler.permissions;
  return [{ apiGroups: [apiGroupForApiVersion(handler.resource.apiVersion)], resources: [handler.resource.plural], verbs: ['get', 'list', 'watch'] }];
}

function applicationWatchScopeLowering(scope: ApplicationWatchScope): ApplicationWatchScopeLoweringContract['lowering'] {
  return scope.kind === 'labelSelector' ? 'labelSelector' : scope.kind === 'fieldSelector' ? 'fieldSelector' : scope.kind;
}

function applicationWatchSubject(handler: HandlerRegistration<object, object>): ApplicationWatchSubject {
  return { apiVersion: handler.resource.apiVersion, kind: handler.resource.kind };
}
