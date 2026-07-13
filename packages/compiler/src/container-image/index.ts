import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { OperatorManifest, Result } from '@applik8s/core';
import { imageRefString, type ImageRefInput } from '@applik8s/typetainer';

const execFileAsync = promisify(execFile);

export interface RuntimeImageBuildRequest {
  readonly manifest: OperatorManifest;
  readonly docker?: string;
  /** Explicit local/test base image override. Release artifacts remain pinned in the manifest and Dockerfile default. */
  readonly baseImage?: ImageRefInput;
}

export interface RuntimeImageBuildResult {
  readonly image: string;
  readonly stdout: string;
  readonly stderr: string;
}

export async function buildImplicitRuntimeImage(request: RuntimeImageBuildRequest): Promise<Result<RuntimeImageBuildResult>> {
  const recipe = request.manifest.spec.container;
  if (!recipe?.build?.context || !recipe.build.dockerfile) {
    return error('Operator manifest is missing an implicit runtime image build recipe.');
  }

  const image = imageRefString(recipe.image);
  const baseImage = request.baseImage ?? process.env.APPLIK8S_BASE_IMAGE;
  try {
    const { stdout, stderr } = await execFileAsync(request.docker ?? 'docker', [
      'build',
      ...(baseImage ? ['--build-arg', `APPLIK8S_BASE_IMAGE=${imageRefString(baseImage)}`] : []),
      '--file',
      recipe.build.dockerfile,
      '--tag',
      image,
      '.',
    ], {
      cwd: recipe.build.context,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, value: { image, stdout, stderr } };
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'Failed to build implicit runtime image.');
  }
}

function error(message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'BUNDLE_INVALID',
      message,
      severity: 'error',
      context: {},
      recovery: { summary: 'Ensure Docker or an OCI-compatible builder is available, then rebuild the operator bundle.' },
    },
  };
}
