import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Result } from '@applik8s/core';
import { assertCanonicalRuntimeContract, canonicalHandlerWit as runtimeContractHandlerWit, canonicalRuntimeContract, type CanonicalRuntimeContract } from '@applik8s/runtime-contract';

export interface RuntimeContractArtifactOptions {
  readonly outDir: string;
  readonly fileName?: string;
}

export interface RuntimeContractArtifact {
  readonly path: string;
  readonly digest: string;
  readonly contract: CanonicalRuntimeContract;
}

export interface HandlerWitArtifactOptions {
  readonly outDir: string;
  readonly fileName?: string;
}

export interface HandlerWitArtifact {
  readonly path: string;
  readonly digest: string;
  readonly witSource: string;
}

export async function emitRuntimeContractArtifact(options: RuntimeContractArtifactOptions): Promise<Result<RuntimeContractArtifact>> {
  const contract = canonicalRuntimeContract();
  const path = join(options.outDir, options.fileName ?? 'runtime-contract.json');
  const text = `${JSON.stringify(contract, null, 2)}\n`;

  try {
    assertCanonicalRuntimeContract(contract);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);

    return { ok: true, value: { path, digest: digestText(text), contract } };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: cause instanceof Error ? cause.message : 'Failed to emit runtime contract artifact.',
        severity: 'error',
        context: {},
      },
    };
  }
}

export async function emitHandlerWitArtifact(options: HandlerWitArtifactOptions): Promise<Result<HandlerWitArtifact>> {
  const path = join(options.outDir, options.fileName ?? 'applik8s-handler.wit');
  const witSource = canonicalHandlerWit();

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, witSource);

    return { ok: true, value: { path, digest: digestText(witSource), witSource } };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: cause instanceof Error ? cause.message : 'Failed to emit handler WIT artifact.',
        severity: 'error',
        context: {},
      },
    };
  }
}

export function canonicalHandlerWit(): string {
  return runtimeContractHandlerWit();
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
