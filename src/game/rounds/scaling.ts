import type { RoundTuning } from '../config/balance'

/** How many zombies round `round` (1-based) sends in total. */
export function zombiesForRound(round: number, t: RoundTuning): number {
  const table = t.zombieCounts
  const last = table[table.length - 1] ?? 0
  if (round <= table.length) return table[round - 1] ?? last
  return last + (round - table.length) * t.zombieCountGrowth
}

/** Health of every zombie in round `round`: linear to `healthLinearUntil`, then compounding. */
export function zombieHealthForRound(round: number, t: RoundTuning): number {
  const linearRound = Math.min(round, t.healthLinearUntil)
  const linear = t.healthBase + t.healthPerRound * (linearRound - 1)
  const extra = Math.max(round - t.healthLinearUntil, 0)
  return Math.floor(linear * t.healthGrowth ** extra)
}

/** Chance that a zombie spawned in round `round` is a runner. */
export function runnerChanceForRound(round: number, t: RoundTuning): number {
  const steps = round - t.runnerStartRound + 1
  if (steps <= 0) return 0
  return Math.min(steps * t.runnerChancePerRound, t.maxRunnerChance)
}

/** Seconds between spawns in round `round`. */
export function spawnIntervalForRound(round: number, t: RoundTuning): number {
  return Math.max(t.spawnIntervalStart - t.spawnIntervalStep * (round - 1), t.spawnIntervalMin)
}
