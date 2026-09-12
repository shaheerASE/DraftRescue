import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  const now = new Date('2026-03-15T12:00:00Z').getTime();
  const ago = (ms: number) => relativeTime(now - ms, now);

  it.each([
    [0, 'just now'],
    [10 * SECOND, 'just now'],
    [44 * SECOND, 'just now'],
    [45 * SECOND, '1m ago'],
    [90 * SECOND, '1m ago'],
    [5 * MINUTE, '5m ago'],
    [59 * MINUTE, '59m ago'],
    [HOUR, '1h ago'],
    [5 * HOUR, '5h ago'],
    [23 * HOUR, '23h ago'],
    [DAY, '1d ago'],
    [6 * DAY, '6d ago'],
    [7 * DAY, '1w ago'],
    [30 * DAY, '4w ago'],
  ])('%dms ago reads as %s', (elapsed, expected) => {
    expect(ago(elapsed)).toBe(expected);
  });

  it('floors rather than rounds, so 90 seconds is not "2m ago"', () => {
    // Overstating a draft's age makes it look less worth recovering.
    expect(ago(90 * SECOND)).toBe('1m ago');
    expect(ago(119 * SECOND)).toBe('1m ago');
    expect(ago(120 * SECOND)).toBe('2m ago');
  });

  it('never says "1m ago" for something under the just-now threshold', () => {
    expect(ago(44 * SECOND)).toBe('just now');
  });

  it('handles a timestamp in the future rather than counting forwards', () => {
    // A clock adjustment between saving and reading should not produce
    // "in 3 hours" on a pill.
    expect(relativeTime(now + HOUR, now)).toBe('just now');
  });
});
