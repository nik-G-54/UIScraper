export type ErrorCode =
  | 'RESTRICTED_PAGE'
  | 'NO_ACTIVE_TAB'
  | 'INJECTION_FAILED'
  | 'INVALID_RESULT'
  | 'TIMEOUT'
  | 'STORAGE_FAILED'
  | 'UNKNOWN';

/** An error whose message is safe and readable enough to show directly in the UI. */
export class DesignLensError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DesignLensError';
    this.code = code;
  }
}

/** Best-effort readable message for any thrown value. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'An unknown error occurred.';
}

/** Wrap an arbitrary thrown value so callers can rely on `code` and `message`. */
export function toDesignLensError(error: unknown, fallbackCode: ErrorCode = 'UNKNOWN'): DesignLensError {
  if (error instanceof DesignLensError) return error;
  return new DesignLensError(fallbackCode, toErrorMessage(error), { cause: error });
}
