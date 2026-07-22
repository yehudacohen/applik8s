import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationDeploymentReceiptPath,
  existingApplicationDeploymentReceiptPath,
  unlinkApplicationDeploymentReceipt,
} from '../src/application-deployment-receipts.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Application deployment receipt scoping', () => {
  it('isolates direct lifecycle evidence by control-plane namespace and instance name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-receipts-'));
    roots.push(root);
    const bundle = join(root, 'typekro', 'typekro-composition.json');
    await mkdir(join(root, 'typekro'), { recursive: true });
    await writeFile(bundle, '{}\n');
    const community = { controlPlaneNamespace: 'chirp-control', instanceName: 'community' };
    const privateSite = { controlPlaneNamespace: 'chirp-control', instanceName: 'private-site' };
    const file = 'application-provider-preparation.json';
    const communityPath = applicationDeploymentReceiptPath(bundle, community, file);
    const privatePath = applicationDeploymentReceiptPath(bundle, privateSite, file);
    await mkdir(dirname(communityPath), { recursive: true });
    await mkdir(dirname(privatePath), { recursive: true });
    await writeFile(communityPath, '{"instance":"community"}\n');
    await writeFile(privatePath, '{"instance":"private-site"}\n');

    expect(await existingApplicationDeploymentReceiptPath(bundle, community, file)).toBe(communityPath);
    expect(await existingApplicationDeploymentReceiptPath(bundle, privateSite, file)).toBe(privatePath);
    await unlinkApplicationDeploymentReceipt(bundle, community, file);
    expect(await existingApplicationDeploymentReceiptPath(bundle, community, file)).toBeUndefined();
    expect(await readFile(privatePath, 'utf8')).toContain('private-site');
  });

  it('reads a legacy flat receipt only before any scoped receipt tree exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-legacy-receipt-'));
    roots.push(root);
    const bundle = join(root, 'typekro', 'typekro-composition.json');
    await mkdir(join(root, 'typekro'), { recursive: true });
    await writeFile(bundle, '{}\n');
    const scope = { controlPlaneNamespace: 'chirp-control', instanceName: 'community' };
    const file = 'container-registry-preparation.json';
    const legacy = join(root, 'typekro', file);
    await writeFile(legacy, '{}\n');
    expect(await existingApplicationDeploymentReceiptPath(bundle, scope, file)).toBe(legacy);

    await mkdir(join(root, 'typekro', 'receipts'), { recursive: true });
    expect(await existingApplicationDeploymentReceiptPath(bundle, scope, file)).toBeUndefined();
  });
});
