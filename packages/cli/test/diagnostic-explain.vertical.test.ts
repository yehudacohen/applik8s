import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

describe('applik8s explain diagnostic registry', () => {
  it('explains every cataloged diagnostic without compiling an application', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ['explain', 'RESEARCH_QUERY_INVALID', '--skip-app-build'],
      {
        cwd: '/directory-that-must-not-be-read',
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('\n')).toContain('RESEARCH_QUERY_INVALID');
    expect(stdout.join('\n')).toContain('package:@applik8s/research');
    expect(stdout.join('\n')).toContain(
      'reference/diagnostics.mdx#diagnostic-research-query-invalid',
    );
  });

  it('fails unknown diagnostic-looking identifiers without treating them as operations', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(['explain', 'UNKNOWN_RELEASE_DIAGNOSTIC'], {
      cwd: '/directory-that-must-not-be-read',
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      expect.stringContaining('Unknown diagnostic code'),
    ]);
  });
});
