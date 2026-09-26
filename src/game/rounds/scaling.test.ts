import { describe, expect, it } from 'vitest'
import { balance } from '../config/balance'
import {
  runnerChanceForRound,
  spawnIntervalForRound,
  zombieHealthForRound,
  zombiesForRound,
} from './scaling'

const t = balance.rounds

describe('zombiesForRound', () => {
  it('starts around 6 and reaches 24 by round 5', () => {
    expect(zombiesForRound(1, t)).toBe(6)
    expect(zombiesForRound(5, t)).toBe(24)
  })

  it('never decreases and grows linearly after the table', () => {
    for (let r = 2; r <= 30; r++) {
      expect(zombiesForRound(r, t)).toBeGreaterThan(zombiesForRound(r - 1, t))
    }
    for (let r = 6; r <= 30; r++) {
      expect(zombiesForRound(r, t) - zombiesForRound(r - 1, t)).toBe(t.zombieCountGrowth)
    }
  })
})

describe('zombieHealthForRound', () => {
  it('is 150 in round 1 and +100 per round through round 9', () => {
    expect(zombieHealthForRound(1, t)).toBe(150)
    expect(zombieHealthForRound(2, t)).toBe(250)
    expect(zombieHealthForRound(5, t)).toBe(550)
    expect(zombieHealthForRound(9, t)).toBe(950)
  })

  it('multiplies by 1.1 per round after round 9', () => {
    expect(zombieHealthForRound(10, t)).toBe(1045)
    expect(zombieHealthForRound(11, t)).toBe(1149)
    expect(zombieHealthForRound(20, t)).toBe(Math.floor(950 * 1.1 ** 11))
  })
})

describe('runnerChanceForRound', () => {
  it('has no runners before runnerStartRound, then ramps up to the cap', () => {
    expect(runnerChanceForRound(1, t)).toBe(0)
    expect(runnerChanceForRound(t.runnerStartRound - 1, t)).toBe(0)
    expect(runnerChanceForRound(t.runnerStartRound, t)).toBeCloseTo(t.runnerChancePerRound)
    expect(runnerChanceForRound(t.runnerStartRound + 1, t)).toBeCloseTo(2 * t.runnerChancePerRound)
    expect(runnerChanceForRound(50, t)).toBe(t.maxRunnerChance)
  })

  it('shifts the horde toward runners as rounds progress', () => {
    for (let r = 2; r <= 20; r++) {
      expect(runnerChanceForRound(r, t)).toBeGreaterThanOrEqual(runnerChanceForRound(r - 1, t))
    }
  })
})

describe('spawnIntervalForRound', () => {
  it('shrinks each round down to the minimum', () => {
    expect(spawnIntervalForRound(1, t)).toBe(t.spawnIntervalStart)
    expect(spawnIntervalForRound(2, t)).toBeCloseTo(t.spawnIntervalStart - t.spawnIntervalStep)
    expect(spawnIntervalForRound(100, t)).toBe(t.spawnIntervalMin)
  })
})
