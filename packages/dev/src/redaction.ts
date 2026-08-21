// typecast: Literal regex preservation is intentional so the redaction table remains immutable.
const credentialPatterns = [
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}\b/gu,
  /\bAKIA[A-Z0-9]{16}\b/gu,
] as const;

/**
 * Removes known and credential-shaped values before development evidence is
 * persisted, rendered in the portal, or sent to a coding provider.
 */
export function redactDevelopmentText(
  value: string,
  knownSecretValues: readonly string[] = [],
): string {
  let redacted = value;
  for (const secret of knownSecretValues) {
    if (secret.length >= 4) redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  for (const pattern of credentialPatterns) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[REDACTED_CREDENTIAL]');
  }
  return redacted
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s]+/giu, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu, '$1[REDACTED]');
}

export function redactDevelopmentValue(
  value: unknown,
  knownSecretValues: readonly string[] = [],
  key = '',
): unknown {
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactDevelopmentText(value, knownSecretValues);
  if (Array.isArray(value)) return value.map((entry) => redactDevelopmentValue(entry, knownSecretValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        redactDevelopmentValue(entry, knownSecretValues, name),
      ]),
    );
  }
  return value;
}

export function assertDevelopmentValueHasNoSecrets(
  value: unknown,
  knownSecretValues: readonly string[] = [],
  subject = 'Development value',
): void {
  const serialized = JSON.stringify(value);
  for (const secret of knownSecretValues) {
    if (secret.length >= 4 && serialized.includes(secret)) {
      throw new Error(`${subject} contains a known secret value and cannot enter development state.`);
    }
  }
  for (const pattern of credentialPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) {
      throw new Error(`${subject} contains credential-shaped material and cannot enter development state.`);
    }
  }
}

function isSensitiveKey(key: string): boolean {
  return /(?:authorization|cookie|token|secret|password|prompt|payload|api[_-]?key)/iu.test(key);
}
