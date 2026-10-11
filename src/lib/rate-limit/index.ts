/* In-process fixed-window rate limiter.

   Deliberately NOT Redis. Rate-limiting exactly one endpoint does not justify
   an external service, a network hop and a recurring cost.

   Documented limitations, both accepted for a single-container deployment:
   state is lost on restart, and it does not span instances. nginx `limit_req`
   provides a second, instance-independent layer in front of this. If the app
   is ever scaled horizontally, revisit. */

type Entry = { count: number; resetAt: number };

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

const buckets = new Map<string, Entry>();

function sweep(now: number) {
  // Bounded cleanup so the map cannot grow without limit under sustained abuse.
  if (buckets.size < 5000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(key: string): {
  ok: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= MAX_PER_WINDOW) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

/* Read the client IP from the proxy headers.

   Only the RIGHTMOST hop we control is trustworthy. A naive leftmost read of
   X-Forwarded-For is trivially spoofable by the client, which would turn this
   limiter into a no-op — the exact bug the plan calls out. */
export function clientKeyFromHeaders(headers: Headers): string {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}
