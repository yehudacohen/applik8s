import type { ApplicationWorkflowInvocationMetadata } from '@applik8s/applik8s';
import { Priority } from '@hatchet-dev/typescript-sdk/v1/index.js';

export function hatchetRunOptions(
  metadata: ApplicationWorkflowInvocationMetadata | undefined,
): {
  readonly additionalMetadata?: Record<string, string>;
  readonly priority?: Priority;
  readonly childKey?: string;
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
    ...(metadata?.idempotencyKey ? { childKey: metadata.idempotencyKey } : {}),
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
  return Object.fromEntries(
    Object.entries({
      'applik8s.idempotency-key': metadata?.idempotencyKey,
      'applik8s.tenant': metadata?.tenant,
      'applik8s.correlation-id': metadata?.correlationId,
      'applik8s.causation-id': metadata?.causationId,
      traceparent: metadata?.traceparent,
      'applik8s.trusted-context': trustedContext,
    }).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  );
}
