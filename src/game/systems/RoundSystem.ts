import type { RoundTuning } from '../config/balance'
import type { GameEventBus } from '../events'
import {
  runnerChanceForRound,
  spawnIntervalForRound,
  zombieHealthForRound,
  zombiesForRound,
} from '../rounds/scaling'

/** What the round system needs from whatever puts zombies into the world. */
export interface ZombieSpawner {
  /** Zombies currently alive (the cap applies to these). */
  readonly aliveCount: number
  /** Spawns one zombie. Returns false if it couldn't (pool full, no window available). */
  spawn(health: number, runnerChance: number): boolean
}

export type RoundPhase = 'intro' | 'active' | 'intermission'

/**
 * Runs the round loop: an intro delay, then rounds that spawn a fixed number of zombies
 * (queued behind the alive cap) and end when every one of them is dead, separated by an
 * intermission.
 */
export class RoundSystem {
  round = 0
  phase: RoundPhase = 'intro'
  /** Zombies this round that haven't spawned yet. */
  queued = 0
  /** Zombies this round still to be killed (queued + alive). */
  remaining = 0

  private readonly spawner: ZombieSpawner
  private readonly events: GameEventBus
  private readonly t: RoundTuning
  private readonly maxAlive: number
  private timer: number
  private spawnTimer = 0
  private readonly unsubscribe: () => void

  constructor(spawner: ZombieSpawner, events: GameEventBus, tuning: RoundTuning, maxAlive: number) {
    this.spawner = spawner
    this.events = events
    this.t = tuning
    this.maxAlive = maxAlive
    this.timer = tuning.introDelay
    this.unsubscribe = events.on('targetHit', (e) => {
      if (e.targetKind === 'zombie' && e.killed) this.onZombieKilled()
    })
  }

  /** Seconds until the next round starts (intro or intermission), else 0. */
  get countdown(): number {
    return this.phase === 'active' ? 0 : Math.max(this.timer, 0)
  }

  update(dt: number): void {
    if (this.phase !== 'active') {
      this.timer -= dt
      if (this.timer <= 0) this.startRound(this.round + 1)
      return
    }

    this.spawnTimer -= dt
    if (this.queued > 0 && this.spawnTimer <= 0 && this.spawner.aliveCount < this.maxAlive) {
      const r = this.round
      if (this.spawner.spawn(zombieHealthForRound(r, this.t), runnerChanceForRound(r, this.t))) {
        this.queued--
        this.spawnTimer = spawnIntervalForRound(r, this.t)
      }
    }
  }

  dispose(): void {
    this.unsubscribe()
  }

  private startRound(round: number): void {
    this.round = round
    this.phase = 'active'
    const total = zombiesForRound(round, this.t)
    this.queued = total
    this.remaining = total
    this.spawnTimer = 0
    this.events.emit('roundStarted', { round, zombies: total })
  }

  private onZombieKilled(): void {
    if (this.phase !== 'active' || this.remaining <= 0) return
    this.remaining--
    if (this.remaining > 0) return
    this.phase = 'intermission'
    this.timer = this.t.intermission
    this.events.emit('roundEnded', { round: this.round })
  }
}
