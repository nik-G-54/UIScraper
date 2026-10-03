import { REQUIRED_HEADINGS } from './prompt';

export type Validation = { ok: true; text: string } | { ok: false; reason: string };

/** Removes a wrapping ```markdown fence, which some models add despite instructions. */
export function stripFence(text: string): string {
  const trimmed = text.trim();
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (m ? (m[1] as string) : trimmed).trim();
}

const headingRe = (name: string) => new RegExp(`^##\\s+${name.replace(/\s+/g, '\\s+')}\\s*$`, 'im');

/** Text of the `## name` section (without the heading), or null. */
export function extractSection(markdown: string, name: string): string | null {
  const start = headingRe(name).exec(markdown);
  if (!start) return null;
  const rest = markdown.slice(start.index + start[0].length);
  const next = /^##\s+\S/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * The answer is usable when it finished normally (not cut by the token limit or blocked), is not
 * empty, and contains every required heading with some content.
 */
export function validateAiOutput(text: string, finishReason: string): Validation {
  if (finishReason === 'MAX_TOKENS') return { ok: false, reason: 'the answer was cut off by the output token limit' };
  if (finishReason === 'SAFETY' || finishReason === 'BLOCKLIST' || finishReason === 'PROHIBITED_CONTENT') return { ok: false, reason: `the answer was blocked (${finishReason})` };
  const clean = stripFence(text);
  if (clean === '') return { ok: false, reason: 'the answer was empty' };
  const missing = REQUIRED_HEADINGS.filter((h) => !(extractSection(clean, h)?.length));
  if (missing.length > 0) return { ok: false, reason: `the answer is missing the heading(s): ${missing.map((h) => `"## ${h}"`).join(', ')}` };
  return { ok: true, text: clean };
}
