import type { PlayerTuning } from '../config/balance'
import type { GameEventBus } from '../events'

/**
 * Player health: takes damage from `playerHit`, regenerates after a quiet period, and
 * emits `playerDowned` at zero. Pure state + events; no physics or rendering.
 */
export class PlayerHealthSystem {
  health: number
  /** Dev/testing only: ignore all damage. */
  invulnerable = false
  private readonly events: GameEventBus
  private readonly t: PlayerTuning
  private sinceHit = Infinity
  private downed = false
  private readonly unsubscribe: () => void

  constructor(events: GameEventBus, tuning: PlayerTuning) {
    this.events = events
    this.t = tuning
    this.health = tuning.maxHealth
    this.unsubscribe = events.on('playerHit', (e) => this.takeDamage(e.damage))
  }

  get isDowned(): boolean {
    return this.downed
  }

  update(dt: number): void {
    if (this.downed) return
    this.sinceHit += dt
    if (this.sinceHit < this.t.regenDelay || this.health >= this.t.maxHealth) return
    this.setHealth(Math.min(this.health + this.t.regenRate * dt, this.t.maxHealth))
  }

  takeDamage(amount: number): void {
    if (this.downed || this.invulnerable) return
    this.sinceHit = 0
    this.setHealth(Math.max(this.health - amount, 0))
    if (this.health === 0) {
      this.downed = true
      this.events.emit('playerDowned', {})
    }
  }

  /** Restores full health (e.g. after a respawn). */
  reset(): void {
    this.downed = false
    this.sinceHit = Infinity
    this.setHealth(this.t.maxHealth)
  }

  dispose(): void {
    this.unsubscribe()
  }

  private setHealth(value: number): void {
    if (value === this.health) return
    this.health = value
    this.events.emit('playerHealthChanged', { health: value, max: this.t.maxHealth })
  }
}
