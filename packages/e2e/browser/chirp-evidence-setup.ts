import { join } from 'node:path';
import { discardV06Evidence } from '../../../scripts/v06-evidence';

export default async function prepareChirpBrowserEvidence(): Promise<void> {
  const directory = join(process.cwd(), '.applik8s-tmp/evidence/v0.6');
  await Promise.all([
    discardV06Evidence(join(directory, 'chirp-browser.json')),
    discardV06Evidence(join(directory, 'chirp-browser-results.json')),
  ]);
}
