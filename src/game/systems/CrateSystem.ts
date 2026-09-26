import type { Physics } from '../../engine/Physics'
import type { Rng } from '../../engine/rng'
import type { CrateSpotDef } from '../../maps/schema'
import type { CrateTuning, PurchaseTuning } from '../config/balance'
import { pickWeighted, rollRelocation } from '../crate/rules'
import type { Crate } from '../entities/Crate'
import type { ZoneState } from '../entities/Zones'
import type { GameEventBus } from '../events'
import { weaponDefs, type WeaponId } from '../weapons/definitions'
import { oncePerPress, type Interactable } from './InteractSystem'
import type { PointsSystem } from './PointsSystem'
import type { WeaponSystem } from './WeaponSystem'

/**
 * The supply crate: pay to spin, watch it cycle, take the weapon it offers. After enough
 * spins at one spot it moves on instead (refunding that spin) to another spot in an
 * active zone.
 */
export class CrateSystem {
  readonly crate: Crate
  private readonly spots: readonly CrateSpotDef[]
  private readonly zones: ZoneState
  private readonly weapons: WeaponSystem
  private readonly points: PointsSystem
  private readonly events: GameEventBus
  private readonly physics: Physics
  private readonly rng: Rng
  private readonly t: CrateTuning
  private readonly purchases: PurchaseTuning

  constructor(
    crate: Crate,
    spots: readonly CrateSpotDef[],
    zones: ZoneState,
    weapons: WeaponSystem,
    points: PointsSystem,
    events: GameEventBus,
    physics: Physics,
    rng: Rng,
    tuning: CrateTuning,
    purchases: PurchaseTuning,
  ) {
    this.crate = crate
    this.spots = spots
    this.zones = zones
    this.weapons = weapons
    this.points = points
    this.events = events
    this.physics = physics
    this.rng = rng
    this.t = tuning
    this.purchases = purchases
  }

  update(dt: number): void {
    const c = this.crate
    if (c.state === 'idle') return
    c.stateTimer -= dt
    if (c.stateTimer > 0) return

    switch (c.state) {
      case 'cycling':
        if (c.nextSpot) {
          // The reveal is "moving on": refund the spin and fly off.
          this.points.refund(this.t.cost)
          this.events.emit('crateRelocating', { fromSpot: c.spot.id, toSpot: c.nextSpot.id })
          c.state = 'relocating'
          c.stateTimer = this.t.relocateTime
        } else if (c.offer) {
          this.events.emit('crateOffered', { weaponId: c.offer })
          c.state = 'offering'
          c.stateTimer = this.t.offerTime
        } else {
          this.reset()
        }
        break
      case 'offering':
        // Not taken in time.
        this.reset()
        break
      case 'relocating':
        if (c.nextSpot) c.place(c.nextSpot)
        c.spinsAtSpot = 0
        this.reset()
        break
    }
  }

  /** Pays for and starts a spin. Returns false if the crate is busy or unaffordable. */
  spin(): boolean {
    const c = this.crate
    if (c.state !== 'idle' || !this.points.spend(this.t.cost)) return false
    c.spinsAtSpot++
    c.nextSpot = rollRelocation(c.spinsAtSpot, this.rng, this.t) ? this.pickNextSpot() : null
    c.offer = c.nextSpot
      ? null
      : pickWeighted<WeaponId>(this.t.pool, (id) => this.weapons.owns(id), this.rng)
    if (!c.nextSpot && !c.offer) {
      // Nothing left to give (the player owns the whole pool): no charge.
      this.points.refund(this.t.cost)
      c.spinsAtSpot--
      return false
    }
    c.state = 'cycling'
    c.stateTimer = this.t.cycleTime
    this.events.emit('crateSpun', { cost: this.t.cost })
    return true
  }

  /** Takes the weapon on offer. Returns false if nothing is on offer. */
  take(): boolean {
    const c = this.crate
    if (c.state !== 'offering' || !c.offer) return false
    this.weapons.giveWeapon(c.offer)
    this.events.emit('crateTaken', { weaponId: c.offer })
    this.reset()
    return true
  }

  prompt(): string | null {
    const c = this.crate
    const cost = this.t.cost.toLocaleString('en-US')
    if (c.state === 'idle') {
      return this.points.canAfford(this.t.cost)
        ? `Hold F to open the supply crate [${cost}]`
        : `Supply crate [${cost}] — not enough points`
    }
    if (c.state === 'offering' && c.offer) return `Hold F to take ${weaponDefs[c.offer].name}`
    return null
  }

  createInteractables(): Interactable[] {
    return [
      {
        position: this.crate.usePoint,
        range: this.purchases.wallBuyRange,
        prompt: () => this.prompt(),
        ...oncePerPress(() => {
          if (this.crate.state === 'offering') this.take()
          else this.spin()
        }),
      },
    ]
  }

  dispose(): void {
    this.crate.dispose(this.physics)
  }

  private reset(): void {
    const c = this.crate
    c.state = 'idle'
    c.stateTimer = 0
    c.offer = null
    c.nextSpot = null
  }

  /** A random other spot in an active zone, or null if there is none. */
  private pickNextSpot(): CrateSpotDef | null {
    const options = this.spots.filter(
      (s) => s.id !== this.crate.spot.id && (s.zone === undefined || this.zones.isActive(s.zone)),
    )
    return options[Math.floor(this.rng() * options.length)] ?? null
  }
}
