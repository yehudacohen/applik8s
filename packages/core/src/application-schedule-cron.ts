/**
 * Converts a fixed interval into one five-field cron expression only when the
 * wall-clock cadence is exact. Providers must not silently turn a fixed
 * interval into a calendar approximation at an hour or day boundary.
 */
export function exactFiveFieldCronForInterval(interval: string): string {
  const match = /^(\d+)(m|h|d)$/u.exec(interval.trim());
  if (!match) {
    throw new ApplicationScheduleCronCompatibilityError(
      interval,
      'only positive minute, hour, or day intervals can use a five-field cron provider',
    );
  }
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new ApplicationScheduleCronCompatibilityError(interval, 'the interval must be positive');
  }
  const unit = match[2];
  const minutes = unit === 'm' ? amount : unit === 'h' ? amount * 60 : amount * 1_440;
  if (!Number.isSafeInteger(minutes)) {
    throw new ApplicationScheduleCronCompatibilityError(interval, 'the interval exceeds the supported range');
  }
  if (minutes < 60 && 60 % minutes === 0) {
    return minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`;
  }
  if (minutes < 1_440 && minutes % 60 === 0) {
    const hours = minutes / 60;
    if (24 % hours === 0) return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
  }
  if (minutes === 1_440) return '0 0 * * *';
  throw new ApplicationScheduleCronCompatibilityError(
    interval,
    'one five-field cron expression cannot preserve this fixed interval across hour or day boundaries',
  );
}

export class ApplicationScheduleCronCompatibilityError extends Error {
  readonly code = 'SCHEDULE_CADENCE_UNREPRESENTABLE';

  constructor(readonly interval: string, reason: string) {
    super(`Schedule interval ${JSON.stringify(interval)} is not exactly representable: ${reason}. Use an explicit calendar cron or select a provider with fixed-interval support.`);
    this.name = 'ApplicationScheduleCronCompatibilityError';
  }
}
