// typecast-file-boundary: the injected AWS client is a deliberately minimal
// protocol double used to prove retry-safe immutable object semantics.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createS3ApplicationObjectStorageRuntime } from '../src/index.js';

describe('S3 application object storage runtime', () => {
  it('adopts an identical immutable object after a retry-safe conditional PUT conflict', async () => {
    const body = 'durable result';
    const sha256 = createHash('sha256').update(body).digest('hex');
    const commands: string[] = [];
    const runtime = createS3ApplicationObjectStorageRuntime({
      store: 'artifacts',
      provider: {
        kind: 's3',
        bucket: 'objects',
        region: 'us-east-1',
      },
      client: {
        async send(command: object) {
          commands.push(command.constructor.name);
          if (command.constructor.name === 'PutObjectCommand') {
            throw Object.assign(new Error('precondition failed'), {
              name: 'PreconditionFailed',
              $metadata: { httpStatusCode: 412 },
            });
          }
          return {
            ContentLength: new TextEncoder().encode(body).byteLength,
            ContentType: 'application/json',
            Metadata: { 'applik8s-sha256': sha256 },
            ETag: '"stable-etag"',
          };
        },
      } as never,
    });

    await expect(
      runtime.put({
        key: 'reviews/decision.json',
        body,
        contentType: 'application/json',
        ifAbsent: true,
      }),
    ).resolves.toMatchObject({
      key: 'reviews/decision.json',
      sha256,
      etag: 'stable-etag',
    });
    expect(commands).toEqual(['PutObjectCommand', 'HeadObjectCommand']);
  });

  it('fails closed when an immutable retry encounters different existing content', async () => {
    const runtime = createS3ApplicationObjectStorageRuntime({
      store: 'artifacts',
      provider: {
        kind: 's3',
        bucket: 'objects',
        region: 'us-east-1',
      },
      client: {
        async send(command: object) {
          if (command.constructor.name === 'PutObjectCommand') {
            throw Object.assign(new Error('precondition failed'), {
              name: 'PreconditionFailed',
              $metadata: { httpStatusCode: 412 },
            });
          }
          return {
            ContentLength: 9,
            ContentType: 'application/json',
            Metadata: { 'applik8s-sha256': 'different' },
          };
        },
      } as never,
    });

    await expect(
      runtime.put({
        key: 'reviews/decision.json',
        body: 'durable result',
        contentType: 'application/json',
        ifAbsent: true,
      }),
    ).rejects.toThrow(
      'already exists with different content or unverifiable metadata',
    );
  });
});
