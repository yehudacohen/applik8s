import type { ApplicationMessageEnvelope } from './dsl.js';

export interface EventLogPublishAcknowledgement {
  readonly stream: string;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly subject: string;
  readonly messageId: string;
}

export type ApplicationMessageChannel = 'commands' | 'events';

export interface ApplicationEventLogConsumerLag {
  readonly pending: number;
  readonly ackPending: number;
  readonly redelivered: number;
}

/**
 * Provider-neutral runtime contract used by gateways, processors, and outbox
 * relays. Infrastructure/provider selection happens in the application graph;
 * generated runtime entrypoints inject the matching implementation.
 */
export interface ApplicationEventLogPublisher {
  verify(): Promise<void>;
  publish(envelope: ApplicationMessageEnvelope<object>, channel?: ApplicationMessageChannel): Promise<EventLogPublishAcknowledgement>;
  consumerLag(consumer: string): Promise<ApplicationEventLogConsumerLag>;
  drain(): Promise<void>;
}
