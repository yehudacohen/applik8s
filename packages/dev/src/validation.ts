// typecast-file-boundary: Validation normalizes unknown command payloads after explicit field and discriminant checks.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { DevelopmentCommandClass, DevelopmentValidationEvidence, PlannedValidation } from './contracts.js';
import { redactDevelopmentText } from './redaction.js';

export interface DevelopmentValidationCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly inheritedEnvironment?: readonly string[];
  readonly outputLimitBytes?: number;
}

export type DevelopmentValidationCommands = Readonly<Partial<Record<DevelopmentCommandClass, DevelopmentValidationCommand>>>;

/** Executes only predeclared command classes without a shell or ambient secret inheritance. */
export async function runDevelopmentValidation(options: {
  readonly planId: string;
  readonly validation: PlannedValidation;
  readonly revision: string;
  readonly workspaceRoot: string;
  readonly commands: DevelopmentValidationCommands;
  readonly knownSecretValues?: readonly string[];
  readonly signal?: AbortSignal;
  readonly onEvidence?: (evidence: DevelopmentValidationEvidence) => void | Promise<void>;
}): Promise<DevelopmentValidationEvidence> {
  const definition = options.commands[options.validation.commandClass];
  if (!definition) throw new Error(`Development command class ${options.validation.commandClass} is not configured and cannot be executed.`);
  const startedAt = new Date().toISOString();
  const id = `${options.planId}:${options.validation.id}`;
  const running: DevelopmentValidationEvidence = { id, planId: options.planId, commandClass: options.validation.commandClass, state: 'running', revision: options.revision, startedAt };
  await options.onEvidence?.(running);
  const outputLimit = definition.outputLimitBytes ?? 64 * 1024;
  const result = await runBoundedProcess({ ...definition, cwd: definition.cwd ?? options.workspaceRoot, timeoutMs: options.validation.timeoutMs, outputLimit, ...(options.signal ? { signal: options.signal } : {}) });
  const redactedOutput = redactDevelopmentText(result.output, options.knownSecretValues ?? []).slice(0, outputLimit);
  const evidence: DevelopmentValidationEvidence = {
    ...running,
    state: result.cancelled ? 'cancelled' : result.exitCode === 0 ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    outputDigest: digest(result.output),
    redactedOutput,
  };
  await options.onEvidence?.(evidence);
  return evidence;
}

async function runBoundedProcess(options: DevelopmentValidationCommand & { readonly cwd: string; readonly timeoutMs: number; readonly outputLimit: number; readonly signal?: AbortSignal }): Promise<{ readonly exitCode: number | null; readonly output: string; readonly cancelled: boolean }> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30 * 60_000) throw new Error('Development validation timeout must be between 1ms and 30 minutes.');
  const inherited = Object.fromEntries((options.inheritedEnvironment ?? ['PATH', 'HOME', 'TMPDIR']).flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!] as const]));
  const child = spawn(options.executable, [...options.args], { cwd: options.cwd, env: { ...inherited, ...options.environment }, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: false });
  let output = '';
  const append = (chunk: Buffer): void => { if (Buffer.byteLength(output) < options.outputLimit) output += chunk.toString('utf8').slice(0, options.outputLimit - Buffer.byteLength(output)); };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  let cancelled = false;
  const terminate = (): void => { cancelled = true; child.kill('SIGTERM'); };
  options.signal?.addEventListener('abort', terminate, { once: true });
  const timeout = setTimeout(terminate, options.timeoutMs);
  try {
    const exitCode = await new Promise<number | null>((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
    return { exitCode, output, cancelled };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', terminate);
  }
}

function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
