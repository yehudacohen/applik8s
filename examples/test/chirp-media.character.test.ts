import { applicationGraphFor } from '@applik8s/applik8s';
import { normalizeSchema } from '@applik8s/sdk';
import { describe, expect, it } from 'vitest';
import { app } from '../chirp-start/src/app';
import { MediaProcessingChanged, MediaUploadCompleted } from '../chirp-start/src/domain/events';
import { containsAscii, matchesMediaSignature } from '../chirp-start/src/domain/media';
import '../chirp-start/src/models';

describe('Chirp durable media processing', () => {
	it('declares upload and outcome events as replayable schemas', () => {
		expect(normalizeSchema(MediaUploadCompleted.payload, MediaUploadCompleted.id).validate({
			attachmentId: 'attachment-1', ownerId: 'account-1', objectKey: 'account-1/attachment-1',
			contentType: 'image/png', byteLength: '8', sha256: 'a'.repeat(64), completedAt: '2026-07-21T12:00:00.000Z',
		}).ok).toBe(true);
		expect(normalizeSchema(MediaProcessingChanged.payload, MediaProcessingChanged.id).validate({
			attachmentId: 'attachment-1', ownerId: 'account-1', processingState: 'ready',
			reason: 'verified-size-type-checksum-signature', changedAt: '2026-07-21T12:00:01.000Z',
		}).ok).toBe(true);
	});

	it('connects a bounded canonical stream processor to a typed task, object store, and model operation', () => {
		const graph = applicationGraphFor(app.composition);
		const processor = graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'verify-uploaded-media');
		const handler = graph?.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'media.verify.v1');
		expect(processor).toMatchObject({
			kind: 'streamProcessor', enabled: expect.anything(), failure: 'deadLetter',
			deployment: { replicas: 1, concurrency: 4 }, budgets: { timeoutMs: 60_000, maxInputBytes: 65_536 },
			tasks: [{ alias: 'verify', target: { nodeId: 'task.media.verify.v1' } }],
		});
		expect(handler).toMatchObject({
			kind: 'taskHandler', objects: [{ alias: 'attachments', store: { nodeId: 'objectStore.attachments' } }],
			operations: [{ alias: 'updateMedia' }], effectBoundary: 'externalEffectsAllowed',
		});
		expect(graph?.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ from: { nodeId: 'streamProcessor.verify-uploaded-media' }, to: { nodeId: 'task.media.verify.v1' }, relationship: 'dependsOn' }),
			expect.objectContaining({ from: { nodeId: 'task-handler.media.verify.v1' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'reads' }),
		]));
		expect(handler && 'handlerSource' in handler ? handler.handlerSource : '').toContain('download-checksum-mismatch');
		expect(handler && 'operationPrincipalSource' in handler ? handler.operationPrincipalSource : '').toContain('media-worker');
	});

	it('recognizes supported media signatures and the standard harmless malware-test marker', () => {
		expect(matchesMediaSignature('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
		expect(matchesMediaSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
		expect(matchesMediaSignature('image/png', Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(false);
		expect(containsAscii(new TextEncoder().encode('prefix EICAR-STANDARD-ANTIVIRUS-TEST-FILE suffix'), 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE')).toBe(true);
	});
});
