import { describe, expect, it } from 'vitest'
import { balance } from '../config/balance'
import { EventBus, type GameEvents } from '../events'
import { zombieHealthForRound, zombiesForRound } from '../rounds/scaling'
import { RoundSystem, type ZombieSpawner } from './RoundSystem'

const DT = 1 / 60
const t = balance.rounds

/** Records spawns; "alive" is spawned minus killed. */
class FakeSpawner implements ZombieSpawner {
  spawned: { health: number; runnerChance: number }[] = []
  killed = 0
  poolFull = false
  get aliveCount() {
    return this.spawned.length - this.killed
  }
  spawn(health: number, runnerChance: number) {
    if (this.poolFull) return false
    this.spawned.push({ health, runnerChance })
    return true
  }
}

function setup(maxAlive = 24) {
  const events = new EventBus<GameEvents>()
  const spawner = new FakeSpawner()
  const rounds = new RoundSystem(spawner, events, t, maxAlive)
  const log: string[] = []
  events.on('roundStarted', (e) => log.push(`start ${e.round} (${e.zombies})`))
  events.on('roundEnded', (e) => log.push(`end ${e.round}`))
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) rounds.update(DT)
  }
  const kill = (n: number) => {
    for (let i = 0; i < n; i++) {
      spawner.killed++
      events.emit('targetHit', {
        targetKind: 'zombie',
        zone: 'torso',
        damage: 999,
        killed: true,
        healthLeft: 0,
        cause: 'bullet',
      })
    }
  }
  return { events, spawner, rounds, log, run, kill }
}

describe('RoundSystem', () => {
  it('starts round 1 after the intro delay', () => {
    const { rounds, run, log } = setup()
    run(t.introDelay - 0.1)
    expect(rounds.round).toBe(0)
    expect(rounds.phase).toBe('intro')
    run(0.2)
    expect(rounds.round).toBe(1)
    expect(log).toEqual([`start 1 (${zombiesForRound(1, t)})`])
  })

  it('spawns exactly the round count, at the round health, one per spawn interval', () => {
    const { spawner, run } = setup()
    run(t.introDelay + 0.05)
    expect(spawner.spawned.length).toBe(1)
    run(t.spawnIntervalStart - 0.1)
    expect(spawner.spawned.length).toBe(1)
    run(60)
    expect(spawner.spawned.length).toBe(zombiesForRound(1, t))
    expect(spawner.spawned.every((s) => s.health === zombieHealthForRound(1, t))).toBe(true)
  })

  it('queues zombies beyond the alive cap until some die', () => {
    const { spawner, rounds, run, kill } = setup(4)
    run(t.introDelay + 60)
    expect(spawner.aliveCount).toBe(4)
    expect(rounds.queued).toBe(zombiesForRound(1, t) - 4)
    kill(2)
    run(10)
    expect(spawner.aliveCount).toBe(4)
    expect(spawner.spawned.length).toBe(zombiesForRound(1, t))
  })

  it('retries a spawn the spawner refused', () => {
    const { spawner, run } = setup()
    spawner.poolFull = true
    run(t.introDelay + 5)
    expect(spawner.spawned.length).toBe(0)
    spawner.poolFull = false
    run(DT * 2)
    expect(spawner.spawned.length).toBe(1)
  })

  it('ends the round when every zombie is dead, then starts the next after the intermission', () => {
    const { rounds, run, kill, log, spawner } = setup()
    run(t.introDelay + 60)
    kill(zombiesForRound(1, t) - 1)
    expect(rounds.phase).toBe('active')
    kill(1)
    expect(rounds.phase).toBe('intermission')
    expect(rounds.countdown).toBeCloseTo(t.intermission)
    run(t.intermission - 0.1)
    expect(rounds.round).toBe(1)
    run(0.2)
    expect(rounds.round).toBe(2)
    run(120)
    expect(spawner.spawned.slice(-1)[0]?.health).toBe(zombieHealthForRound(2, t))
    expect(log).toEqual([
      `start 1 (${zombiesForRound(1, t)})`,
      'end 1',
      `start 2 (${zombiesForRound(2, t)})`,
    ])
  })

  it('plays through to round 5 with the balance.ts counts and health', () => {
    const { events, rounds, run, kill, spawner } = setup()
    // Spawn count when each round started, so a round's spawns are counted from its start.
    const startedAt: number[] = []
    events.on('roundStarted', (e) => (startedAt[e.round] = spawner.spawned.length))
    run(t.introDelay + 0.1)
    for (let r = 1; r <= 5; r++) {
      expect(rounds.round).toBe(r)
      const before = startedAt[r] ?? -1
      run(120)
      const spawnedThisRound = spawner.spawned.length - before
      expect(spawnedThisRound).toBe(zombiesForRound(r, t))
      expect(
        spawner.spawned.slice(before).every((s) => s.health === zombieHealthForRound(r, t)),
      ).toBe(true)
      kill(spawnedThisRound)
      run(t.intermission + 0.1)
    }
    expect(rounds.round).toBe(6)
  })

  it('ignores dummy kills and non-lethal hits', () => {
    const { events, rounds, run } = setup()
    run(t.introDelay + 0.1)
    const before = rounds.remaining
    events.emit('targetHit', {
      targetKind: 'dummy',
      zone: 'head',
      damage: 999,
      killed: true,
      healthLeft: 0,
      cause: 'bullet',
    })
    events.emit('targetHit', {
      targetKind: 'zombie',
      zone: 'head',
      damage: 10,
      killed: false,
      healthLeft: 100,
      cause: 'bullet',
    })
    expect(rounds.remaining).toBe(before)
  })
})
