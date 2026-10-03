import type { AiMode } from '../../shared/types';
import { fitInput, estimateTokens } from './inputs';
import type { AiInputs } from './inputs';
import { decideAi } from './precheck';
import { SYSTEM_PROMPT } from './prompt';
import { AiError } from './provider';
import type { AiPart, AiProvider, GenerateResponse } from './provider';
import { extractSection, validateAiOutput } from './validate';

export interface RunAiOptions {
  provider: AiProvider;
  mode: AiMode;
  apiKey: string;
  model: string;
  fallbackModel: string;
  dailyLimit: number;
  /** Requests counted today. */
  getUsed(): Promise<number>;
  /** Count one request that is about to be sent; returns the new total. */
  recordRequest(): Promise<number>;
  inputs: AiInputs;
  mask: boolean;
  inputTokenBudget: number;
  maxOutputTokens: number;
  /** Retries after the first attempt on the main model (429/5xx...). */
  maxRetries: number;
  backoffMs: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface AiOutcome {
  enhanced: boolean;
  /** The validated answer, or null when the rule-based output stands. */
  text: string | null;
  /** `## Agent notes` (else `## Gaps`) of the answer, for AGENT_PROMPT.md. */
  siteNotes: string | null;
  /** The model that wrote the answer; null when rule-based. */
  model: string | null;
  /** Why the rule-based output stands; null when enhanced. */
  reason: string | null;
  /** generateContent requests actually sent (each retry counts). */
  requests: number;
  tokens: { input: number; output: number } | null;
  usedToday: number | null;
  dropped: string[];
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Run the optional AI layer. It never throws: every failure ends in a rule-based outcome with a
 * reason. Chain: pre-check -> fit the input into the token budget -> main model (retry 429/5xx with
 * backoff) -> fallback model once -> validate (a bad answer gets one retry on the fallback model).
 */
export async function runAi(o: RunAiOptions): Promise<AiOutcome> {
  const sleep = o.sleep ?? realSleep;
  let requests = 0;
  const tokens = { input: 0, output: 0 };
  let dropped: string[] = [];
  let usedToday: number | null = null;

  const fail = (reason: string): AiOutcome => ({
    enhanced: false,
    text: null,
    siteNotes: null,
    model: null,
    reason,
    requests,
    tokens: requests > 0 ? { ...tokens } : null,
    usedToday,
    dropped,
  });

  try {
    usedToday = await o.getUsed();
    const decision = decideAi({ mode: o.mode, apiKey: o.apiKey, used: usedToday, limit: o.dailyLimit });
    if (!decision.run) return fail(decision.reason);

    const countWith = (model: string) => async (parts: AiPart[]) => {
      try {
        return await o.provider.countTokens({ model, system: SYSTEM_PROMPT, parts });
      } catch (error) {
        if (error instanceof AiError && error.kind === 'auth') throw error;
        return estimateTokens(parts, SYSTEM_PROMPT);
      }
    };
    const fit = await fitInput(o.inputs, o.mask, countWith(o.model), o.inputTokenBudget);
    dropped = fit.dropped;
    if (!fit.parts) return fail(fit.reason);
    const parts = fit.parts;

    type Sent = { ok: true; response: GenerateResponse } | { ok: false; error: unknown };
    const send = async (model: string): Promise<Sent> => {
      if ((usedToday ?? 0) >= o.dailyLimit) return { ok: false, error: new Error(`the daily AI limit is reached (${usedToday}/${o.dailyLimit})`) };
      usedToday = await o.recordRequest();
      requests++;
      try {
        const response = await o.provider.generate({ model, system: SYSTEM_PROMPT, parts, maxOutputTokens: o.maxOutputTokens });
        tokens.input += response.usage.inputTokens;
        tokens.output += response.usage.outputTokens;
        return { ok: true, response };
      } catch (error) {
        return { ok: false, error };
      }
    };
    const withRetries = async (model: string): Promise<Sent> => {
      let result = await send(model);
      for (let attempt = 0; attempt < o.maxRetries && !result.ok; attempt++) {
        const error = result.error;
        if (!(error instanceof AiError) || !error.retryable) break;
        await sleep(o.backoffMs[attempt] ?? o.backoffMs[o.backoffMs.length - 1] ?? 1000);
        result = await send(model);
      }
      return result;
    };
    const succeed = (model: string, text: string): AiOutcome => ({
      enhanced: true,
      text,
      siteNotes: extractSection(text, 'Agent notes') ?? extractSection(text, 'Gaps'),
      model,
      reason: null,
      requests,
      tokens: { ...tokens },
      usedToday,
      dropped,
    });

    const failures: string[] = [];
    const main = await withRetries(o.model);
    if (main.ok) {
      const valid = validateAiOutput(main.response.text, main.response.finishReason);
      if (valid.ok) return succeed(o.model, valid.text);
      failures.push(`${o.model}: ${valid.reason}`);
    } else {
      const error = main.error;
      if (error instanceof AiError && error.kind === 'auth') return fail(error.message);
      failures.push(`${o.model}: ${describe(error)}`);
      // Only transient problems justify switching model; a refused request would be refused again.
      if (!(error instanceof AiError && error.retryable)) return fail(failures.join('; '));
    }

    const fallback = o.fallbackModel.trim();
    if (fallback === '') return fail(failures.join('; '));
    const second = await send(fallback);
    if (second.ok) {
      const valid = validateAiOutput(second.response.text, second.response.finishReason);
      if (valid.ok) return succeed(fallback, valid.text);
      failures.push(`${fallback}: ${valid.reason}`);
    } else {
      failures.push(`${fallback}: ${describe(second.error)}`);
    }
    return fail(failures.join('; '));
  } catch (error) {
    return fail(describe(error));
  }
}
