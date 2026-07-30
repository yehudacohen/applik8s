import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { collectV06GitIdentity } from '../../../scripts/v06-evidence.js';

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('v0.6 release evidence identity', () => {
  it('excludes generated Applik8s output while detecting authored candidate changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-v06-evidence-'));
    roots.push(root);
    await run('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, '.gitignore'), '.applik8s/\n.output/\n.vinxi/\n.tanstack/\n');
    await writeFile(join(root, 'application.ts'), 'export const version = 1;\n');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['-c', 'user.name=Applik8s Test', '-c', 'user.email=test@applik8s.dev', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });

    const initial = await collectV06GitIdentity(root);
    await mkdir(join(root, '.applik8s', 'deploy'), { recursive: true });
    await writeFile(join(root, '.applik8s', 'deploy', 'application-graph.json'), '{"generated":1}\n');
    await mkdir(join(root, 'examples', 'chirp', '.applik8s'), { recursive: true });
    await writeFile(join(root, 'examples', 'chirp', '.applik8s', 'image-evidence.json'), '{"generated":2}\n');
    await mkdir(join(root, 'examples', 'chirp', '.output', 'server'), { recursive: true });
    await writeFile(join(root, 'examples', 'chirp', '.output', 'server', 'index.mjs'), 'generated build 1\n');
    await mkdir(join(root, 'examples', 'chirp', '.vinxi'), { recursive: true });
    await writeFile(join(root, 'examples', 'chirp', '.vinxi', 'manifest.json'), '{"generated":3}\n');
    await mkdir(join(root, 'examples', 'chirp', '.tanstack'), { recursive: true });
    await writeFile(join(root, 'examples', 'chirp', '.tanstack', 'manifest.json'), '{"generated":4}\n');
    const generated = await collectV06GitIdentity(root);
    expect(generated).toEqual(initial);

    await writeFile(join(root, 'examples', 'chirp', '.output', 'server', 'index.mjs'), 'generated build 2\n');
    expect(await collectV06GitIdentity(root)).toEqual(initial);

    await writeFile(join(root, 'application.ts'), 'export const version = 2;\n');
    const authored = await collectV06GitIdentity(root);
    expect(authored.dirty).toBe(true);
    expect(authored.workingTreeDigest).not.toBe(initial.workingTreeDigest);
  });
});
