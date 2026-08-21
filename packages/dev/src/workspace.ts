import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { DevelopmentChangePlan, PlannedFileChange } from './contracts.js';

export interface DevelopmentAppliedChange {
  readonly id: string;
  readonly planId: string;
  readonly files: readonly { readonly path: string; readonly before: string | null; readonly beforeDigest: `sha256:${string}` | 'absent'; readonly afterDigest: `sha256:${string}` | 'absent' }[];
}

export async function applyDevelopmentChange(workspaceRoot: string, plan: DevelopmentChangePlan): Promise<DevelopmentAppliedChange> {
  const root = await realpath(workspaceRoot);
  const prepared = await Promise.all(plan.files.map((change) => prepareChange(root, change)));
  const applied: typeof prepared = [];
  try {
    for (const change of prepared) {
      if (change.change.classification === 'delete') await rm(change.absolute, { force: true });
      else {
        await mkdir(dirname(change.absolute), { recursive: true });
        const temporary = `${change.absolute}.applik8s-${randomUUID()}.tmp`;
        await writeFile(temporary, change.change.nextText, { encoding: 'utf8', mode: change.mode });
        await rename(temporary, change.absolute);
      }
      applied.push(change);
    }
  } catch (cause) {
    for (const change of [...applied].reverse()) await restore(change.absolute, change.before, change.mode);
    throw cause;
  }
  return { id: randomUUID(), planId: plan.id, files: prepared.map(({ change, before }) => ({ path: change.path, before, beforeDigest: before === null ? 'absent' : digest(before), afterDigest: change.classification === 'delete' ? 'absent' : digest(change.nextText) })) };
}

export async function undoDevelopmentChange(workspaceRoot: string, applied: DevelopmentAppliedChange): Promise<void> {
  const root = await realpath(workspaceRoot);
  const targets = await Promise.all(applied.files.map(async (file) => {
    const absolute = await boundedPath(root, file.path, false);
    const current = await readFile(absolute, 'utf8').catch((cause: NodeJS.ErrnoException) => cause.code === 'ENOENT' ? null : Promise.reject(cause));
    const currentDigest = current === null ? 'absent' : digest(current);
    if (currentDigest !== file.afterDigest) throw new Error(`Cannot undo ${file.path}: it changed after the reviewed apply.`);
    return { absolute, before: file.before };
  }));
  for (const target of targets) await restore(target.absolute, target.before, 0o644);
}

async function prepareChange(root: string, change: PlannedFileChange) {
  const absolute = await boundedPath(root, change.path, change.classification === 'create');
  const stat = await lstat(absolute).catch((cause: NodeJS.ErrnoException) => cause.code === 'ENOENT' ? undefined : Promise.reject(cause));
  if (stat?.isSymbolicLink()) throw new Error(`Development change ${change.path} targets a symbolic link.`);
  if (stat && !stat.isFile()) throw new Error(`Development change ${change.path} is not a regular file.`);
  const before = stat ? await readFile(absolute, 'utf8') : null;
  const actualDigest = before === null ? 'absent' : digest(before);
  if (actualDigest !== change.baseDigest) throw new Error(`Development change ${change.path} was reviewed at ${change.baseDigest} but is now ${actualDigest}.`);
  if (change.classification === 'create' && before !== null) throw new Error(`Development create ${change.path} already exists.`);
  if (change.classification !== 'create' && before === null) throw new Error(`Development ${change.classification} ${change.path} is absent.`);
  return { change, absolute, before, mode: stat?.mode ?? 0o644 };
}

async function boundedPath(root: string, path: string, allowAbsent: boolean): Promise<string> {
  if (!path || path.includes('\0')) throw new Error('Development workspace path is invalid.');
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || rel === '' && path !== '.') throw new Error(`Development workspace path ${path} escapes the project root.`);
  const parent = await realpath(dirname(absolute)).catch((cause: NodeJS.ErrnoException) => allowAbsent && cause.code === 'ENOENT' ? root : Promise.reject(cause));
  const parentRel = relative(root, parent);
  if (parentRel.startsWith('..')) throw new Error(`Development workspace path ${path} traverses a symbolic link outside the project root.`);
  return absolute;
}

async function restore(path: string, content: string | null, mode: number): Promise<void> {
  if (content === null) await rm(path, { force: true });
  else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { encoding: 'utf8', mode }); }
}
export function developmentContentDigest(value: string): `sha256:${string}` { return digest(value); }
function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
