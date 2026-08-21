import { describe, expect, it } from 'vitest';
import {
  generatedApplicationEventLogPublisherSource,
  type ApplicationRuntimeExecutionTarget,
} from '../src/application-event-log-runtime-source.js';

describe('generated target-native event-log publishers', () => {
  const cases: ReadonlyArray<readonly [
    ApplicationRuntimeExecutionTarget,
    string,
    string,
    string,
    string,
  ]> = [
    ['kubernetes', '@applik8s/runtime-nats/event-log', 'APPLIK8S_NATS_STREAM', '@applik8s/runtime-aws/kinesis', 'APPLIK8S_KINESIS_STREAM'],
    ['local', '@applik8s/runtime-nats/event-log', 'APPLIK8S_NATS_STREAM', '@applik8s/runtime-aws/kinesis', 'APPLIK8S_KINESIS_STREAM'],
    ['aws-local', '@applik8s/runtime-aws/kinesis', 'APPLIK8S_KINESIS_STREAM', '@applik8s/runtime-nats/event-log', 'APPLIK8S_NATS_STREAM'],
    ['aws', '@applik8s/runtime-aws/kinesis', 'APPLIK8S_KINESIS_STREAM', '@applik8s/runtime-nats/event-log', 'APPLIK8S_NATS_STREAM'],
  ];

  it.each(cases)(
    'emits only the %s transport',
    (executionTarget, expectedImport, expectedEnvironment, excludedImport, excludedEnvironment) => {
      const generated = generatedApplicationEventLogPublisherSource({
        executionTarget,
        variableName: 'events',
        connectionName: 'proof',
      });

      expect(generated.importSource).toContain(expectedImport);
      expect(generated.declarationSource).toContain(expectedEnvironment);
      expect(`${generated.importSource}\n${generated.declarationSource}`).not.toContain(excludedImport);
      expect(generated.declarationSource).not.toContain(excludedEnvironment);
    },
  );
});
