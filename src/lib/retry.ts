/**
 * Retry with exponential backoff + jitter. Used for downstream calls (mirror
 * webhook, Discord followup, AI) so a brief blip doesn't drop an interaction.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseMs?: number;
    maxMs?: number;
    onAttemptError?: (err: unknown, attempt: number) => void;
  } = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 300;
  const maxMs = opts.maxMs ?? 4000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttemptError?.(err, attempt);
      if (attempt === retries) break;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * (backoff / 2));
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * fetch that throws on non-2xx so `withRetry` treats HTTP errors as retryable.
 * Includes a timeout so a hung downstream can't wedge the request.
 */
export async function fetchOk(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${body.slice(0, 200)}`);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}
