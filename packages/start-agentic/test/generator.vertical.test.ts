import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ApplicationStartCommand,
  createApplicationAgenticStart,
} from '@applik8s/start-agentic';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Agentic Start generator', () => {
  it('overlays the exact official TanStack Start scaffold and reuses the qualified database authority', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'applik8s-agentic-start-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'research-workspace');
    const commands: ApplicationStartCommand[] = [];

    const result = await createApplicationAgenticStart({
      targetDirectory: target,
      applik8sVersion: 'workspace:*',
      install: false,
      async run(command) {
        commands.push(command);
        await mkdir(join(target, 'src/routes'), { recursive: true });
        await writeFile(
          join(target, 'package.json'),
          `${JSON.stringify({
            name: 'upstream',
            scripts: { dev: 'vite --port 3000' },
            dependencies: {
              '@tanstack/react-start': '1.168.28',
              '@tanstack/react-router': '1.168.28',
              react: '^19.1.0',
            },
          })}\n`,
        );
        await writeFile(
          join(target, 'src/routes/index.tsx'),
          'export const upstream = true;\n',
        );
      },
    });

    expect(commands).toEqual([
      {
        executable: 'bunx',
        arguments: [
          '@tanstack/cli@0.70.1',
          'create',
          'research-workspace',
          '--target-dir',
          target,
          '--blank',
          '--package-manager',
          'bun',
          '--no-git',
          '--no-install',
          '-y',
        ],
        cwd: parent,
      },
    ]);
    expect(result.upstream).toEqual({
      package: '@tanstack/cli',
      version: '0.70.1',
    });
    const providers = await readFile(join(target, 'src/providers.ts'), 'utf8');
    expect(providers).toContain(
      "application.database.bind('application', {",
    );
    expect(providers).toContain(
      'provider: application.inject(PrimaryDatabase)',
    );
    expect(providers).not.toContain('application.database.postgres');
    const modules = await readFile(join(target, 'src/modules.ts'), 'utf8');
    expect(modules).toContain(
      "import { conversations } from '@applik8s/conversations';",
    );
    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
    };
    expect(manifest.scripts.deploy).toBe(
      'applik8s deploy src/application.ts',
    );
    expect(manifest.dependencies['@tanstack/react-start']).toBe('1.168.28');
    expect(manifest.dependencies['@tanstack/react-router']).toBe('1.168.28');
    expect(manifest.dependencies['@applik8s/start-agentic']).toBe(
      'workspace:*',
    );
  });
});
