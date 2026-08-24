import { describe, expect, it } from 'vitest';
import {
  ApplicationScheduleCronCompatibilityError,
  exactFiveFieldCronForInterval,
} from '../src/application-schedule-cron.js';

describe('exact five-field schedule cadence', () => {
  it.each([
    ['1m', '* * * * *'],
    ['15m', '*/15 * * * *'],
    ['60m', '0 * * * *'],
    ['2h', '0 */2 * * *'],
    ['24h', '0 0 * * *'],
    ['1d', '0 0 * * *'],
  ])('preserves %s exactly', (interval, expected) => {
    expect(exactFiveFieldCronForInterval(interval)).toBe(expected);
  });

  it.each(['30s', '0m', '7m', '90m', '7h', '2d', 'forever'])(
    'fails closed for %s rather than changing its semantics',
    (interval) => {
      expect(() => exactFiveFieldCronForInterval(interval)).toThrow(ApplicationScheduleCronCompatibilityError);
      expect(() => exactFiveFieldCronForInterval(interval)).toThrow('not exactly representable');
    },
  );
});
