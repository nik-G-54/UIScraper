import { AiError } from './provider';
import type { AiPart, AiProvider, GenerateRequest, GenerateResponse, KeyTestResult } from './provider';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiOptions {
  apiKey: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

const toParts = (parts: readonly AiPart[]): GeminiPart[] =>
  parts.map((p) => (p.kind === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.base64 } }));

function contentBody(request: GenerateRequest) {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: toParts(request.parts) }],
  };
}

/** Message from a Google error body, never including the request (so never the key). */
function errorMessage(body: unknown, fallback: string): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message ? message.slice(0, 300) : fallback;
}

function classify(status: number, body: unknown): AiError {
  const message = errorMessage(body, `HTTP ${status}`);
  if (status === 401 || status === 403 || (status === 400 && /api key|API_KEY/i.test(message))) return new AiError('auth', `The API key was rejected (${message})`, status);
  if (status === 429) return new AiError('rate-limit', `Rate limit or quota reached (${message})`, status);
  if (status >= 500) return new AiError('server', `The AI service had a problem (${message})`, status);
  return new AiError('bad-request', `The AI service refused the request (${message})`, status);
}

/** Gemini over REST (`generateContent`, `countTokens`, `models`) with the `x-goog-api-key` header. No SDK. */
export function createGeminiProvider(options: GeminiOptions): AiProvider {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl ?? BASE_URL;
  const timeoutMs = options.timeoutMs ?? 90_000;

  async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method,
        headers: { 'x-goog-api-key': options.apiKey, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new AiError('timeout', `The AI service did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
      throw new AiError('network', `Could not reach the AI service (${error instanceof Error ? error.message : 'network error'})`);
    } finally {
      clearTimeout(timer);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw classify(response.status, body);
    return body;
  }

  return {
    id: 'gemini',

    async generate(request) {
      const body = (await call(`/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: 'POST',
        body: {
          ...contentBody(request),
          generationConfig: { maxOutputTokens: request.maxOutputTokens ?? 8192, temperature: request.temperature ?? 0.4 },
        },
      })) as {
        candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };
      const candidate = body.candidates?.[0];
      const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      const blocked = body.promptFeedback?.blockReason;
      if (!candidate && blocked) throw new AiError('blocked', `The prompt was blocked (${blocked})`);
      if (!candidate) throw new AiError('empty', 'The AI service returned no answer');
      const usage = body.usageMetadata ?? {};
      const input = usage.promptTokenCount ?? 0;
      const output = usage.candidatesTokenCount ?? 0;
      const response: GenerateResponse = {
        text,
        finishReason: (candidate.finishReason ?? 'STOP').toUpperCase(),
        usage: { inputTokens: input, outputTokens: output, totalTokens: usage.totalTokenCount ?? input + output },
      };
      return response;
    },

    async countTokens(request) {
      const body = (await call(`/models/${encodeURIComponent(request.model)}:countTokens`, {
        method: 'POST',
        body: { generateContentRequest: { model: `models/${request.model}`, ...contentBody(request) } },
      })) as { totalTokens?: number };
      if (typeof body.totalTokens !== 'number') throw new AiError('bad-request', 'The AI service did not report a token count');
      return body.totalTokens;
    },

    async testKey(): Promise<KeyTestResult> {
      try {
        await call('/models?pageSize=1', { method: 'GET' });
        return { ok: true };
      } catch (error) {
        if (error instanceof AiError) {
          if (error.kind === 'auth') return { ok: false, kind: 'invalid-key', message: 'The API key is invalid.' };
          if (error.kind === 'network' || error.kind === 'timeout') return { ok: false, kind: 'network', message: error.message };
          return { ok: false, kind: 'other', message: error.message };
        }
        return { ok: false, kind: 'other', message: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  };
}
