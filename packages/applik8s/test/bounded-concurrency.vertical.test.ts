import { describe, expect, it } from 'vitest';
import { consumeWithBoundedConcurrency } from '../src/bounded-concurrency.js';

describe('bounded concurrency runtime', () => {
  it('applies backpressure before pulling the next item', async () => {
    let pulled = 0;
    let completed = 0;
    let active = 0;
    let maximum = 0;
    async function* source() {
      for (let index = 0; index < 20; index += 1) {
        pulled += 1;
        // Async iteration may have the yielded item in hand before its task is
        // registered, but it must not prefetch beyond that single item.
        expect(pulled - completed).toBeLessThanOrEqual(4);
        yield index;
      }
    }
    await consumeWithBoundedConcurrency(source(), 3, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      completed += 1;
    });
    expect(maximum).toBe(3);
  });

  it('waits for sibling work before propagating the first task failure', async () => {
    const completed: number[] = [];
    async function* source() {
      yield 1;
      yield 2;
      yield 3;
    }
    await expect(consumeWithBoundedConcurrency(source(), 3, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 1 : 10));
      if (value === 1) throw new Error('task failed');
      completed.push(value);
    })).rejects.toThrow('task failed');
    expect(completed.sort()).toEqual([2, 3]);
  });
});
