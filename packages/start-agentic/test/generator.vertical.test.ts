import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverApplicationGraph } from '@applik8s/compiler';
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
    expect(providers.match(/clusterName: 'application-db'/g)).toHaveLength(3);
    expect(providers.match(/name: 'application-db-app'/g)).toHaveLength(3);
    expect(providers).toContain("migrations: { path: '../drizzle' }");
    expect(providers).not.toContain('export const authenticate');
    expect(providers).not.toContain('application.database.postgres');
    const applicationSource = await readFile(
      join(target, 'src/application.ts'),
      'utf8',
    );
    expect(applicationSource).not.toContain('authenticate,');
    const modules = await readFile(join(target, 'src/modules.ts'), 'utf8');
    expect(modules).toContain(
      "import { conversations } from '@applik8s/conversations';",
    );
    expect(modules).toContain("group: 'agentic-commands'");
    expect(modules).toContain(
      'conversations(application, { database, processor })',
    );
    expect(modules).toContain(
      "import { operationsControlCenter } from '@applik8s/operations-ui';",
    );
    expect(modules).toContain(
      'export const Operations = operationsControlCenter(application, {',
    );
    const manifest = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly dependencies: Readonly<Record<string, string>>;
      readonly applik8s: Readonly<Record<string, string>>;
    };
    expect(manifest.scripts.plan).toBe('applik8s plan');
    expect(manifest.scripts.deploy).toBe('applik8s deploy');
    expect(manifest.scripts.status).toBe('applik8s status');
    expect(manifest.scripts.destroy).toBe('applik8s destroy');
    expect(manifest.applik8s).toEqual({
      entrypoint: 'src/application.ts',
      compositionName: 'application',
      instance: 'kubernetes/application.yaml',
      outDir: '.applik8s/deploy',
    });
    expect(manifest.dependencies['@tanstack/react-start']).toBe('1.168.28');
    expect(manifest.dependencies['@tanstack/react-router']).toBe('1.168.28');
    expect(manifest.dependencies['@applik8s/start-agentic']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@applik8s/operations-ui']).toBe(
      'workspace:*',
    );
    expect(manifest.dependencies['@tanstack/ai-react']).toBe('0.18.1');
    expect(
      await readFile(join(target, 'kubernetes/application.yaml'), 'utf8'),
    ).toContain('kind: ResearchWorkspace');
    expect(
      await readFile(join(target, 'src/routes/operations.tsx'), 'utf8'),
    ).toContain('ApplicationOperationsControlCenter');
  });

  it('generates the file-route tree after installing the generated application', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'applik8s-agentic-start-install-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'research-workspace');
    const commands: ApplicationStartCommand[] = [];

    await createApplicationAgenticStart({
      targetDirectory: target,
      applik8sVersion: 'workspace:*',
      async run(command) {
        commands.push(command);
        if (commands.length !== 1) return;
        await mkdir(join(target, 'src/routes'), { recursive: true });
        await writeFile(
          join(target, 'package.json'),
          `${JSON.stringify({
            dependencies: {
              '@tanstack/react-start': '1.168.28',
              '@tanstack/react-router': '1.168.28',
            },
          })}\n`,
        );
        await writeFile(
          join(target, 'src/routes/index.tsx'),
          'export const upstream = true;\n',
        );
      },
    });

    expect(commands.slice(1)).toEqual([
      {
        executable: 'bun',
        arguments: ['install'],
        cwd: target,
      },
      {
        executable: 'bun',
        arguments: ['run', 'db:generate'],
        cwd: target,
      },
      {
        executable: 'bun',
        arguments: ['run', 'generate-routes'],
        cwd: target,
      },
    ]);
  });

  it(
    'emits an application entrypoint that the real compiler discovers as one graph',
    async () => {
      const temporaryRoot = join(process.cwd(), '.applik8s-tmp');
      await mkdir(temporaryRoot, { recursive: true });
      const parent = await mkdtemp(
        join(temporaryRoot, 'agentic-start-discovery-'),
      );
      temporaryDirectories.push(parent);
      const target = join(parent, 'research-workspace');

      await createApplicationAgenticStart({
        targetDirectory: target,
        applik8sVersion: 'workspace:*',
        install: false,
        async run() {
          await mkdir(join(target, 'src/routes'), { recursive: true });
          await writeFile(
            join(target, 'package.json'),
            `${JSON.stringify({
              dependencies: {
                '@tanstack/react-start': '1.168.28',
                '@tanstack/react-router': '1.168.28',
              },
            })}\n`,
          );
          await writeFile(
            join(target, 'src/routes/index.tsx'),
            'export const upstream = true;\n',
          );
        },
      });

      const result = await discoverApplicationGraph(
        join(target, 'src/application.ts'),
        'application',
      );
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.value.metadata.name).toBe('research-workspace');
      expect(
        result.value.nodes
          .filter((node) => node.kind === 'model')
          .map((model) => model.name),
      ).toContain(
        'ResearchNote',
      );
      expect(
        result.value.nodes
          .filter((node) => node.kind === 'aiAgent')
          .map((agent) => agent.name),
      ).toContain(
        'researcher',
      );
    },
    30_000,
  );
});
