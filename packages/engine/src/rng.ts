import type { Rng } from "./types.js";

/** Deterministic mulberry32 PRNG. Returns floats in [0, 1). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a uniformly random element of a non-empty list. */
export function pick<T>(list: readonly T[], rng: Rng): T {
  const i = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[i]!;
}
