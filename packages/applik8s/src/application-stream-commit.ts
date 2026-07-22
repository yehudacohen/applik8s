/**
 * PostgreSQL identity sequences allocate before commit. Public stream readers
 * therefore synchronize on this per-contract frontier so a lower sequence can
 * never commit after a reader has advanced past a higher one.
 */
export function applicationPublicStreamCommitScope(name: string, version: string): string {
  return `applik8s:public-stream-commit:v1:${name}:${version}`;
}
