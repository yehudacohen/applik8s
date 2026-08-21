import type { ApplicationMessageEnvelope } from './dsl.js';

export interface EventLogPublishAcknowledgement {
  readonly stream: string;
  /** Provider-native durable position. Kinesis sequence numbers exceed JS safe integers. */
  readonly sequence: number | string;
  readonly duplicate: boolean;
  readonly subject: string;
  readonly messageId: string;
}

export type ApplicationMessageChannel = 'commands' | 'events' | 'dead-letter';

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

/** One durable, versioned event subscription owned by a generated worker. */
export interface ApplicationEventConsumerBinding {
  readonly bindingId: string;
  readonly contract: { readonly name: string; readonly version: string };
  /** Resolve only after every authoritative side effect of this fact is durable. */
  execute(envelope: ApplicationMessageEnvelope<object>): Promise<unknown>;
}

export interface RunningApplicationEventConsumer {
  readonly closed: Promise<void>;
  drain(): Promise<void>;
}

export interface ApplicationEventLogEnvironmentOptions {
  /** Stable workload identity used only for provider connection diagnostics. */
  readonly connectionName: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Author-time JetStream defaults used by direct calls outside a generated host. */
  readonly nats?: {
    readonly servers?: readonly string[];
    readonly stream?: string;
    readonly subjectPrefix?: string;
  };
}

export interface ApplicationEventLogAdapterLoader {
  nats(options: {
    readonly servers: readonly string[];
    readonly stream: string;
    readonly subjectPrefix: string;
    readonly connectionName: string;
    readonly token?: string;
    readonly user?: string;
    readonly pass?: string;
  }): Promise<ApplicationEventLogPublisher>;
  kinesis(options: {
    readonly streamName: string;
    readonly checkpointTable?: string;
    readonly region?: string;
    readonly endpoint?: string;
  }): Promise<ApplicationEventLogPublisher>;
}

/**
 * Creates a lazy provider-neutral event-log publisher from deployment-projected
 * runtime bindings. Provider packages stay out of application source while a
 * direct model call can still use its authored JetStream defaults.
 */
export function createApplicationEventLogPublisherFromEnvironment(
  options: ApplicationEventLogEnvironmentOptions,
  adapters: ApplicationEventLogAdapterLoader = defaultApplicationEventLogAdapters,
): ApplicationEventLogPublisher {
  return createApplicationEventLogPublisherFromEnvironmentWithAdapters(options, adapters);
}

/**
 * Generated runtimes use this required-adapter form so their deployment target
 * contributes exactly one transport implementation. Keeping the author-time
 * convenience default out of this call graph lets bundlers remove every
 * unselected provider SDK without changing the provider-neutral runtime API.
 */
export function createApplicationEventLogPublisherFromEnvironmentWithAdapters(
  options: ApplicationEventLogEnvironmentOptions,
  adapters: ApplicationEventLogAdapterLoader,
): ApplicationEventLogPublisher {
  const environment = options.environment ?? process.env;
  let resolved: Promise<ApplicationEventLogPublisher> | undefined;
  const publisher = () => {
    resolved ??= resolveApplicationEventLogPublisher(options, environment, adapters);
    return resolved;
  };
  return {
    async verify() { await (await publisher()).verify(); },
    async publish(envelope, channel) { return (await publisher()).publish(envelope, channel); },
    async consumerLag(consumer) { return (await publisher()).consumerLag(consumer); },
    async drain() { await (await publisher()).drain(); },
  };
}

async function resolveApplicationEventLogPublisher(
  options: ApplicationEventLogEnvironmentOptions,
  environment: Readonly<Record<string, string | undefined>>,
  adapters: ApplicationEventLogAdapterLoader,
): Promise<ApplicationEventLogPublisher> {
  const transport = environment.APPLIK8S_EVENT_TRANSPORT
    ?? (environment.APPLIK8S_EVENT_LOG_PROVIDER === 'kinesis' ? 'kinesis' : 'nats');
  if (transport === 'kinesis') {
    const region = environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION;
    return adapters.kinesis({
      streamName: requiredEventLogEnvironment(environment, 'APPLIK8S_KINESIS_STREAM'),
      ...(environment.APPLIK8S_KINESIS_CHECKPOINT_TABLE ? { checkpointTable: environment.APPLIK8S_KINESIS_CHECKPOINT_TABLE } : {}),
      ...(region ? { region } : {}),
      ...(environment.APPLIK8S_AWS_ENDPOINT ? { endpoint: environment.APPLIK8S_AWS_ENDPOINT } : {}),
    });
  }
  if (transport !== 'nats') throw new Error(`Unsupported APPLIK8S_EVENT_TRANSPORT ${JSON.stringify(transport)}; expected nats or kinesis.`);
  const servers = environment.APPLIK8S_NATS_SERVERS
    ? parseEventLogServers(environment.APPLIK8S_NATS_SERVERS)
    : options.nats?.servers;
  if (!servers?.length) throw new Error('Missing required event-log binding APPLIK8S_NATS_SERVERS.');
  return adapters.nats({
    servers,
    stream: environment.APPLIK8S_NATS_STREAM ?? options.nats?.stream ?? 'APPLIK8S_EVENTS',
    subjectPrefix: environment.APPLIK8S_NATS_SUBJECT_PREFIX ?? options.nats?.subjectPrefix ?? 'applik8s',
    connectionName: options.connectionName,
    ...(environment.APPLIK8S_NATS_TOKEN ? { token: environment.APPLIK8S_NATS_TOKEN } : {}),
    ...(environment.APPLIK8S_NATS_USER ? { user: environment.APPLIK8S_NATS_USER, pass: environment.APPLIK8S_NATS_PASSWORD ?? '' } : {}),
  });
}

const defaultApplicationEventLogAdapters: ApplicationEventLogAdapterLoader = {
  async nats(options) {
    // static-import-exception: runtime-selected event providers stay tree-shakeable and do not force both transport SDKs into every application.
    const { createJetStreamEventLog } = await import('@applik8s/runtime-nats/event-log');
    return createJetStreamEventLog(options);
  },
  async kinesis(options) {
    // static-import-exception: runtime-selected event providers stay tree-shakeable and do not force both transport SDKs into every application.
    const { createKinesisEventLog } = await import('@applik8s/runtime-aws/kinesis');
    return createKinesisEventLog(options);
  },
};

function parseEventLogServers(source: string): readonly string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (cause) {
    throw new Error('APPLIK8S_NATS_SERVERS must be a JSON array of non-empty URLs.', { cause });
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((server) => typeof server !== 'string' || server.length === 0)) {
    throw new Error('APPLIK8S_NATS_SERVERS must be a JSON array of non-empty URLs.');
  }
  return parsed;
}

function requiredEventLogEnvironment(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`Missing required event-log binding ${name}.`);
  return value;
}
