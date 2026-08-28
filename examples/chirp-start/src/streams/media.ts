import { app } from '../domain-app';
import { MediaUploadCompleted } from '../domain/events';
import { verifyMedia } from '../domain/media';
import { Database } from '../providers/database';

export const MediaUploads = app.stream(MediaUploadCompleted, {
	database: Database,
	retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 5_000_000 },
	partitionBy: ({ attachmentId }) => attachmentId,
	authorize: () => false,
});

export const MediaVerification = MediaUploads.onEvent({
	enabled: app.installation.spec.features.media,
	processor: { replicas: 1, concurrency: 4 },
	retry: { maxAttempts: 8, initialDelayMs: 250, maxDelayMs: 30_000, deadLetter: true },
	budgets: { timeoutMs: 60_000, maxInputBytes: 64 * 1_024 },
}, async function verifyUploadedMedia(uploaded, context) {
	await verifyMedia({
		attachmentId: uploaded.attachmentId,
		ownerId: uploaded.ownerId,
		objectKey: uploaded.objectKey,
		contentType: uploaded.contentType,
		byteLength: uploaded.byteLength,
		sha256: uploaded.sha256,
	}, { idempotencyKey: uploaded.sha256, correlationId: context.event.id });
});
