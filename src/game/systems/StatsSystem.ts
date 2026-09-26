import type { GameEventBus } from '../events'

/** Tallies the numbers shown on the game-over screen. */
export class StatsSystem {
  kills = 0
  /** Kills where the killing hit was to the head. */
  headshots = 0
  private readonly unsubscribe: () => void

  constructor(events: GameEventBus) {
    this.unsubscribe = events.on('targetHit', (e) => {
      if (e.targetKind !== 'zombie' || !e.killed) return
      this.kills++
      if (e.zone === 'head' && e.cause === 'bullet') this.headshots++
    })
  }

  dispose(): void {
    this.unsubscribe()
  }
}
