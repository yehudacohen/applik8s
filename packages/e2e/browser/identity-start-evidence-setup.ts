import { join } from 'node:path';
import { discardV06Evidence } from '../../../scripts/v06-evidence';

export default async function prepareIdentityStartBrowserEvidence(): Promise<void> {
  const profile = process.env.APPLIK8S_IDENTITY_START_PROFILE ?? 'starter';
  if (!['starter', 'dedicated', 'external'].includes(profile)) {
    throw new Error(
      `Unsupported Identity Start evidence profile ${JSON.stringify(profile)}.`,
    );
  }
  const directory = join(process.cwd(), '.applik8s-tmp/evidence/v0.7');
  await Promise.all([
    discardV06Evidence(
      join(directory, `identity-start-${profile}-browser.json`),
    ),
    discardV06Evidence(
      join(directory, `identity-start-${profile}-browser-results.json`),
    ),
  ]);
}
