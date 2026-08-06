// typecast-file-boundary: resource-specific SDK handler generics are erased only while assembling one heterogeneous operator registry and restored by each retained registration.
import type { CapabilityDescriptor, HandlerRegistration, ResourceDefinition } from '@applik8s/core';
import { sdk } from '@applik8s/sdk';
import { expandApplicationCallbackDependencies } from './application-callback.js';
import type {
  ApplicationResourceControllerOptions,
  ApplicationResourceEventOperatorController,
} from './application-events.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import { applicationTypeKroString } from './application-typekro-values.js';
import { applicationWorkflowGatewayBindingMetadata } from './application-workflows.js';

export function createApplicationResourceEventOperatorController<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  registrationsInput: readonly HandlerRegistration<TSpec, TStatus>[],
  callbacksInput: readonly unknown[],
  options: ApplicationResourceControllerOptions,
): ApplicationResourceEventOperatorController {
  if (registrationsInput.length === 0) {
    throw new Error(`Application controller for ${resource.kind} requires at least one lifecycle handler.`);
  }
  const {
    name,
    permissions,
    reads,
    secondaryWatches,
    ...authoredDeployment
  } = options;
  const deployment = authoredDeployment.namespace
    ? { ...authoredDeployment, namespace: applicationTypeKroString(authoredDeployment.namespace) }
    : authoredDeployment;
  // typecast: the operator owns a heterogeneous registration array; each entry still retains its resource-specific runtime metadata.
  const registrations: HandlerRegistration<object, object>[] = (
    registrationsInput as readonly HandlerRegistration<object, object>[]
  ).map((registration) => withApplicationResourceControllerAuthority(resource, registration));
  const callbacks = [...callbacksInput];
  const operatorName = name ?? `${kubernetesNameSegment(resource.kind)}-controller`;
  const namespace = typeof deployment.namespace === 'string' ? deployment.namespace : undefined;
  const serviceAccount = deployment.serviceAccountName ?? `${operatorName}-controller`;
  const resolvedSecondaryWatches = typeof secondaryWatches === 'function'
    ? secondaryWatches(resource)
    : secondaryWatches;
  const capabilities: Record<string, CapabilityDescriptor> = {
    ...resourceWorkflowGatewayCapabilities(callbacks, namespace, serviceAccount, operatorName),
  };
  const operator = sdk.operator({
    name: operatorName,
    resources: { [resource.kind]: resource },
    ...(reads ? { reads } : {}),
    handlers: registrations,
    ...(resolvedSecondaryWatches
      ? { secondaryWatches: resolvedSecondaryWatches }
      : {}),
    capabilities,
    ...(permissions && permissions.length > 0 ? { permissions } : {}),
    ...(Object.keys(deployment).length > 0 ? { deployment } : {}),
  });
  const deployed = operator(deployment);
  return {
    operator,
    deployed,
    add(registration, callback) {
      registrations.push(withApplicationResourceControllerAuthority(resource, registration));
      callbacks.push(callback);
      const refreshed = resourceWorkflowGatewayCapabilities(callbacks, namespace, serviceAccount, operatorName);
      for (const capability of Object.keys(capabilities)) delete capabilities[capability];
      Object.assign(capabilities, refreshed);
    },
  };
}

/**
 * Tracking can be reached through arbitrary helpers, so its bounded
 * cancellation finalizer authority cannot be inferred by callback execution.
 * The inferred controller receives only its own resource patch/finalize rules.
 */
function withApplicationResourceControllerAuthority<TSpec extends object, TStatus extends object>(
  resource: Pick<ResourceDefinition<object, object>, 'permissions'>,
  registration: HandlerRegistration<TSpec, TStatus>,
): HandlerRegistration<TSpec, TStatus> {
  return {
    ...registration,
    permissions: [
      ...(registration.permissions ?? []),
      resource.permissions.patch(),
      resource.permissions.finalize(),
    ],
  };
}

function resourceWorkflowGatewayCapabilities(
  callbacks: readonly unknown[],
  operatorNamespace: string | undefined,
  serviceAccount: string,
  operatorName: string,
): Readonly<Record<string, CapabilityDescriptor>> {
  const dependencies = expandApplicationCallbackDependencies({ calls: callbacks }).calls;
  const grouped = new Map<string, NonNullable<ReturnType<typeof applicationWorkflowGatewayBindingMetadata>>[]>();
  for (const dependency of dependencies) {
    const metadata = applicationWorkflowGatewayBindingMetadata(dependency);
    if (!metadata) continue;
    grouped.set(metadata.capability, [...(grouped.get(metadata.capability) ?? []), metadata]);
  }
  const descriptors: Record<string, CapabilityDescriptor> = {};
  for (const [capability, entries] of grouped) {
    const first = entries[0];
    if (!first) continue;
    if (entries.some((entry) =>
      entry.worker !== first.worker || entry.port !== first.port || entry.namespace !== first.namespace)) {
      throw new Error(`Resource handler workflow gateway ${capability} resolves to conflicting worker authority.`);
    }
    const namespace = first.namespace ?? operatorNamespace;
    if (!namespace) {
      throw new Error(`Resource handler calls workflow ${first.contract}, but its operator and WorkflowEngine do not declare a concrete shared namespace.`);
    }
    if (operatorNamespace && namespace !== operatorNamespace) {
      throw new Error(`Resource handler workflow gateway ${capability} is in namespace ${namespace}, but the operator is deployed in ${operatorNamespace}. Cross-namespace workflow gateways are intentionally unsupported.`);
    }
    descriptors[capability] = {
      name: capability,
      kind: 'http',
      endpoint: `http://${first.worker}.${namespace}.svc:${first.port}`,
      auth: { type: 'serviceAccount' },
      workflowGateway: {
        protocol: 'applik8s.workflow-gateway/v1alpha1',
        worker: first.worker,
        contracts: [...new Set(entries.map((entry) => entry.contract))].sort(),
        caller: { operator: operatorName, namespace, serviceAccount },
      },
      policy: {
        timeoutMs: 15_000,
        retry: { maxAttempts: 3, backoffMs: 250, maxBackoffMs: 2_000 },
        idempotencyKeyRequired: true,
        failureMode: 'rejectPromiseWithApplik8sError',
      },
      execution: {
        liveExecution: 'hostProtocol',
        protocol: 'applik8s.capability/v1alpha1',
        audit: { recordRequests: true, recordResponses: false, includePayloads: false },
        redaction: {
          requestBody: 'redacted',
          responseBody: 'redacted',
          headers: 'redacted',
          errors: 'publicMessageOnly',
        },
        idempotency: { requiredForMutations: true, keySource: 'handlerProvided' },
      },
      sensitive: true,
    };
  }
  return descriptors;
}
