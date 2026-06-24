import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { OperatorManifest, Result } from '@applik8s/core';
import { imageRefString } from '@applik8s/typetainer';

const execFileAsync = promisify(execFile);

export interface RuntimeImageBuildRequest {
  readonly manifest: OperatorManifest;
  readonly docker?: string;
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
  try {
    const { stdout, stderr } = await execFileAsync(request.docker ?? 'docker', [
      'build',
      '--file',
      recipe.build.dockerfile,
      '--tag',
      image,
      recipe.build.context,
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
