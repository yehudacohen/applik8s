import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Load an application's root `.env` into the operation host.
 *
 * Values already exported by the invoking process remain authoritative. The
 * function intentionally returns only whether a file existed; it never exposes
 * names or values to deployment diagnostics.
 */
export async function loadApplicationEnvironmentFile(cwd) {
  const fileEnvironment = {};
  let loaded = false;
  for (const name of ['.env', '.env.local']) {
    try {
      Object.assign(
        fileEnvironment,
        parseEnv(await readFile(resolve(cwd, name), 'utf8')),
      );
      loaded = true;
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  const exportedEnvironment = { ...process.env };
  Object.assign(process.env, fileEnvironment, exportedEnvironment);
  return loaded;
}
