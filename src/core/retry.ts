export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Decide whether an error is worth retrying (default: transient-looking). */
  isRetryable?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Default: retry on network errors and 429/5xx-style failures, not 4xx. */
export function defaultRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: string };
  if (e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT") return true;
  const s = e?.status;
  if (typeof s === "number") return s === 429 || s >= 500;
  return true; // unknown shape → give it a chance
}

/**
 * Retry an async op with exponential backoff + jitter. Skips non-retryable
 * (e.g. 4xx) errors so a bad request fails fast instead of hammering the API.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 300;
  const isRetryable = opts.isRetryable ?? defaultRetryable;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      const delay = base * 2 ** attempt + Math.floor(Math.random() * base);
      await sleep(delay);
    }
  }
  throw lastErr;
}
