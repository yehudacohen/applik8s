export function applicationModelChangeCommitScope(contextDigest: string): string {
  if (!/^[a-f0-9]{64}$/i.test(contextDigest) && contextDigest !== 'unscoped') {
    throw new Error('Application model change commit scope requires an admitted context digest.');
  }
  return `applik8s:model-changes:v1:${contextDigest.toLowerCase()}`;
}
