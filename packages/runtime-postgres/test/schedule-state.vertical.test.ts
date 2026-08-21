import { describe, expect, it } from 'vitest';
import { applicationScheduleStateLockKeysForTest } from '../src/schedule-state.js';

describe('PostgreSQL application schedule state authority', () => {
	it('encodes advisory lock identities without PostgreSQL-invalid NUL bytes', () => {
		const keys = applicationScheduleStateLockKeysForTest(
			{ applicationId: 'demo', environmentId: 'production' },
			'workspace-digest.v1',
			'workspace-a',
		);

		expect(keys).toEqual([
			'["demo","production"]',
			'["workspace-digest.v1","workspace-a"]',
		]);
		expect(keys.every((key) => !key.includes('\0'))).toBe(true);
	});

	it('keeps identities injective across delimiter-like inputs', () => {
		const left = applicationScheduleStateLockKeysForTest(
			{ applicationId: 'a', environmentId: 'b:c' },
			'd:e',
			'f',
		);
		const right = applicationScheduleStateLockKeysForTest(
			{ applicationId: 'a:b', environmentId: 'c' },
			'd',
			'e:f',
		);

		expect(left).not.toEqual(right);
	});
});
