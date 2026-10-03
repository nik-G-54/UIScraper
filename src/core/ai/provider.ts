/** Provider-neutral AI types. The rule-based design.md never depends on any of this (CLAUDE.md rule 8). */

export type AiPart = { kind: 'text'; text: string } | { kind: 'image'; mimeType: 'image/jpeg'; base64: string };

export interface GenerateRequest {
  model: string;
  system: string;
  parts: AiPart[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerateResponse {
  text: string;
  /** Provider's finish reason, upper-case (`STOP`, `MAX_TOKENS`, `SAFETY`...). */
  finishReason: string;
  usage: AiUsage;
}

export type KeyTestResult = { ok: true } | { ok: false; kind: 'invalid-key' | 'network' | 'other'; message: string };

export interface AiProvider {
  readonly id: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  /** Tokens the request would use (without generating). */
  countTokens(request: GenerateRequest): Promise<number>;
  /** A lightweight call that tells whether the key works. */
  testKey(): Promise<KeyTestResult>;
}

export type AiErrorKind = 'auth' | 'rate-limit' | 'server' | 'network' | 'timeout' | 'bad-request' | 'blocked' | 'empty';

/** A provider failure with enough structure to decide between retrying, switching model and giving up. */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }

  /** Worth retrying (and then falling back to the other model): transient problems. */
  get retryable(): boolean {
    return this.kind === 'rate-limit' || this.kind === 'server' || this.kind === 'network' || this.kind === 'timeout';
  }
}
