import {
  type ApplicationWorkflowInvocationMetadata,
  applicationWorkflowCausalPrincipalMetadata,
  applicationWorkflowProviderAdmissionMetadata,
  applicationWorkflowTelemetryMetadata,
} from '@applik8s/applik8s/workflow-runtime';
import { validateApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import { Priority } from '@hatchet-dev/typescript-sdk/v1/index.js';

export function hatchetRunOptions(
  metadata: ApplicationWorkflowInvocationMetadata | undefined,
): {
  readonly additionalMetadata?: Record<string, string>;
  readonly priority?: Priority;
} {
  const additionalMetadata = applicationMetadata(metadata);
  const priority = metadata?.priority === 'high'
    ? Priority.HIGH
    : metadata?.priority === 'low'
      ? Priority.LOW
      : metadata?.priority === 'medium'
        ? Priority.MEDIUM
        : undefined;
  return {
    ...(Object.keys(additionalMetadata).length > 0 ? { additionalMetadata } : {}),
    ...(priority ? { priority } : {}),
  };
}

export function applicationMetadata(
  metadata: ApplicationWorkflowInvocationMetadata | undefined,
): Record<string, string> {
  const trustedContext = metadata?.trustedContext
    ? JSON.stringify(metadata.trustedContext)
    : undefined;
  if (trustedContext && Buffer.byteLength(trustedContext) > 8_192) {
    throw new Error(
      'Workflow trusted context exceeds the bounded 8192-byte durable metadata limit.',
    );
  }
  const causalPrincipal = metadata?.[
    applicationWorkflowCausalPrincipalMetadata
  ];
  const serializedCausalPrincipal = causalPrincipal
    ? JSON.stringify(causalPrincipal)
    : undefined;
  if (
    serializedCausalPrincipal
    && Buffer.byteLength(serializedCausalPrincipal) > 8_192
  ) {
    throw new Error(
      'Workflow causal principal exceeds the bounded 8192-byte durable metadata limit.',
    );
  }
  const telemetry = metadata?.[applicationWorkflowTelemetryMetadata];
  if (telemetry) validateApplicationTelemetryEnvelopeV1(telemetry);
  const serializedTelemetry = telemetry ? JSON.stringify(telemetry) : undefined;
  if (serializedTelemetry && Buffer.byteLength(serializedTelemetry) > 8_192) {
    throw new Error(
      'Workflow telemetry carrier exceeds the bounded 8192-byte durable metadata limit.',
    );
  }
  return Object.fromEntries(
    Object.entries({
      'applik8s.idempotency-key': metadata?.idempotencyKey,
      'applik8s.tenant': metadata?.tenant,
      'applik8s.correlation-id': metadata?.correlationId,
      'applik8s.causation-id': metadata?.causationId,
      traceparent: metadata?.traceparent,
      'applik8s.trusted-context': trustedContext,
      'applik8s.causal-principal': serializedCausalPrincipal,
      'applik8s.telemetry': serializedTelemetry,
      'applik8s.admission-id': metadata?.[
        applicationWorkflowProviderAdmissionMetadata
      ],
    }).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  );
}
