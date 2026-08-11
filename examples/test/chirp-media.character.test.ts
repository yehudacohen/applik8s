import { normalizeSchema } from '@applik8s/sdk';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverApplicationGraph } from '../../packages/compiler/src/pipeline/index.js';

describe.sequential('Chirp durable media processing', () => {
	it('connects a bounded canonical stream processor to a typed task, object store, and model operation', async () => {
		const discovered = await discoverApplicationGraph(
			join(process.cwd(), 'examples/chirp-start/src/application.ts'),
			'app',
		);
		if (!discovered.ok) throw new Error(discovered.error.message);
		expect(discovered.ok).toBe(true);
		const graph = discovered.value;
		const processor = graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'verify-uploaded-media');
		const workflowHandler = graph.nodes.find((node) => node.kind === 'workflowHandler' && node.name === 'media.verify.v1');
		const taskHandler = graph.nodes.find((node) => node.kind === 'taskHandler' && node.name === 'media.verify.v1.step');
		expect(processor).toMatchObject({
			kind: 'streamProcessor', enabled: expect.anything(), failure: 'deadLetter',
			deployment: { replicas: 1, concurrency: 4 }, budgets: { timeoutMs: 60_000, maxInputBytes: 65_536 },
			tasks: [{ alias: 'verifyMedia', target: { nodeId: 'workflow.media.verify.v1' } }],
		});
		expect(workflowHandler).toMatchObject({
			kind: 'workflowHandler', tasks: [{ nodeId: 'task.media.verify.v1.step' }],
		});
		expect(taskHandler).toMatchObject({
			kind: 'taskHandler', objects: [{ alias: 'Attachments', store: { nodeId: 'objectStore.attachments' } }],
			operations: [{ alias: 'MediaModel.update' }], effectBoundary: 'externalEffectsAllowed',
		});
		expect(graph?.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ from: { nodeId: 'streamProcessor.verify-uploaded-media' }, to: { nodeId: 'workflow.media.verify.v1' }, relationship: 'dependsOn' }),
			expect.objectContaining({ from: { nodeId: 'task-handler.media.verify.v1.step' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'reads' }),
		]));
		expect(taskHandler && 'handlerSource' in taskHandler ? taskHandler.handlerSource : '').toContain('download-checksum-mismatch');
		expect(taskHandler && 'operationPrincipalSource' in taskHandler ? taskHandler.operationPrincipalSource : '').toContain('media-worker');
	}, 30_000);

	it('declares upload and outcome events as replayable schemas', async () => {
		// static-import-exception: load authoring modules only after isolated compiler discovery so portable readiness registries are not initialized twice.
		const { MediaProcessingChanged, MediaUploadCompleted } = await import('../chirp-start/src/domain/events');
		expect(normalizeSchema(MediaUploadCompleted.payload, MediaUploadCompleted.id).validate({
			attachmentId: 'attachment-1', ownerId: 'account-1', objectKey: 'account-1/attachment-1',
			contentType: 'image/png', byteLength: '8', sha256: 'a'.repeat(64), completedAt: '2026-07-21T12:00:00.000Z',
		}).ok).toBe(true);
		expect(normalizeSchema(MediaProcessingChanged.payload, MediaProcessingChanged.id).validate({
			attachmentId: 'attachment-1', ownerId: 'account-1', processingState: 'ready',
			reason: 'verified-size-type-checksum-signature', changedAt: '2026-07-21T12:00:01.000Z',
		}).ok).toBe(true);
	});

	it('recognizes supported media signatures and the standard harmless malware-test marker', async () => {
		// static-import-exception: preserve the compiler-first module-isolation order established by this sequential character suite.
		const { containsAscii, matchesMediaSignature } = await import('../chirp-start/src/domain/media');
		expect(matchesMediaSignature('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
		expect(matchesMediaSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
		expect(matchesMediaSignature('image/png', Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(false);
		expect(containsAscii(new TextEncoder().encode('prefix EICAR-STANDARD-ANTIVIRUS-TEST-FILE suffix'), 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE')).toBe(true);
	});
});
