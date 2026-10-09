import type { Rng } from "@litt/engine";

/** Uniform float in [0, 1) from the CSPRNG. Math.random's state can be recovered from its outputs, which would let a player predict deals. */
export const secureRandom: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/**
 * Whether a browser request was sent by this site. Browsers always send Origin on WebSocket handshakes and
 * cross-origin POSTs; a request without one comes from a non-browser client that cannot carry a victim's cookies.
 */
export function isAllowedOrigin(origin: string | null | undefined, host: string | null | undefined, publicOrigin?: string): boolean {
  if (!origin) return true;
  if (publicOrigin && origin === publicOrigin) return true;
  try {
    return !!host && new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Fixed-window request counter per key, kept in memory (one Node process serves every room). */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a hit for `key`; false once the key is over its limit for the current window. */
  take(key: string): boolean {
    const time = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= time) {
      if (this.windows.size >= 10_000) {
        for (const [stale, entry] of this.windows) if (entry.resetAt <= time) this.windows.delete(stale);
      }
      window = { count: 0, resetAt: time + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count <= this.limit;
  }
}

/** Token bucket for one connection: allows bursts of `capacity`, refilling at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.refilledAt = now();
  }

  take(): boolean {
    const time = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (time - this.refilledAt) * this.perSecond / 1000);
    this.refilledAt = time;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
