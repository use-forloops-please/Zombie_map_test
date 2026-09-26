import type { Rng } from '../../engine/rng'
import type { CrateTuning } from '../config/balance'

/**
 * Picks a key with probability proportional to its weight, skipping keys that are
 * excluded or have no positive weight. Returns null if nothing is eligible.
 */
export function pickWeighted<K extends string>(
  weights: Partial<Record<K, number>>,
  exclude: (key: K) => boolean,
  rng: Rng,
): K | null {
  let total = 0
  for (const key in weights) {
    const w = weights[key] ?? 0
    if (w > 0 && !exclude(key)) total += w
  }
  if (total <= 0) return null
  let roll = rng() * total
  let last: K | null = null
  for (const key in weights) {
    const w = weights[key] ?? 0
    if (w <= 0 || exclude(key)) continue
    last = key
    roll -= w
    if (roll < 0) return key
  }
  // Floating-point leftovers land on the last eligible key.
  return last
}

/** Chance the crate moves on after its `spin`-th spin at the current spot (1-based). */
export function relocationChance(spin: number, t: CrateTuning): number {
  if (spin < t.relocateMinSpins) return 0
  if (spin < t.relocateLateAfter) return t.relocateEarlyChance
  return t.relocateLateChance
}

/** Rolls whether the crate moves on after its `spin`-th spin at the current spot. */
export function rollRelocation(spin: number, rng: Rng, t: CrateTuning): boolean {
  return rng() < relocationChance(spin, t)
}
