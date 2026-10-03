import type { AiMode } from '../../shared/types';

export type AiDecision = { run: true } | { run: false; reason: string };

/**
 * Whether the AI layer may run at all. Skipped when the mode is Off, the key is missing, or today's
 * counter has reached the limit. The reason is shown in the UI.
 */
export function decideAi(input: { mode: AiMode; apiKey: string; used: number; limit: number }): AiDecision {
  if (input.mode === 'off') return { run: false, reason: 'AI mode is Off' };
  if (input.apiKey.trim() === '') return { run: false, reason: 'no API key is set' };
  if (input.used >= input.limit) return { run: false, reason: `the daily AI limit is reached (${input.used}/${input.limit})` };
  return { run: true };
}
