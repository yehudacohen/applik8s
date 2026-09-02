import { createHash } from 'node:crypto';
import { type } from '@applik8s/applik8s/dsl';
import { inArray, sql } from 'drizzle-orm';
import { workflow } from '../domain-app';
import { Attachments } from '../media/objects';
import { Database } from '../providers/database';
import { mediaAttachments } from '../schema/posts';
import { MediaProcessingChanged, MediaUploadCompleted } from './events';
import { containsAscii, matchesMediaSignature } from './media-validation';

export { containsAscii, matchesMediaSignature } from './media-validation';

const MediaModel = mediaAttachments;

MediaModel.create.beforeCommit(
  { history: true },
  async (attachment, input, context) => {
    if (!context.principal) throw new Error('Media requires an authenticated owner.');
    if (
      input.ownerId !== undefined ||
      input.processingState !== undefined ||
      input.createdAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Media ownership, processing state, timestamps, and revisions are server-owned.');
    if (attachment.value.ownerId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated media owner.');
    if (!input.uploadReceipt) throw new Error('Media metadata requires a provider-verified upload completion receipt.');
    if (input.id !== input.objectKey.split('/').at(-1))
      throw new Error('Media identity must match the server-generated object identity.');
    attachment.patch({ spec: { processingState: 'uploaded', createdAt: context.now } });
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error('Media metadata requires a SHA-256 checksum.');
    MediaUploadCompleted.emit({
      attachmentId: attachment.id,
      ownerId: attachment.value.ownerId,
      objectKey: input.objectKey,
      contentType: input.contentType,
      byteLength: input.byteLength,
      sha256: input.sha256,
      completedAt: context.now,
    });
  },
);

MediaModel.update.beforeCommit(
  { history: true },
  async (attachment, input, context) => {
    if (!context.principal || context.principal.id !== attachment.value.ownerId)
      throw new Error('Only the media owner can update it.');
    const mediaWorker = context.principal.roles?.includes('media-worker') === true;
    if (
      'id' in input.patch ||
      'ownerId' in input.patch ||
      'objectKey' in input.patch ||
      'contentType' in input.patch ||
      'byteLength' in input.patch ||
      'sha256' in input.patch ||
      'uploadReceipt' in input.patch ||
      'createdAt' in input.patch ||
      'revision' in input.patch
    )
      throw new Error(
        'Media identity, ownership, content, completion evidence, timestamps, and revisions are server-owned.',
      );
    if (!mediaWorker && ('processingState' in input.patch || 'processingReason' in input.patch))
      throw new Error('Only the media processor can change processing outcomes.');
    if (mediaWorker) {
      const keys = Object.keys(input.patch);
      if (keys.some((key) => key !== 'processingState' && key !== 'processingReason'))
        throw new Error('The media processor may change only processing outcome fields.');
      const processingState = input.patch.processingState;
      if (processingState !== 'ready' && processingState !== 'rejected')
        throw new Error('The media processor must commit a ready or rejected outcome.');
      const reason = input.patch.processingReason?.trim();
      if (!reason || reason.length > 256) throw new Error('Media processing outcomes require a bounded reason.');
      MediaProcessingChanged.emit({
        attachmentId: attachment.id,
        ownerId: attachment.value.ownerId,
        processingState,
        reason,
        changedAt: context.now,
      });
    }
  },
);

MediaModel.delete.beforeCommit({ history: true }, async (attachment, _input, context) => {
  if (!context.principal || context.principal.id !== attachment.value.ownerId)
    throw new Error('Only the media owner can delete it.');
});

export const Media = MediaModel;
export const MediaForPosts = Media.view(
  {
    input: type({ postIds: 'string[]' }),
    output: type({
      id: 'string',
      postId: 'string',
      objectKey: 'string',
      contentType: 'string',
      byteLength: 'string',
      sha256: 'string',
      altText: 'string',
      processingState: 'string',
      processingReason: 'string | null',
    }).array(),
    database: Database,
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 200, maxResultBytes: 3_200_000, timeoutMs: 2_000 },
  },
  async function forPosts(input, _context) {
    const postIds = [...new Set(input.postIds)].slice(0, 50);
    if (postIds.length === 0) return [];
    return Database
      .select({
        id: MediaModel.id,
        postId: sql<string>`${MediaModel.postId}`,
        objectKey: MediaModel.objectKey,
        contentType: MediaModel.contentType,
        byteLength: MediaModel.byteLength,
        sha256: MediaModel.sha256,
        altText: MediaModel.altText,
        processingState: MediaModel.processingState,
        processingReason: MediaModel.processingReason,
      })
      .from(MediaModel)
      .where(inArray(MediaModel.postId, postIds))
      .limit(200);
  },
);

/**
 * A durable, retry-safe media boundary. Ordinary direct handles retain their
 * provider-neutral authority; the compiler captures only the immutable
 * Attachments store and the bounded Media update operation.
 */
export const verifyMedia = workflow(
  'media.verify.v1',
  {
    input: type({
      attachmentId: 'string',
      ownerId: 'string',
      objectKey: 'string',
      contentType: 'string',
      byteLength: 'string',
      sha256: 'string',
    }),
    output: type({ attachmentId: 'string', processingState: "'ready' | 'rejected'", reason: 'string' }),
  },
  {
    authority: [MediaModel.update.all()],
    principal: (input) => ({
      id: input.ownerId,
      roles: ['media-worker'],
      attributes: { attachmentId: input.attachmentId },
      authorizationVersion: 'chirp-media-v1',
      trustedContext: { executionAuthority: 'applik8s-workflow' },
    }),
    retries: 4,
    executionTimeoutSeconds: 45,
    idempotencyKey: ({ attachmentId, sha256 }) => `${attachmentId}:${sha256}`,
  },
  async (input) => {
    const reject = async (
      reason: string,
    ): Promise<{ readonly attachmentId: string; readonly processingState: 'rejected'; readonly reason: string }> => {
      await MediaModel.update({
        identity: input.attachmentId,
        patch: { processingState: 'rejected', processingReason: reason },
      });
      return { attachmentId: input.attachmentId, processingState: 'rejected', reason };
    };
    const expectedBytes = Number(input.byteLength);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) return reject('invalid-byte-length');
    const metadata = await Attachments.head(input.objectKey);
    if (!metadata) throw new Error(`Uploaded media ${input.objectKey} is not yet visible in object storage.`);
    if (metadata.size !== expectedBytes) return reject('provider-size-mismatch');
    if (metadata.contentType.toLowerCase() !== input.contentType.toLowerCase())
      return reject('provider-content-type-mismatch');
    if (metadata.sha256.toLowerCase() !== input.sha256.toLowerCase()) return reject('provider-checksum-mismatch');
    const body = await Attachments.get(input.objectKey);
    if (!body) throw new Error(`Uploaded media ${input.objectKey} disappeared during verification.`);
    if (body.byteLength !== expectedBytes) return reject('download-size-mismatch');
    if (createHash('sha256').update(body).digest('hex') !== input.sha256.toLowerCase())
      return reject('download-checksum-mismatch');
    if (!matchesMediaSignature(input.contentType, body)) return reject('content-signature-mismatch');
    if (containsAscii(body, 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return reject('malware-test-signature');
    const reason = 'verified-size-type-checksum-signature';
    await MediaModel.update({
      identity: input.attachmentId,
      patch: { processingState: 'ready', processingReason: reason },
    });
    return { attachmentId: input.attachmentId, processingState: 'ready', reason };
  },
);
