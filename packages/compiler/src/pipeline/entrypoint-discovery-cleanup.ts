import { rmSync } from 'node:fs';

const deferredTemporaryDirectoryCleanups = new Set<string>();
let temporaryDirectoryCleanupRegistered = false;

export function deferTemporaryDirectoryCleanup(directory: string): void {
  if (process.env.APPLIK8S_KEEP_TMP === '1') return;
  deferredTemporaryDirectoryCleanups.add(directory);
  if (temporaryDirectoryCleanupRegistered) return;
  temporaryDirectoryCleanupRegistered = true;
  process.once('exit', () => {
    for (const cleanupDirectory of deferredTemporaryDirectoryCleanups) {
      rmSync(cleanupDirectory, { recursive: true, force: true });
    }
    deferredTemporaryDirectoryCleanups.clear();
  });
}
