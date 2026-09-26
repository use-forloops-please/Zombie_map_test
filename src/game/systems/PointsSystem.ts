import type { PointsTuning } from '../config/balance'
import type { HitZone } from '../entities/hitboxes'
import type { GameEvents, GameEventBus } from '../events'

/**
 * Points for a single hit on a zombie. A hit that doesn't kill pays `hit`; the killing hit
 * pays the kill bonus for how it was killed instead. Limb and splash kills count as body kills.
 */
export function pointsForHit(e: GameEvents['targetHit'], t: PointsTuning): number {
  if (e.targetKind !== 'zombie') return 0
  if (!e.killed) return t.hit
  if (e.cause === 'melee') return t.meleeKill
  return killBonus(e.zone, t)
}

function killBonus(zone: HitZone, t: PointsTuning): number {
  switch (zone) {
    case 'head':
      return t.headshotKill
    case 'neck':
      return t.neckKill
    case 'torso':
    case 'limb':
      return t.bodyKill
  }
}

/** The player's points: earned from hits, kills and board repairs (repairs capped per round). */
export class PointsSystem {
  private _points: number
  private repairEarnedThisRound = 0
  private readonly events: GameEventBus
  private readonly t: PointsTuning
  private readonly unsubscribers: (() => void)[] = []

  constructor(events: GameEventBus, tuning: PointsTuning) {
    this.events = events
    this.t = tuning
    this._points = tuning.starting
    this.unsubscribers.push(
      events.on('boardRepaired', () => this.awardRepair()),
      events.on('targetHit', (e) => this.change(pointsForHit(e, this.t))),
      events.on('roundStarted', () => {
        this.repairEarnedThisRound = 0
      }),
    )
  }

  get points(): number {
    return this._points
  }

  canAfford(amount: number): boolean {
    return this._points >= amount
  }

  /**
   * Spends points if the player can afford it. Otherwise spends nothing, announces
   * `purchaseDenied` and returns false.
   */
  spend(amount: number): boolean {
    if (!this.canAfford(amount)) {
      this.events.emit('purchaseDenied', { cost: amount })
      return false
    }
    this.change(-amount)
    return true
  }

  /** Gives back points from a purchase that didn't deliver (e.g. a crate that moved on). */
  refund(amount: number): void {
    this.change(amount)
  }

  /** Dev/testing only: adds points without a reason. */
  grant(amount: number): void {
    this.change(amount)
  }

  dispose(): void {
    for (const off of this.unsubscribers) off()
  }

  private awardRepair(): void {
    const remaining = this.t.repairCapPerRound - this.repairEarnedThisRound
    const award = Math.min(this.t.boardRepaired, remaining)
    if (award <= 0) return
    this.repairEarnedThisRound += award
    this.change(award)
  }

  private change(delta: number): void {
    if (delta === 0) return
    this._points += delta
    this.events.emit('pointsChanged', { points: this._points, delta })
  }
}
