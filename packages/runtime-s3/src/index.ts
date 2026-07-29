// typecast-file-boundary: signed S3 response fields are checked for presence and shape before conversion to the provider-neutral object contract.
import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ApplicationObjectMetadata,
  ApplicationObjectReference,
  ApplicationObjectStorageRuntime,
  ApplicationSignedObjectIntent,
  ApplicationS3ObjectStorageProvider,
} from '@applik8s/applik8s';

export interface S3ApplicationObjectStorageRuntimeOptions {
  readonly store: string;
  readonly provider: ApplicationS3ObjectStorageProvider;
  readonly client?: S3Client;
  readonly clientConfig?: Omit<S3ClientConfig, 'region' | 'endpoint' | 'forcePathStyle'>;
  readonly now?: () => Date;
}

/** Concrete S3-compatible runtime used for Rook RGW, AWS S3, MinIO, and compatible services. */
export function createS3ApplicationObjectStorageRuntime(options: S3ApplicationObjectStorageRuntimeOptions): ApplicationObjectStorageRuntime {
  const client = options.client ?? new S3Client({
    ...options.clientConfig,
    region: options.provider.region,
    ...(options.provider.endpoint ? { endpoint: options.provider.endpoint } : {}),
    forcePathStyle: options.provider.forcePathStyle ?? Boolean(options.provider.endpoint),
  });
  const now = options.now ?? (() => new Date());
  const bucket = options.provider.bucket;
  const keyFor = (key: string) => [options.provider.prefix?.replace(/^\/+|\/+$/g, ''), options.store, key].filter(Boolean).join('/');
  const expiresAt = (ttlSeconds: number) => new Date(now().getTime() + ttlSeconds * 1_000).toISOString();
  const reference = (key: string, size: number, contentType: string, sha256: string, response: { ETag?: string | undefined; VersionId?: string | undefined }): ApplicationObjectReference => ({
    store: options.store,
    key,
    size,
    contentType,
    sha256,
    ...(response.ETag ? { etag: response.ETag.replace(/^"|"$/g, '') } : {}),
    ...(response.VersionId ? { version: response.VersionId } : {}),
  });
  return {
    async put(request) {
      const body = typeof request.body === 'string' ? new TextEncoder().encode(request.body) : request.body;
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (request.sha256 && request.sha256.replace(/^sha256:/, '').toLowerCase() !== sha256) throw new Error(`Object ${request.key} SHA-256 does not match its declared digest.`);
      const response = await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: keyFor(request.key),
        Body: body,
        ContentLength: body.byteLength,
        ContentType: request.contentType,
        Metadata: { ...request.metadata, 'applik8s-store': options.store, 'applik8s-sha256': sha256 },
        ...(request.ifAbsent ? { IfNoneMatch: '*' } : {}),
      }));
      return reference(request.key, body.byteLength, request.contentType, sha256, response);
    },
    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keyFor(key) }));
        return response.Body ? new Uint8Array(await response.Body.transformToByteArray()) : new Uint8Array();
      } catch (error) {
        if (isS3NotFound(error)) return undefined;
        throw error;
      }
    },
    async head(key) {
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: keyFor(key) }));
        const sha256 = response.Metadata?.['applik8s-sha256'];
        if (!sha256) throw new Error(`Object ${key} is missing required applik8s-sha256 metadata.`);
        const metadata: ApplicationObjectMetadata = {
          ...reference(key, response.ContentLength ?? 0, response.ContentType ?? 'application/octet-stream', sha256, response),
          ...(response.LastModified ? { updatedAt: response.LastModified.toISOString() } : {}),
          ...(response.Metadata ? { custom: response.Metadata } : {}),
        };
        return metadata;
      } catch (error) {
        if (isS3NotFound(error)) return undefined;
        throw error;
      }
    },
    async delete(key, deleteOptions) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyFor(key), ...(deleteOptions?.ifVersion ? { VersionId: deleteOptions.ifVersion } : {}) }));
    },
    async signUpload(request) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: keyFor(request.key),
        ContentType: request.contentType,
        // A signed PUT cannot safely trust a browser-declared size. The logical
        // store bounds the intent and completion verifies ContentLength from
        // HEAD; binding the digest as signed metadata makes that completion
        // check authoritative without exposing provider credentials.
        Metadata: { 'applik8s-sha256': request.sha256 },
      });
      const intent: ApplicationSignedObjectIntent = {
        method: 'PUT',
        // typecast-boundary: aligned AWS SDK packages duplicate the private Smithy Client declaration under Bun; the public S3 client/command pair is runtime-compatible.
        url: await getSignedUrl(client as never, command, { expiresIn: request.ttlSeconds }),
        expiresAt: expiresAt(request.ttlSeconds),
        headers: { 'content-type': request.contentType, 'x-amz-meta-applik8s-sha256': request.sha256 },
        object: { store: options.store, key: request.key },
      };
      return intent;
    },
    async signDownload(request) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: keyFor(request.key) });
      return {
        method: 'GET',
        // typecast-boundary: see signed upload; only the SDK's duplicated private handler member prevents structural assignment.
        url: await getSignedUrl(client as never, command, { expiresIn: request.ttlSeconds }),
        expiresAt: expiresAt(request.ttlSeconds),
        headers: {},
        object: { store: options.store, key: request.key },
      };
    },
  };
}

function isS3NotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = Reflect.get(error, 'name');
  const metadata = Reflect.get(error, '$metadata');
  return name === 'NoSuchKey' || name === 'NotFound' || Boolean(metadata && typeof metadata === 'object' && Reflect.get(metadata, 'httpStatusCode') === 404);
}
