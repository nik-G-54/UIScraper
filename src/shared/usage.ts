import { storage } from './storage';

/**
 * Daily AI request counter. The count belongs to a local calendar day; once the local
 * date changes the stored count is treated as zero and replaced on the next write.
 * Only the counter exists in this phase; nothing calls an AI provider yet.
 */

/** Local date as YYYY-MM-DD. */
export function localDateKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Milliseconds from `now` until the next local midnight (always > 0). */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

export async function getAiUsageToday(now: Date = new Date()): Promise<number> {
  const record = await storage.get('aiUsage');
  return record.date === localDateKey(now) ? record.count : 0;
}

// Read-modify-write is not atomic in chrome.storage, so serialize increments.
let writeQueue: Promise<unknown> = Promise.resolve();

/** Count one AI request against today's total and return the new total. */
export function recordAiRequest(now: Date = new Date()): Promise<number> {
  const run = async () => {
    const today = localDateKey(now);
    const record = await storage.get('aiUsage');
    const count = (record.date === today ? record.count : 0) + 1;
    await storage.set('aiUsage', { date: today, count });
    return count;
  };
  const result = writeQueue.then(run, run);
  writeQueue = result.catch(() => undefined);
  return result;
}

export function isWithinDailyLimit(used: number, limit: number): boolean {
  return used < limit;
}

/** Parse the limit text field. Returns null unless it is a whole number >= 0. */
export function parseDailyLimit(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}
