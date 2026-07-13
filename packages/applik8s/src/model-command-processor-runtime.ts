import { connect, type ConsumerMessages, type JsMsg, type NatsConnection, type JetStreamClient, StringCodec } from 'nats';
import type { ApplicationMessageEnvelope } from './dsl.js';
import type { ApplicationModelCommandDeliveryOptions } from './application-models.js';
import { isDurableCommandRejectedError } from './model-command-postgres-runtime.js';
import { consumeWithBoundedConcurrency } from './bounded-concurrency.js';
import { commandProcessorBindingFor } from './model-command-binding-index.js';

export interface ApplicationCommandProcessorBinding {
  readonly bindingId: string;
  readonly contract: { readonly name: string; readonly version: string };
  execute(input: object, delivery: ApplicationModelCommandDeliveryOptions): Promise<unknown>;
}

export interface JetStreamCommandProcessorOptions {
  readonly servers: readonly string[];
  readonly stream: string;
  readonly consumer: string;
  readonly subjectPrefix: string;
  readonly bindings: readonly ApplicationCommandProcessorBinding[];
  readonly connectionName?: string;
  readonly token?: string;
  readonly user?: string;
  readonly pass?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly concurrency?: number;
  readonly databaseUrl?: string;
  readonly logger?: (record: Readonly<Record<string, unknown>>) => void;
}

export interface RunningJetStreamCommandProcessor {
  readonly closed: Promise<void>;
  drain(): Promise<void>;
}

const codec = StringCodec();

export async function startJetStreamCommandProcessor(options: JetStreamCommandProcessorOptions): Promise<RunningJetStreamCommandProcessor> {
  validateProcessorBindings(options.bindings);
  const connection = await connect({
    servers: [...options.servers],
    name: options.connectionName ?? `applik8s-${options.consumer}`,
    ...(options.token ? { token: options.token } : {}),
    ...(options.user ? { user: options.user } : {}),
    ...(options.pass ? { pass: options.pass } : {}),
  });
  const jetStream = connection.jetstream();
  const consumer = await jetStream.consumers.get(options.stream, options.consumer);
  const messages = await consumer.consume({
    max_messages: Math.max(1, options.concurrency ?? 1),
    abort_on_missing_resource: false,
  });
  const closed = consumeJetStreamCommandMessages(messages, connection, jetStream, options);
  return {
    closed,
    async drain() {
      await messages.close();
      await closed;
      await connection.drain();
    },
  };
}

export async function handleJetStreamCommandMessage(
  message: Pick<JsMsg, 'ack' | 'data' | 'info' | 'nak' | 'subject' | 'term'>,
  jetStream: Pick<JetStreamClient, 'publish'>,
  options: Pick<JetStreamCommandProcessorOptions, 'bindings' | 'databaseUrl' | 'logger' | 'maxAttempts' | 'maxRetryDelayMs' | 'retryDelayMs' | 'subjectPrefix'>,
): Promise<'acked' | 'retried' | 'terminated'> {
  let envelope: ApplicationMessageEnvelope<object>;
  try {
    envelope = commandEnvelope(message.data);
  } catch (error) {
    message.term('invalid applik8s command envelope');
    processorLog(options, 'applik8s-command-envelope-invalid', { subject: message.subject, error: safeErrorMessage(error) });
    return 'terminated';
  }

  const binding = commandProcessorBindingFor(options.bindings, envelope.contract);
  if (!binding || (envelope.routing?.binding && envelope.routing.binding !== binding.bindingId)) {
    message.term('unknown applik8s command binding');
    processorLog(options, 'applik8s-command-binding-missing', { messageId: envelope.id, contract: envelope.contract, requestedBinding: envelope.routing?.binding });
    return 'terminated';
  }

  const deliveryCount = Math.max(1, message.info.deliveryCount);
  try {
    const result = await binding.execute(envelope.payload, {
      id: envelope.id,
      ...(envelope.tenant ? { tenant: envelope.tenant } : {}),
      ...(envelope.correlationId ? { correlationId: envelope.correlationId } : {}),
      ...(envelope.causationId ? { causationId: envelope.causationId } : {}),
      ...(envelope.traceparent ? { traceparent: envelope.traceparent } : {}),
      attempt: deliveryCount,
      recordedAt: envelope.recordedAt,
      ...(envelope.expectedRevision ? { expectedRevision: envelope.expectedRevision } : {}),
      ...(envelope.routing?.targetKey ? { targetKey: envelope.routing.targetKey } : {}),
      ...(envelope.routing?.idempotencyKey ? { idempotencyKey: envelope.routing.idempotencyKey } : {}),
      ...(options.databaseUrl ? { databaseUrl: options.databaseUrl } : {}),
    });
    message.ack();
    processorLog(options, 'applik8s-command-processed', {
      messageId: envelope.id,
      binding: binding.bindingId,
      attempt: deliveryCount,
      ...commandResultObservation(result),
    });
    return 'acked';
  } catch (error) {
    if (isDurableCommandRejectedError(error)) {
      message.ack();
      processorLog(options, 'applik8s-command-rejected', { messageId: envelope.id, binding: binding.bindingId, attempt: deliveryCount, rejection: error.rejection, replayed: error.replayed, observation: error.observation });
      return 'acked';
    }
    const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    if (deliveryCount < maxAttempts) {
      const delay = retryDelay(deliveryCount, options.retryDelayMs ?? 100, options.maxRetryDelayMs ?? 30_000);
      message.nak(delay);
      processorLog(options, 'applik8s-command-retry', { messageId: envelope.id, binding: binding.bindingId, attempt: deliveryCount, delayMs: delay, error: safeErrorMessage(error) });
      return 'retried';
    }
    await publishDeadLetter(jetStream, options.subjectPrefix, binding.bindingId, envelope, error);
    message.term('applik8s command attempts exhausted');
    processorLog(options, 'applik8s-command-dead-lettered', { messageId: envelope.id, binding: binding.bindingId, attempt: deliveryCount, error: safeErrorMessage(error) });
    return 'terminated';
  }
}

function commandResultObservation(result: unknown): Readonly<Record<string, unknown>> {
  if (!result || typeof result !== 'object') return {};
  const observation = Reflect.get(result, 'observation');
  return observation && typeof observation === 'object' ? { observation } : {};
}

export async function consumeJetStreamCommandMessages(
  messages: ConsumerMessages,
  connection: NatsConnection,
  jetStream: JetStreamClient,
  options: JetStreamCommandProcessorOptions,
): Promise<void> {
  try {
    await consumeWithBoundedConcurrency(messages, options.concurrency ?? 1, async (message) => {
      await handleJetStreamCommandMessage(message, jetStream, options);
    });
  } finally {
    if (!connection.isClosed()) await connection.flush();
  }
}

function commandEnvelope(data: Uint8Array): ApplicationMessageEnvelope<object> {
  const value: unknown = JSON.parse(codec.decode(data));
  if (!value || typeof value !== 'object') throw new Error('Envelope must be an object.');
  const id = Reflect.get(value, 'id');
  const contract = Reflect.get(value, 'contract');
  const payload = Reflect.get(value, 'payload');
  const recordedAt = Reflect.get(value, 'recordedAt');
  if (typeof id !== 'string' || !contract || typeof contract !== 'object' || typeof Reflect.get(contract, 'name') !== 'string' || typeof Reflect.get(contract, 'version') !== 'string' || !payload || typeof payload !== 'object' || typeof recordedAt !== 'string') {
    throw new Error('Envelope requires id, contract.name, contract.version, object payload, and recordedAt.');
  }
  // typecast: every required envelope field has been checked at this untrusted JetStream boundary.
  return value as ApplicationMessageEnvelope<object>;
}

async function publishDeadLetter(
  jetStream: Pick<JetStreamClient, 'publish'>,
  prefix: string,
  bindingId: string,
  envelope: ApplicationMessageEnvelope<object>,
  error: unknown,
): Promise<void> {
  const deadLetter = {
    ...envelope,
    id: `${envelope.id}:dead-letter`,
    causationId: envelope.id,
    routing: { ...(envelope.routing ?? {}), deadLetterBinding: bindingId, failure: safeErrorMessage(error) },
  };
  const subject = `${prefix}.dead-letter.${subjectToken(bindingId)}`;
  await jetStream.publish(subject, codec.encode(JSON.stringify(deadLetter)), { msgID: deadLetter.id });
}

function validateProcessorBindings(bindings: readonly ApplicationCommandProcessorBinding[]): void {
  const contracts = new Set<string>();
  for (const binding of bindings) {
    const contract = `${binding.contract.name}:${binding.contract.version}`;
    if (contracts.has(contract)) throw new Error(`applik8s-command-processor-ambiguous: Multiple bindings consume ${contract}.`);
    contracts.add(contract);
  }
  if (bindings.length === 0) throw new Error('applik8s-command-processor-empty: A processor requires at least one command binding.');
}

function retryDelay(attempt: number, initial: number, maximum: number): number {
  return Math.max(1, Math.min(maximum, initial * (2 ** Math.max(0, attempt - 1))));
}

function subjectToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'binding';
}

function processorLog(options: Pick<JetStreamCommandProcessorOptions, 'logger'>, event: string, context: Readonly<Record<string, unknown>>): void {
  options.logger?.({ event, component: 'applik8s-command-processor', ...context });
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
