import { describe, it, expect } from "vitest";
import { withRetry, defaultRetryable } from "../src/core/retry";

/**
 * The README claims "transient API errors retried; 4xx fail fast". That's a
 * cost/latency promise (a bad request must not be hammered 5×), so it needs a
 * test rather than trust. Delays are set to 0-1ms so this stays fast.
 */
const err = (status: number) => Object.assign(new Error(`http ${status}`), { status });
const netErr = (code: string) => Object.assign(new Error(code), { code });

describe("withRetry", () => {
  it("returns immediately on success without retrying", async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient 500 and eventually succeeds", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw err(500);
        return "recovered";
      },
      { retries: 4, baseDelayMs: 1 },
    );
    expect(out).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("retries 429 rate limits", async () => {
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw err(429);
        return "ok";
      },
      { retries: 3, baseDelayMs: 1 },
    );
    expect(calls).toBe(2);
  });

  it("FAILS FAST on 4xx — exactly one attempt, no hammering", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw err(status);
          },
          { retries: 4, baseDelayMs: 1 },
        ),
      ).rejects.toThrow(`http ${status}`);
      expect(calls, `status ${status} should not be retried`).toBe(1);
    }
  });

  it("retries network-level errors (ECONNRESET / ETIMEDOUT)", async () => {
    for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw netErr(code);
          },
          { retries: 2, baseDelayMs: 1 },
        ),
      ).rejects.toThrow(code);
      expect(calls, `${code} should be retried`).toBe(3); // 1 initial + 2 retries
    }
  });

  it("gives up after `retries` attempts and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err(503);
        },
        { retries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("http 503");
    expect(calls).toBe(4); // 1 initial + 3 retries
  });

  it("backs off exponentially (each wait lands in its own base*2^n window)", async () => {
    // Delay is base * 2^attempt + jitter(0..base), so with base=40 the windows
    // are [40,80) then [80,120) — non-overlapping, hence assertable without
    // flake (a flat/linear backoff would land the 2nd wait under 80ms).
    const base = 40;
    const started: number[] = [];
    await expect(
      withRetry(
        async () => {
          started.push(Date.now());
          throw err(500);
        },
        { retries: 2, baseDelayMs: base },
      ),
    ).rejects.toThrow();

    expect(started).toHaveLength(3);
    const gap1 = started[1]! - started[0]!;
    const gap2 = started[2]! - started[1]!;
    expect(gap1).toBeGreaterThanOrEqual(base * 0.9); // ≥ ~40ms
    expect(gap2).toBeGreaterThanOrEqual(base * 2 * 0.9); // ≥ ~80ms — doubled
    expect(gap2).toBeGreaterThan(gap1); // strictly growing
  });

  it("honours a custom isRetryable predicate", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err(500);
        },
        { retries: 3, baseDelayMs: 1, isRetryable: () => false },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("defaultRetryable classifies statuses the way the README says", () => {
    expect(defaultRetryable(err(500))).toBe(true);
    expect(defaultRetryable(err(502))).toBe(true);
    expect(defaultRetryable(err(429))).toBe(true);
    expect(defaultRetryable(err(400))).toBe(false);
    expect(defaultRetryable(err(401))).toBe(false);
    expect(defaultRetryable(err(404))).toBe(false);
    expect(defaultRetryable(netErr("ECONNRESET"))).toBe(true);
    expect(defaultRetryable(new Error("unknown shape"))).toBe(true);
  });
});
