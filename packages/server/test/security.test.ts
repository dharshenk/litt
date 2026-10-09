import { describe, expect, it } from "vitest";
import { RateLimiter, TokenBucket, isAllowedOrigin, secureRandom } from "../src/security.js";

describe("secureRandom", () => {
  it("returns floats in [0, 1)", () => {
    for (let index = 0; index < 1000; index++) {
      const value = secureRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("isAllowedOrigin", () => {
  it("allows requests from the public origin or the requested host, and non-browser requests", () => {
    expect(isAllowedOrigin(undefined, "litt.example", "https://litt.example")).toBe(true);
    expect(isAllowedOrigin("https://litt.example", "10.0.0.2:8787", "https://litt.example")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173", "127.0.0.1:5173", "http://localhost:8787")).toBe(true);
    expect(isAllowedOrigin("https://LITT.example", "Litt.Example")).toBe(true);
  });

  it("rejects other sites, opaque origins and missing hosts", () => {
    expect(isAllowedOrigin("https://evil.example", "litt.example", "https://litt.example")).toBe(false);
    expect(isAllowedOrigin("https://litt.example.evil.example", "litt.example")).toBe(false);
    expect(isAllowedOrigin("null", "litt.example", "https://litt.example")).toBe(false);
    expect(isAllowedOrigin("https://evil.example", undefined)).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("limits each key per window and resets when the window ends", () => {
    let time = 0;
    const limiter = new RateLimiter(2, 1000, () => time);
    expect([limiter.take("a"), limiter.take("a"), limiter.take("a"), limiter.take("b")]).toEqual([true, true, false, true]);
    time = 999;
    expect(limiter.take("a")).toBe(false);
    time = 1000;
    expect(limiter.take("a")).toBe(true);
  });
});

describe("TokenBucket", () => {
  it("allows a burst, then refills at the configured rate", () => {
    let time = 0;
    const bucket = new TokenBucket(3, 2, () => time);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
    time = 250;
    expect(bucket.take()).toBe(false);
    time = 1000;
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
    time = 60_000;
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });
});
