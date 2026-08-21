export type { ApplicationEventConsumerBinding, ApplicationEventLogConsumerLag, ApplicationEventLogPublisher, ApplicationMessageChannel, EventLogPublishAcknowledgement, RunningApplicationEventConsumer } from './event-log-runtime.js';
export type { ApplicationCommandTerminalFailure, PostgresModelCommandExecution, PostgresModelCommandMessage, PostgresModelCommandResult, PostgresModelCommandTerminalFailureExecution } from './model-command-postgres-runtime.js';
export { assertCommandEffectAllowed, canonicalApplicationCommandKey, closePostgresModelCommandRuntime, DurableCommandRejectedError, executePostgresModelCommand, isDurableCommandRejectedError, recordPostgresModelCommandTerminalFailure } from './model-command-postgres-runtime.js';
export { runApplicationModelBeforeCommit } from './application-model-policy.js';
export type { CommandDataCleanupOptions, CommandDataCleanupResult, EventOutboxRelayOptions, EventOutboxRelayResult, PostgresOutboxLag } from './postgres-outbox-runtime.js';
export { cleanupPostgresCommandData, observePostgresOutboxLag, relayPostgresCommandOutbox, relayPostgresEventOutbox } from './postgres-outbox-runtime.js';
import type { ApplicationAuthorizationReceipt } from '@applik8s/core';
import type { ApplicationModelCommandDeliveryOptions } from './application-models.js';

export interface ApplicationCommandProcessorBinding {
  readonly bindingId: string;
  readonly contract: { readonly name: string; readonly version: string };
  execute(input: object, delivery: ApplicationModelCommandDeliveryOptions): Promise<unknown>;
  revalidateAuthorization?(
    receipt: ApplicationAuthorizationReceipt,
    boundary: 'execution',
    delivery: ApplicationModelCommandDeliveryOptions,
  ): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly code: string; readonly message: string }>;
  releaseAuthorization?(receipt: ApplicationAuthorizationReceipt, envelopeId: string): Promise<void>;
  recordTerminalFailure?(input: object, delivery: ApplicationModelCommandDeliveryOptions, failure: { readonly code: 'processing_failed' | 'authorization_denied'; readonly attempts: number }): Promise<void>;
}

export interface RunningApplicationCommandProcessor {
  readonly closed: Promise<void>;
  drain(): Promise<void>;
}
