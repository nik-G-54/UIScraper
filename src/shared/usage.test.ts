import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageMock } from './test-utils/mockChromeStorage';
import type { ChromeStorageMock } from './test-utils/mockChromeStorage';
import {
  getAiUsageToday,
  isWithinDailyLimit,
  localDateKey,
  msUntilNextLocalMidnight,
  parseDailyLimit,
  recordAiRequest,
} from './usage';

let mock: ChromeStorageMock;

// Local-time constructors keep these tests independent of the machine's time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);

beforeEach(() => {
  vi.useFakeTimers();
  mock = installChromeStorageMock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('localDateKey', () => {
  it('formats the local date with zero padding', () => {
    expect(localDateKey(at(2026, 3, 5, 14, 30))).toBe('2026-03-05');
    expect(localDateKey(at(2026, 12, 31, 23, 59, 59))).toBe('2026-12-31');
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('counts down to the next local midnight', () => {
    expect(msUntilNextLocalMidnight(at(2026, 3, 5, 23, 59, 0))).toBe(60_000);
    expect(msUntilNextLocalMidnight(at(2026, 3, 5, 0, 0, 0))).toBe(24 * 60 * 60 * 1000);
  });

  it('rolls over month and year boundaries', () => {
    expect(msUntilNextLocalMidnight(at(2026, 12, 31, 23, 0, 0))).toBe(60 * 60 * 1000);
  });
});

describe('daily AI usage counter', () => {
  it('starts at zero', async () => {
    vi.setSystemTime(at(2026, 3, 5, 9));
    expect(await getAiUsageToday()).toBe(0);
  });

  it('increments and persists the count with the local date of today', async () => {
    vi.setSystemTime(at(2026, 3, 5, 9));
    expect(await recordAiRequest()).toBe(1);
    expect(await recordAiRequest()).toBe(2);
    expect(await getAiUsageToday()).toBe(2);
    expect(mock.data.aiUsage).toEqual({ date: '2026-03-05', count: 2 });
  });

  it('keeps the count until local midnight, then resets', async () => {
    vi.setSystemTime(at(2026, 3, 5, 23, 59, 58));
    await recordAiRequest();
    await recordAiRequest();
    expect(await getAiUsageToday()).toBe(2);

    vi.setSystemTime(at(2026, 3, 5, 23, 59, 59));
    expect(await getAiUsageToday()).toBe(2);

    vi.setSystemTime(at(2026, 3, 6, 0, 0, 0));
    expect(await getAiUsageToday()).toBe(0);
  });

  it('starts a fresh count on the first request of a new day', async () => {
    vi.setSystemTime(at(2026, 3, 5, 22));
    await recordAiRequest();
    await recordAiRequest();
    await recordAiRequest();

    vi.setSystemTime(at(2026, 3, 6, 8));
    expect(await recordAiRequest()).toBe(1);
    expect(mock.data.aiUsage).toEqual({ date: '2026-03-06', count: 1 });
  });

  it('resets after more than a day away (e.g. machine asleep)', async () => {
    vi.setSystemTime(at(2026, 3, 5, 12));
    await recordAiRequest();
    vi.setSystemTime(at(2026, 3, 9, 12));
    expect(await getAiUsageToday()).toBe(0);
  });

  it('does not lose counts when requests are recorded concurrently', async () => {
    vi.setSystemTime(at(2026, 3, 5, 12));
    const totals = await Promise.all([1, 2, 3, 4, 5].map(() => recordAiRequest()));
    expect([...totals].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await getAiUsageToday()).toBe(5);
  });

  it('treats a corrupted stored record as zero', async () => {
    vi.setSystemTime(at(2026, 3, 5, 12));
    mock.data.aiUsage = { date: '2026-03-05', count: 'many' };
    expect(await getAiUsageToday()).toBe(0);
    expect(await recordAiRequest()).toBe(1);
  });

  it('keeps working after a failed write', async () => {
    vi.setSystemTime(at(2026, 3, 5, 12));
    mock.local.set.mockRejectedValueOnce(new Error('boom'));
    await expect(recordAiRequest()).rejects.toThrow();
    expect(await recordAiRequest()).toBe(1);
  });
});

describe('isWithinDailyLimit', () => {
  it('allows requests below the limit only', () => {
    expect(isWithinDailyLimit(19, 20)).toBe(true);
    expect(isWithinDailyLimit(20, 20)).toBe(false);
    expect(isWithinDailyLimit(0, 0)).toBe(false);
  });
});

describe('parseDailyLimit', () => {
  it('accepts whole numbers >= 0', () => {
    expect(parseDailyLimit('20')).toBe(20);
    expect(parseDailyLimit(' 0 ')).toBe(0);
  });

  it.each(['', ' ', '-1', '1.5', 'abc', '1e3', '99999999999999999999'])('rejects %j', (input) => {
    expect(parseDailyLimit(input)).toBeNull();
  });
});
