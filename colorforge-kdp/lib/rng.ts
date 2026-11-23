/**
 * Seeded random numbers. Every generated book stores its seed, so the same
 * project always rebuilds the same puzzles (re-exports, answer keys, and
 * fixes after a KDP rejection never change the content).
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** A child generator, so one part of a book can change without reshuffling the rest. */
  fork(label: string): Rng;
}

/** FNV-1a: turns any string seed into a 32-bit integer. */
export function hashSeed(seed: string | number): number {
  const str = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for puzzle layout. */
export function createRng(seed: string | number): Rng {
  const base = String(seed);
  let state = hashSeed(base);

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    pick: <T>(items: readonly T[]) => {
      if (items.length === 0) throw new RangeError("Cannot pick from an empty list");
      return items[int(0, items.length - 1)]!;
    },
    shuffle: <T>(items: readonly T[]) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    fork: (label: string) => createRng(`${base}/${label}`),
  };
}
