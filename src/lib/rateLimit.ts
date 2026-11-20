// A plain in-memory fixed-window limiter — deliberately NOT Redis-backed. Per the plan
// doc's architecture, real distributed rate limiting belongs with the Background Jobs/Queue
// layer's Redis (Phase 10's hosting decision); this is the one piece that needs no decision
// at all and is worth having today: it still stops a single server instance from being
// hammered, which is exactly the case to defend first (one attacker, one process). The one
// real limitation to know about: with more than one server instance behind a load balancer,
// each instance counts attempts independently, so the effective limit multiplies by however
// many instances are running. Flagged in README, not hidden.
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Unbounded growth guard: a fixed-window map keyed by identifier+IP could grow forever
// under a sustained attack across many identifiers. Cheap mitigation — sweep expired
// buckets whenever the map gets large, rather than adding a background timer (Phase 10's
// Background Jobs layer is where a real scheduled sweep belongs).
const MAX_BUCKETS_BEFORE_SWEEP = 10_000;

function sweepExpired(now: number) {
  if (buckets.size < MAX_BUCKETS_BEFORE_SWEEP) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Fixed-window check: `key` gets `limit` attempts per `windowMs`, then is rejected until
 * the window resets. Call once per attempt (not per request) — e.g. once per login POST,
 * not once per line of validation inside it.
 */
export function checkRateLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  const { limit, windowMs } = opts;
  const now = Date.now();
  sweepExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}
