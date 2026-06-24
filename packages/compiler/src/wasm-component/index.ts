import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { componentize } from '@bytecodealliance/componentize-js';

import type { Result } from '@applik8s/core';

export interface WasmComponentArtifactOptions {
  readonly javascriptBundlePath: string;
  readonly witPath: string;
  readonly outDir: string;
  readonly fileName?: string;
  readonly worldName?: string;
  readonly disableFeatures?: readonly ('stdio' | 'random' | 'clocks' | 'http' | 'fetch-event')[];
}

export interface WasmComponentArtifact {
  readonly path: string;
  readonly digest: string;
  readonly imports: readonly unknown[];
  readonly backend: 'componentize-js';
}

export async function emitWasmComponentArtifact(options: WasmComponentArtifactOptions): Promise<Result<WasmComponentArtifact>> {
  const path = join(options.outDir, options.fileName ?? 'handler.wasm');

  try {
    await mkdir(dirname(path), { recursive: true });
    const output = await componentize({
      sourcePath: options.javascriptBundlePath,
      witPath: options.witPath,
      worldName: options.worldName ?? 'handler',
      disableFeatures: [...(options.disableFeatures ?? ['stdio', 'random', 'clocks'])],
      env: false,
    });

    await writeFile(path, output.component);

    return {
      ok: true,
      value: {
        path,
        digest: `sha256:${createHash('sha256').update(output.component).digest('hex')}`,
        imports: output.imports,
        backend: 'componentize-js',
      },
    };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: cause instanceof Error ? cause.message : 'ComponentizeJS failed to emit a WASM component.',
        severity: 'error',
        context: {},
      },
    };
  }
}
