import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Load an application's layered environment files into the operation host.
 *
 * Values already exported by the invoking process remain authoritative. The
 * function intentionally returns only whether a file existed; it never exposes
 * names or values to deployment diagnostics.
 */
export async function loadApplicationEnvironmentFile(cwd) {
  const fileEnvironment = {};
  let loaded = false;
  for (const name of ['.env.defaults', '.env', '.env.local']) {
    try {
      const parsed = parseEnv(await readFile(resolve(cwd, name), 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        // Generated starter files deliberately include blank secret
        // placeholders. A later `.env.local` placeholder must not erase a
        // populated `.env` value; non-empty local values still override and
        // the exported operation-host environment remains authoritative.
        if (value === '' && fileEnvironment[key]) continue;
        fileEnvironment[key] = value;
      }
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
