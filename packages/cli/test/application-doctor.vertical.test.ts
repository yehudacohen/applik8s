import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ApplicationDoctorCheck,
  runApplicationDoctor,
} from '../src/application-doctor-command.js';
import { describe, expect, it } from 'vitest';

describe('applik8s doctor', () => {
  it('reports only environment names and uses an explicit read-only cluster probe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-doctor-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'kubernetes'));
    await writeFile(join(root, 'src/application.ts'), 'export {};\n');
    await writeFile(join(root, 'kubernetes/application.yaml'), 'spec: {}\n');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        applik8s: {
          entrypoint: 'src/application.ts',
          instance: 'kubernetes/application.yaml',
          context: 'synthetic',
        },
      }),
    );
    await writeFile(
      join(root, '.env.example'),
      '# OPENROUTER_API_KEY=\n# STRIPE_SECRET_KEY=\n',
    );
    const output: string[] = [];
    const probe: readonly ApplicationDoctorCheck[] = [{
      id: 'kubernetes.reachable',
      state: 'pass',
      summary: 'Synthetic cluster is reachable.',
    }];

    const code = await runApplicationDoctor(
      { json: true },
      {
        cwd: root,
        stdout: (message) => output.push(message),
        stderr: () => undefined,
      },
      {
        environment: {
          OPENROUTER_API_KEY: 'must-never-appear',
        },
        probeCluster: async (context) => {
          expect(context).toBe('synthetic');
          return probe;
        },
      },
    );

    expect(code).toBe(0);
    // typecast: successful doctor JSON is narrowed to the exact public fields asserted below.
    const report = JSON.parse(output.join('')) as {
      readonly context: string;
      readonly checks: readonly {
        readonly id: string;
        readonly summary: string;
        readonly detail?: string;
      }[];
    };
    expect(report.context).toBe('synthetic');
    expect(report.checks).toContainEqual(probe[0]);
    expect(report.checks.find((check) => check.id === 'environment.names'))
      .toMatchObject({
        summary:
          '2 operation-host environment name(s) documented; 1 exported by the current process.',
        detail:
          'Names only: OPENROUTER_API_KEY, STRIPE_SECRET_KEY. Values were not read or printed.',
      });
    expect(output.join('')).not.toContain('must-never-appear');
  });

  it('fails closed when project paths or explicit context are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-doctor-missing-'));
    await writeFile(join(root, 'package.json'), '{}\n');
    const output: string[] = [];

    const code = await runApplicationDoctor(
      {},
      {
        cwd: root,
        stdout: (message) => output.push(message),
        stderr: () => undefined,
      },
      { environment: {} },
    );

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('FAIL kubernetes.context');
    expect(output.join('\n')).toContain('FAIL project.entrypoint');
    expect(output.join('\n')).not.toContain('current-context');
  });
});
