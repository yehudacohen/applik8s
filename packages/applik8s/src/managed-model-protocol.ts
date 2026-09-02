/** Runtime-safe managed-model protocol identity and duration normalization. */
export const applicationManagedModelProtocol = 'applik8s.managed-model/v1alpha1';

export function managedModelDurationSeconds(value: string, label: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new TypeError(`${label} must be a whole-number duration such as 30s, 5m, or 1h.`);
  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  const milliseconds = amount * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 0);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000) {
    throw new TypeError(`${label} must be at least 1s and remain within a safe integer range.`);
  }
  return milliseconds / 1_000;
}
