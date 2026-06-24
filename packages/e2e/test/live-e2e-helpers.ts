import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe } from 'vitest';

const execFileAsync = promisify(execFile);

export function describeLive(name: string, factory: () => void): void {
  describeOptInE2e(name, 'APPLIK8S_E2E_LIVE', factory);
}

export function describeGeneratedArtifacts(name: string, factory: () => void): void {
  describeOptInE2e(name, 'APPLIK8S_E2E', factory);
}

function describeOptInE2e(name: string, envVar: string, factory: () => void): void {
  const enabled = process.env[envVar] === '1';
  const title = enabled ? name : `${name} (skipped; set ${envVar}=1${process.env.APPLIK8S_E2E_CONTEXT ? '' : ' and APPLIK8S_E2E_CONTEXT for context pinning'} to run)`;
  (enabled ? describe : describe.skip)(title, factory);
}

export async function assertExpectedKubectlContext(): Promise<void> {
  const expectedContext = process.env.APPLIK8S_E2E_CONTEXT;
  const context = await kubectl(['config', 'current-context']);
  if (expectedContext && context.stdout.trim() !== expectedContext) {
    throw new Error(`Expected kubectl context ${expectedContext}, got ${context.stdout.trim()}.`);
  }
}

export async function generatedManifestPaths(directory: string): Promise<readonly string[]> {
  const yamlNames = (await readdir(directory)).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml')).sort();
  if (yamlNames.length === 0) {
    throw new Error(`Generated manifest directory contains no YAML files: ${directory}.`);
  }
  return yamlNames.map((name) => join(directory, name));
}

export async function kubectl(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return exec('kubectl', args, process.cwd());
}

export async function docker(args: readonly string[], cwd: string): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return exec('docker', args, cwd);
}

export async function exec(command: string, args: readonly string[], cwd: string): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await execFileAsync(command, args, { cwd, env: process.env, maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`${command} ${args.join(' ')} failed: ${error.message}`);
    }
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}

export function formatSettledOutput(result: PromiseSettledResult<{ readonly stdout: string; readonly stderr: string }>): string {
  if (result.status === 'fulfilled') {
    return `${result.value.stdout}\n${result.value.stderr}`.trim();
  }
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function logsIncludesOperationKind(logs: string, kind: string): boolean {
  return logs.includes(`kind: "${kind}"`) || logs.includes(`kind: \\"${kind}\\"`) || logs.includes(`"kind":"${kind}"`) || logs.includes(`\\"kind\\":\\"${kind}\\"`);
}

export function logsIncludeJsonField(logs: string, field: string, value: string): boolean {
  return logs.includes(`${field}: "${value}"`)
    || logs.includes(`${field}: \\"${value}\\"`)
    || logs.includes(`"${field}":"${value}"`)
    || logs.includes(`\\"${field}\\":\\"${value}\\"`);
}

export async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
