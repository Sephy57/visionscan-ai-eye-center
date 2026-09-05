/**
 * In-memory fixed-window rate limiter.
 *
 * LIMITATION (documented, not hidden): this is per-process memory. It is
 * correct and effective for this single-instance local deployment. A
 * multi-instance production deployment needs a shared store (Redis or
 * equivalent) - see docs/PHASE5B_SECURITY.md, marked REQUIRES EXTERNAL
 * INFRASTRUCTURE.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - b.windowStart) };
  }
  b.count += 1;
  return { allowed: true, remaining: limit - b.count, retryAfterMs: 0 };
}

/** Periodic cleanup so the map does not grow unbounded over a long-running process. */
export function pruneRateLimitBuckets(maxAgeMs = 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.windowStart > maxAgeMs) buckets.delete(key);
  }
}

export function _resetRateLimitForTests(): void {
  buckets.clear();
}
