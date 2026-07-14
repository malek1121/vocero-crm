/**
 * In-process sliding-window rate limiting for the single-replica monolith.
 * Expired buckets are pruned and the key count is capped to avoid memory growth.
 */

type Bucket = number[];

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

export const RATE_LIMIT_MAX_KEYS = 10_000;
const PRUNE_AT_KEYS = 256;

function pruneExpired(buckets: Map<string, Bucket>, cutoff: number): void {
  for (const [key, timestamps] of buckets) {
    if (timestamps.every((timestamp) => timestamp <= cutoff)) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  const cutoff = now - opts.windowMs;

  if (buckets.size >= PRUNE_AT_KEYS) pruneExpired(buckets, cutoff);
  if (!buckets.has(key) && buckets.size >= RATE_LIMIT_MAX_KEYS) {
    const oldestKey = buckets.keys().next().value as string | undefined;
    if (oldestKey) buckets.delete(oldestKey);
  }

  const bucket = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (bucket.length >= opts.max) {
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0 };
  }

  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: opts.max - bucket.length };
}

/** Test-only observability for the bounded store. */
export function rateLimitStoreSize(): number {
  return store().size;
}

export function resetRateLimit(): void {
  store().clear();
}

export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };