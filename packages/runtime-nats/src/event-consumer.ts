// typecast-file-boundary: NATS payload bytes are restored only after envelope and declared event-schema validation.
import { connect, type ConsumerMessages, type JetStreamClient, type JsMsg, type NatsConnection, StringCodec } from 'nats';
import type { ApplicationMessageEnvelope } from '@applik8s/applik8s/dsl';
import type { ApplicationEventConsumerBinding, RunningApplicationEventConsumer } from '@applik8s/applik8s/event-log-runtime';
import { consumeWithBoundedConcurrency } from './bounded-concurrency.js';

export interface JetStreamEventConsumerOptions {
  readonly servers: readonly string[];
  readonly stream: string;
  readonly consumer: string;
  readonly subjectPrefix: string;
  readonly bindings: readonly ApplicationEventConsumerBinding[];
  readonly connectionName?: string;
  readonly token?: string;
  readonly user?: string;
  readonly pass?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly concurrency?: number;
  readonly logger?: (record: Readonly<Record<string, unknown>>) => void;
}

const codec = StringCodec();

export async function startJetStreamEventConsumer(options: JetStreamEventConsumerOptions): Promise<RunningApplicationEventConsumer> {
  validateBindings(options.bindings);
  const connection = await connect({
    servers: [...options.servers],
    name: options.connectionName ?? `applik8s-${options.consumer}`,
    ...(options.token ? { token: options.token } : {}),
    ...(options.user ? { user: options.user } : {}),
    ...(options.pass ? { pass: options.pass } : {}),
  });
  try {
    const jetStream = connection.jetstream();
    const consumer = await jetStream.consumers.get(options.stream, options.consumer);
    const messages = await consumer.consume({
      max_messages: Math.max(1, options.concurrency ?? 1),
      abort_on_missing_resource: false,
    });
    const closed = consumeJetStreamEventMessages(messages, connection, jetStream, options);
    return {
      closed,
      async drain() {
        await messages.close();
        await closed;
        await connection.drain();
      },
    };
  } catch (cause) {
    if (!connection.isClosed()) await connection.close();
    throw cause;
  }
}

export async function handleJetStreamEventMessage(
  message: Pick<JsMsg, 'ack' | 'data' | 'info' | 'nak' | 'subject' | 'term'>,
  jetStream: Pick<JetStreamClient, 'publish'>,
  options: Pick<JetStreamEventConsumerOptions, 'bindings' | 'logger' | 'maxAttempts' | 'maxRetryDelayMs' | 'retryDelayMs' | 'subjectPrefix'>,
): Promise<'acked' | 'retried' | 'terminated'> {
  let envelope: ApplicationMessageEnvelope<object>;
  try {
    envelope = eventEnvelope(message.data);
  } catch (cause) {
    message.term('invalid applik8s event envelope');
    log(options, 'applik8s-event-envelope-invalid', { subject: message.subject, error: safeErrorMessage(cause) });
    return 'terminated';
  }
  const binding = bindingFor(options.bindings, envelope.contract);
  if (!binding) {
    message.term('unknown applik8s event binding');
    log(options, 'applik8s-event-binding-missing', { messageId: envelope.id, contract: envelope.contract });
    return 'terminated';
  }
  const attempt = Math.max(1, message.info.deliveryCount);
  try {
    await binding.execute(envelope);
    message.ack();
    log(options, 'applik8s-event-consumed', { messageId: envelope.id, binding: binding.bindingId, attempt });
    return 'acked';
  } catch (cause) {
    const maximum = Math.max(1, options.maxAttempts ?? 5);
    if (attempt < maximum) {
      const delayMs = retryDelay(attempt, options.retryDelayMs ?? 100, options.maxRetryDelayMs ?? 30_000);
      message.nak(delayMs);
      log(options, 'applik8s-event-retry', { messageId: envelope.id, binding: binding.bindingId, attempt, delayMs, error: safeErrorMessage(cause) });
      return 'retried';
    }
    await jetStream.publish(
      `${options.subjectPrefix}.dead-letter.${subjectToken(binding.bindingId)}`,
      codec.encode(JSON.stringify({ ...envelope, id: `${envelope.id}:dead-letter`, causationId: envelope.id, routing: { ...(envelope.routing ?? {}), deadLetterBinding: binding.bindingId, failure: safeErrorMessage(cause) } })),
      { msgID: `${envelope.id}:dead-letter` },
    );
    message.term('applik8s event attempts exhausted');
    log(options, 'applik8s-event-dead-lettered', { messageId: envelope.id, binding: binding.bindingId, attempt, error: safeErrorMessage(cause) });
    return 'terminated';
  }
}

export async function consumeJetStreamEventMessages(
  messages: ConsumerMessages,
  connection: NatsConnection,
  jetStream: JetStreamClient,
  options: JetStreamEventConsumerOptions,
): Promise<void> {
  try {
    await consumeWithBoundedConcurrency(messages, options.concurrency ?? 1, async (message) => {
      await handleJetStreamEventMessage(message, jetStream, options);
    });
  } finally {
    if (!connection.isClosed()) await connection.flush();
  }
}

function eventEnvelope(data: Uint8Array): ApplicationMessageEnvelope<object> {
  const value: unknown = JSON.parse(codec.decode(data));
  if (!value || typeof value !== 'object') throw new Error('Envelope must be an object.');
  const contract = Reflect.get(value, 'contract');
  if (typeof Reflect.get(value, 'id') !== 'string' || !contract || typeof contract !== 'object' || typeof Reflect.get(contract, 'name') !== 'string' || typeof Reflect.get(contract, 'version') !== 'string' || !Reflect.get(value, 'payload') || typeof Reflect.get(value, 'recordedAt') !== 'string') {
    throw new Error('Envelope requires id, contract.name, contract.version, object payload, and recordedAt.');
  }
  return value as ApplicationMessageEnvelope<object>;
}

function validateBindings(bindings: readonly ApplicationEventConsumerBinding[]): void {
  if (bindings.length === 0) throw new Error('A JetStream event consumer requires at least one binding.');
  const contracts = new Set<string>();
  for (const binding of bindings) {
    const identity = `${binding.contract.name}\0${binding.contract.version}`;
    if (contracts.has(identity)) throw new Error(`Multiple JetStream event bindings consume ${binding.contract.name}.${binding.contract.version}.`);
    contracts.add(identity);
  }
}

function bindingFor(bindings: readonly ApplicationEventConsumerBinding[], contract: { readonly name: string; readonly version: string }): ApplicationEventConsumerBinding | undefined {
  return bindings.find((binding) => binding.contract.name === contract.name && binding.contract.version === contract.version);
}
function retryDelay(attempt: number, base: number, maximum: number): number { return Math.min(maximum, base * 2 ** Math.max(0, attempt - 1)); }
function subjectToken(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'value'; }
function safeErrorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
function log(options: Pick<JetStreamEventConsumerOptions, 'logger'>, event: string, context: Readonly<Record<string, unknown>>): void { options.logger?.({ event, ...context }); }
