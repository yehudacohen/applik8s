import { readFile } from 'node:fs/promises';
import {
  publishablePackageManifestPaths,
  publishablePackageNames,
} from './publishable-packages.mjs';

const catalogPath = 'docs/packages.md';
const catalog = await readFile(catalogPath, 'utf8');
const packageNames = await Promise.all(
  publishablePackageManifestPaths.map(async (path) => {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${path} must declare a public package name.`);
    }
    if (typeof manifest.description !== 'string' || manifest.description.trim().length === 0) {
      throw new Error(`${path} must explain its public package boundary.`);
    }
    return manifest.name;
  }),
);

const documentedNames = [...catalog.matchAll(/^\| `([^`]+)` \|/gmu)].map(
  ([, name]) => name,
);
const counts = new Map();
for (const name of documentedNames) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

const expected = new Set(packageNames);
const missing = packageNames.filter((name) => counts.get(name) !== 1);
const unexpected = documentedNames.filter((name) => !expected.has(name));
const duplicates = [...counts.entries()]
  .filter(([, count]) => count > 1)
  .map(([name]) => name);

if (publishablePackageNames.length !== packageNames.length) {
  throw new Error('The publishable package manifest list is internally inconsistent.');
}
if (missing.length > 0 || unexpected.length > 0 || duplicates.length > 0) {
  throw new Error(
    [
      `${catalogPath} must list every public package exactly once.`,
      missing.length > 0 ? `Missing or repeated: ${missing.join(', ')}` : undefined,
      unexpected.length > 0 ? `Unexpected: ${unexpected.join(', ')}` : undefined,
      duplicates.length > 0 ? `Repeated: ${duplicates.join(', ')}` : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

console.log(`Package catalog covers all ${packageNames.length} public packages.`);
