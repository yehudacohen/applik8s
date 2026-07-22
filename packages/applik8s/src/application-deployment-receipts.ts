import { access, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ApplicationDeploymentReceiptScope {
  readonly controlPlaneNamespace: string;
  readonly instanceName: string;
}

/** Resolve a lifecycle receipt beneath one explicit Application instance. */
export function applicationDeploymentReceiptPath(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  fileName: string,
): string {
  return join(
    dirname(bundlePath),
    'receipts',
    encodeURIComponent(scope.controlPlaneNamespace),
    encodeURIComponent(scope.instanceName),
    fileName,
  );
}

export async function existingApplicationDeploymentReceiptPath(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  fileName: string,
): Promise<string | undefined> {
  const scoped = applicationDeploymentReceiptPath(bundlePath, scope, fileName);
  if (await exists(scoped)) return scoped;
  // Legacy flat receipts predate multi-installation support. Once any scoped
  // receipt tree exists, never let a missing instance accidentally consume a
  // different installation's legacy lifecycle evidence.
  const scopedRoot = join(dirname(bundlePath), 'receipts');
  if (await exists(scopedRoot)) return undefined;
  const legacy = join(dirname(bundlePath), fileName);
  return await exists(legacy) ? legacy : undefined;
}

export async function unlinkApplicationDeploymentReceipt(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  fileName: string,
): Promise<void> {
  const path = await existingApplicationDeploymentReceiptPath(bundlePath, scope, fileName);
  if (path) await unlink(path);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}
