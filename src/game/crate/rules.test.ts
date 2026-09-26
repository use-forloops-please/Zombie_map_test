import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine/rng'
import { balance } from '../config/balance'
import type { WeaponId } from '../weapons/definitions'
import { pickWeighted, relocationChance, rollRelocation } from './rules'

const t = balance.crate
const pool = t.pool as Partial<Record<WeaponId, number>>
const total = Object.values(pool).reduce((a, b) => a + (b ?? 0), 0)

describe('pickWeighted', () => {
  it('matches the configured weights over many spins', () => {
    const rng = createRng(1234)
    const n = 100_000
    const counts = new Map<WeaponId, number>()
    for (let i = 0; i < n; i++) {
      const k = pickWeighted(pool, () => false, rng)!
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const [id, w] of Object.entries(pool) as [WeaponId, number][]) {
      const expected = w / total
      expect(Math.abs((counts.get(id) ?? 0) / n - expected)).toBeLessThan(0.01)
    }
  })

  it('makes the experimental weapon rare', () => {
    expect((pool.pulse_caster ?? 0) / total).toBeLessThan(0.06)
    expect(pool.pulse_caster).toBeGreaterThan(0)
  })

  it('never returns an excluded (already owned) weapon, and renormalises the rest', () => {
    const rng = createRng(9)
    const owned = new Set<WeaponId>(['rifle_carbine', 'smg_compact'])
    const n = 50_000
    let caster = 0
    for (let i = 0; i < n; i++) {
      const k = pickWeighted(pool, (id) => owned.has(id), rng)
      expect(k && owned.has(k)).toBe(false)
      if (k === 'pulse_caster') caster++
    }
    const remaining = total - (pool.rifle_carbine ?? 0) - (pool.smg_compact ?? 0)
    expect(Math.abs(caster / n - (pool.pulse_caster ?? 0) / remaining)).toBeLessThan(0.01)
  })

  it('never offers a weapon that is not in the pool (e.g. the starting pistol)', () => {
    const rng = createRng(5)
    for (let i = 0; i < 10_000; i++)
      expect(pickWeighted(pool, () => false, rng)).not.toBe('pistol_service')
  })

  it('returns null when everything is excluded', () => {
    expect(pickWeighted(pool, () => true, createRng(1))).toBeNull()
    expect(pickWeighted<WeaponId>({}, () => false, createRng(1))).toBeNull()
  })
})

describe('relocation odds', () => {
  it('can never move before spin 4', () => {
    for (let spin = 1; spin < t.relocateMinSpins; spin++) expect(relocationChance(spin, t)).toBe(0)
    const rng = createRng(77)
    for (let i = 0; i < 10_000; i++) {
      for (let spin = 1; spin < 4; spin++) expect(rollRelocation(spin, rng, t)).toBe(false)
    }
  })

  /** Simulates many crates and returns the spin number each one moved on. */
  function spinsUntilMove(trials: number, seed: number): number[] {
    const rng = createRng(seed)
    const result: number[] = []
    for (let i = 0; i < trials; i++) {
      let spin = 1
      while (!rollRelocation(spin, rng, t)) spin++
      result.push(spin)
    }
    return result
  }

  it('is more likely to move after spin 8 than between spins 4 and 7', () => {
    const moves = spinsUntilMove(100_000, 42)
    const early = moves.filter((s) => s >= 4 && s < 8).length / moves.length
    const late = moves.filter((s) => s >= 8).length / moves.length
    expect(Math.min(...moves)).toBe(4)
    expect(late).toBeGreaterThan(early)
    // Analytically: early = 1 − 0.9⁴ ≈ 0.344, late ≈ 0.656.
    expect(early).toBeCloseTo(1 - (1 - t.relocateEarlyChance) ** 4, 1)
  })

  it('averages roughly nine to ten spins per spot', () => {
    const moves = spinsUntilMove(100_000, 7)
    const mean = moves.reduce((a, b) => a + b, 0) / moves.length
    // 1 − 0.9⁴ of crates move by 7; the rest average 8 + (1/0.35 − 1).
    expect(mean).toBeGreaterThan(8)
    expect(mean).toBeLessThan(11)
  })
})
