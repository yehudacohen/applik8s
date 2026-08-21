export type ApplicationRuntimeExecutionTarget =
  | 'kubernetes'
  | 'local'
  | 'aws-local'
  | 'aws';

export interface GeneratedApplicationEventLogPublisherSource {
  readonly importSource: string;
  readonly declarationSource: string;
}

/**
 * Emits one target-native event-log implementation into a generated runtime.
 *
 * The semantic graph remains provider-neutral, while the physical artifact is
 * deliberately target-specific. This prevents a Kubernetes image from
 * carrying the AWS SDK (and an AWS image from carrying JetStream) merely to
 * preserve a runtime choice that deployment planning has already made.
 */
export function generatedApplicationEventLogPublisherSource(options: {
  readonly executionTarget: ApplicationRuntimeExecutionTarget;
  readonly variableName: string;
  readonly connectionName: string;
}): GeneratedApplicationEventLogPublisherSource {
  if (options.executionTarget === 'aws' || options.executionTarget === 'aws-local') {
    return {
      importSource:
        "import { createKinesisEventLog } from '@applik8s/runtime-aws/kinesis';",
      declarationSource: `const ${options.variableName} = createKinesisEventLog({
  streamName: requiredEnv('APPLIK8S_KINESIS_STREAM'),
  checkpointTable: process.env.APPLIK8S_KINESIS_CHECKPOINT_TABLE,
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
  endpoint: process.env.APPLIK8S_AWS_ENDPOINT,
});`,
    };
  }
  return {
    importSource:
      "import { createJetStreamEventLog } from '@applik8s/runtime-nats/event-log';",
    declarationSource: `const ${options.variableName} = createJetStreamEventLog({
  servers: (() => {
    let value;
    try { value = JSON.parse(requiredEnv('APPLIK8S_NATS_SERVERS')); }
    catch (cause) { throw new Error('APPLIK8S_NATS_SERVERS must be a JSON array of non-empty strings.', { cause }); }
    if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) throw new Error('APPLIK8S_NATS_SERVERS must be a JSON array of non-empty strings.');
    return value;
  })(),
  stream: requiredEnv('APPLIK8S_NATS_STREAM'),
  subjectPrefix: requiredEnv('APPLIK8S_NATS_SUBJECT_PREFIX'),
  connectionName: ${JSON.stringify(options.connectionName)},
  token: process.env.APPLIK8S_NATS_TOKEN,
  user: process.env.APPLIK8S_NATS_USER,
  pass: process.env.APPLIK8S_NATS_PASSWORD,
});`,
  };
}
