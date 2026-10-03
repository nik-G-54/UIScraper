import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './format';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [250 * 1024, '250.0 KB'],
    [5 * 1024 * 1024, '5.00 MB'],
  ])('%i -> %s', (input, expected) => expect(formatBytes(input)).toBe(expected));

  it('handles bad input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 ms'],
    [850, '850 ms'],
    [1000, '1.0 s'],
    [2450, '2.5 s'],
  ])('%i -> %s', (input, expected) => expect(formatDuration(input)).toBe(expected));

  it('handles bad input', () => expect(formatDuration(-5)).toBe('—'));
});
