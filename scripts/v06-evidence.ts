import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface V06GitIdentity {
  readonly commit: string;
  readonly dirty: boolean;
  readonly workingTreeDigest: string;
}

export interface V06ClusterIdentity {
  readonly context: string;
  readonly uid: string;
}

export interface V06InstallationIdentity {
  readonly apiVersion: string;
  readonly kind: string;
  readonly namespace: string;
  readonly name: string;
  readonly uid: string;
  readonly generation: number;
}

export interface V06ArtifactIdentity {
  readonly artifactSetDigest: string;
  readonly applicationGraphDigest: string;
}

export interface V06CandidateIdentity {
  readonly git: V06GitIdentity;
  readonly cluster?: V06ClusterIdentity;
  readonly installation?: V06InstallationIdentity;
  readonly artifacts?: V06ArtifactIdentity;
}

export interface V06AssertionEvidence {
  readonly assertion: string;
  readonly test: string;
  readonly runId: string;
  readonly observedAt: string;
}

export interface V06EvidenceReceipt {
  readonly schemaVersion: 3;
  readonly suite: string;
  readonly run: {
    readonly id: string;
    readonly startedAt: string;
    readonly completedAt: string;
  };
  readonly completedAt: string;
  readonly candidate: V06CandidateIdentity;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly assertions: readonly string[];
  readonly assertionEvidence: readonly V06AssertionEvidence[];
}

export async function collectV06GitIdentity(root = process.cwd()): Promise<V06GitIdentity> {
  const [{ stdout: commit }, { stdout: status }, { stdout: listed }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: root, maxBuffer: 100 * 1024 * 1024 }),
    execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      maxBuffer: 100 * 1024 * 1024,
    }),
  ]);
  const files = listed.split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const relativePath of files) {
    const path = join(root, relativePath);
    digest.update(relativePath);
    digest.update('\0');
    const metadata = await lstat(path).catch((error: unknown) => {
      if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return undefined;
      throw error;
    });
    if (!metadata) {
      digest.update('deleted\0');
      continue;
    }
    digest.update(metadata.isSymbolicLink() ? 'symlink' : metadata.mode & 0o111 ? 'executable' : 'file');
    digest.update('\0');
    digest.update(metadata.isSymbolicLink() ? await readlink(path) : await readFile(path));
    digest.update('\0');
  }
  return {
    commit: commit.trim(),
    dirty: status.trim().length > 0,
    workingTreeDigest: `sha256:${digest.digest('hex')}`,
  };
}

export async function collectV06ClusterIdentity(context: string): Promise<V06ClusterIdentity> {
  const { stdout } = await execFileAsync('kubectl', [
    '--context', context,
    'get', 'namespace/kube-system',
    '--output=json',
  ]);
  const namespace = jsonObject(stdout, 'kube-system Namespace');
  const metadata = objectField(namespace, 'metadata');
  return { context, uid: stringField(metadata, 'uid') };
}

export async function collectV06InstallationIdentity(input: {
  readonly context: string;
  readonly resource: string;
  readonly namespace: string;
}): Promise<V06InstallationIdentity> {
  const { stdout } = await execFileAsync('kubectl', [
    '--context', input.context,
    'get', input.resource,
    '--namespace', input.namespace,
    '--output=json',
  ]);
  const installation = jsonObject(stdout, input.resource);
  const metadata = objectField(installation, 'metadata');
  const generation = metadata.generation;
  if (!Number.isSafeInteger(generation) || Number(generation) < 1) {
    throw new Error(`${input.resource} has an invalid metadata.generation.`);
  }
  return {
    apiVersion: stringField(installation, 'apiVersion'),
    kind: stringField(installation, 'kind'),
    namespace: stringField(metadata, 'namespace'),
    name: stringField(metadata, 'name'),
    uid: stringField(metadata, 'uid'),
    generation: Number(generation),
  };
}

export async function collectV06ArtifactIdentity(path: string): Promise<V06ArtifactIdentity> {
  const evidence = jsonObject(await readFile(path, 'utf8'), 'application image evidence');
  const graph = objectField(evidence, 'applicationGraph');
  return {
    artifactSetDigest: digestField(evidence, 'artifactSetDigest'),
    applicationGraphDigest: digestField(graph, 'digest'),
  };
}

export function createV06AssertionEvidence(
  assertions: readonly { readonly assertion: string; readonly test: string; readonly observedAt?: string }[],
  runId: string,
): readonly V06AssertionEvidence[] {
  const names = new Set<string>();
  return assertions.map((entry) => {
    if (!entry.assertion || names.has(entry.assertion)) throw new Error(`Duplicate or empty v0.6 assertion: ${entry.assertion}`);
    names.add(entry.assertion);
    return {
      assertion: entry.assertion,
      test: entry.test,
      runId,
      observedAt: entry.observedAt ?? new Date().toISOString(),
    };
  });
}

export async function writeV06EvidenceReceipt<T extends object>(
  path: string,
  input: {
    readonly suite: string;
    readonly run: V06EvidenceReceipt['run'];
    readonly candidate: V06CandidateIdentity;
    readonly environment: Readonly<Record<string, unknown>>;
    readonly assertionEvidence: readonly V06AssertionEvidence[];
  } & T,
): Promise<void> {
  const completedAt = input.run.completedAt;
  if (input.assertionEvidence.length === 0) throw new Error(`Refusing to write empty ${input.suite} evidence.`);
  if (input.assertionEvidence.some((entry) => entry.runId !== input.run.id)) {
    throw new Error(`Refusing to mix assertion runs in ${input.suite} evidence.`);
  }
  const receipt: V06EvidenceReceipt & T = {
    ...input,
    schemaVersion: 3,
    completedAt,
    assertions: input.assertionEvidence.map((entry) => entry.assertion),
    assertionEvidence: input.assertionEvidence,
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

export async function discardV06Evidence(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT') throw error;
  });
}

function jsonObject(raw: string, label: string): Record<string, unknown> {
  // typecast: JSON is narrowed to a non-array object before candidate metadata fields are inspected.
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not a JSON object.`);
  // typecast: the non-null object and non-array checks establish the record boundary returned here.
  return value as Record<string, unknown>;
}

function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const nested = value[field];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw new Error(`Expected object field ${field}.`);
  // typecast: the runtime object/array guard above establishes the record-shaped evidence field.
  return nested as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const nested = value[field];
  if (typeof nested !== 'string' || nested.length === 0) throw new Error(`Expected non-empty string field ${field}.`);
  return nested;
}

function digestField(value: Record<string, unknown>, field: string): string {
  const digest = stringField(value, field);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Expected ${field} to be a sha256 digest.`);
  return digest;
}
