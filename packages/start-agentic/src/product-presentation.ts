/** Maintained product language for generated agent activity and bounded failures. */
export function agenticToolLabel(value: string): string {
  return value
    .replace(/^applik8s_/u, '')
    .replace(/_[a-z0-9]{7}$/u, '')
    .replace(/^.*[/:]/u, '')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/[-_]+/gu, ' ')
    .replace(/^./u, character => character.toUpperCase());
}

export function agenticToolStateLabel(value: string): string {
  return value.replace(/[-_]+/gu, ' ');
}

export function agenticAssistantFailureMessage(error: Error): string {
  const message = error.message.toLowerCase();
  if (/credential|unauthorized|forbidden|\b401\b|\b403\b/.test(message)) {
    return 'The selected inference provider rejected its server-side credential.';
  }
  if (/timeout/.test(message)) {
    return 'The run exceeded its bounded wait. You can restore the prompt and retry.';
  }
  if (/abort|cancel/.test(message)) {
    return 'The run was cancelled before the framework observed a terminal provider result.';
  }
  if (/\b5\d\d\b|unavailable|backend|provider|inference|network|fetch/.test(message)) {
    return 'The inference runtime or selected provider is temporarily unavailable.';
  }
  return 'The inference runtime did not return a usable terminal result. Check provider status in Launchpad or retry.';
}
