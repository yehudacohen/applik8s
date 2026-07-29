// typecast-file-boundary: compiler fixtures inspect erased generated-resource metadata after asserting resource kinds.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationContainer } from '../src/application-containers/index.js';

describe('generated application OCI artifacts', () => {
  it('emits deterministic container() inputs without a Kubernetes source payload', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'applik8s-container-'));
    const sourcePath = join(artifactDir, 'runtime.mjs');
    const sourceMapPath = `${sourcePath}.map`;
    await writeFile(sourcePath, 'console.log("ready");\n//# sourceMappingURL=runtime.mjs.map\n');
    await writeFile(sourceMapPath, '{"version":3,"sources":["runtime.ts"],"mappings":""}\n');

    const first = await emitGeneratedApplicationContainer({
      graphName: 'Flagship App', workloadName: 'Public Gateway', role: 'queryGateway', artifactDir,
      sourcePath, sourceMapPath, entrypoint: '/app/runtime.mjs', baseImage: `node:22-alpine@sha256:${'1'.repeat(64)}`, sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const repeated = await emitGeneratedApplicationContainer({
      graphName: 'Flagship App', workloadName: 'Public Gateway', role: 'queryGateway', artifactDir,
      sourcePath, sourceMapPath, entrypoint: '/app/runtime.mjs', baseImage: `node:22-alpine@sha256:${'1'.repeat(64)}`, sourceDigest: `sha256:${'a'.repeat(64)}`,
    });

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      imageName: 'applik8s/flagship-app-query-gateway-public-gateway',
      image: expect.stringMatching(/^applik8s\/flagship-app-query-gateway-public-gateway:sha-[0-9a-f]{64}$/),
      tag: expect.stringMatching(/^sha-[0-9a-f]{64}$/),
      entrypoint: '/app/runtime.mjs',
    });
    const dockerfile = await readFile(first.dockerfilePath, 'utf8');
    expect(dockerfile).toContain(`ARG APPLIK8S_BASE_IMAGE=node:22-alpine@sha256:${'1'.repeat(64)}`);
    expect(dockerfile).toContain('COPY --chown=1000:1000 runtime.mjs /app/runtime.mjs');
    expect(dockerfile).not.toContain('runtime.mjs.map');
    expect(dockerfile).toContain('CMD ["node","/app/runtime.mjs"]');
  });

  it('can explicitly include provenance-bearing source maps in the image and content tag', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'applik8s-container-provenance-'));
    const sourcePath = join(artifactDir, 'worker.mjs');
    const sourceMapPath = `${sourcePath}.map`;
    await writeFile(sourcePath, 'export const ready = true;\n');
    await writeFile(sourceMapPath, '{"version":3,"mappings":"first"}\n');
    const options = { graphName: 'app', workloadName: 'worker', role: 'processor', artifactDir, sourcePath, sourceMapPath, includeSourceMap: true, entrypoint: '/app/worker.mjs', sourceDigest: `sha256:${'b'.repeat(64)}` } as const;
    const first = await emitGeneratedApplicationContainer({ ...options, baseImage: `node:22-alpine@sha256:${'1'.repeat(64)}` });
    await writeFile(sourceMapPath, '{"version":3,"mappings":"second"}\n');
    const changedMap = await emitGeneratedApplicationContainer({ ...options, baseImage: `node:22-alpine@sha256:${'1'.repeat(64)}` });
    const changedBase = await emitGeneratedApplicationContainer({ ...options, baseImage: `node:22-alpine@sha256:${'2'.repeat(64)}` });

    expect(changedMap.tag).not.toBe(first.tag);
    expect(changedBase.tag).not.toBe(changedMap.tag);
    expect(await readFile(first.dockerfilePath, 'utf8')).toContain('COPY --chown=1000:1000 worker.mjs.map /app/worker.mjs.map');

    const withoutMap = await emitGeneratedApplicationContainer({ ...options, includeSourceMap: false, baseImage: `node:22-alpine@sha256:${'2'.repeat(64)}` });
    expect(await readFile(withoutMap.dockerfilePath, 'utf8')).not.toContain('worker.mjs.map');
    await expect(readFile(join(withoutMap.contextPath, 'worker.mjs.map'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed before writing a context when a generated base image is mutable', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'applik8s-container-mutable-base-'));
    const sourcePath = join(artifactDir, 'runtime.mjs');
    await writeFile(sourcePath, 'console.log("ready");\n');
    await expect(emitGeneratedApplicationContainer({
      graphName: 'app', workloadName: 'gateway', role: 'queryGateway', artifactDir,
      sourcePath, entrypoint: '/app/runtime.mjs', baseImage: 'node:22-alpine', sourceDigest: `sha256:${'a'.repeat(64)}`,
    })).rejects.toThrow(/must be pinned by a full sha256 digest/);
  });
});
