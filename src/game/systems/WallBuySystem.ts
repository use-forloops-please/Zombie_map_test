import * as THREE from 'three'
import type { PurchaseTuning } from '../config/balance'
import type { WallBuy } from '../entities/WallBuy'
import type { GameEventBus } from '../events'
import { weaponDefs } from '../weapons/definitions'
import { oncePerPress, type Interactable } from './InteractSystem'
import type { PointsSystem } from './PointsSystem'
import type { WeaponSystem } from './WeaponSystem'

const fmt = (n: number) => n.toLocaleString('en-US')

/**
 * Wall-buys: buy a weapon you don't own, or refill ammo for one you do (at the lower
 * ammo price).
 */
export class WallBuySystem {
  readonly wallBuys: readonly WallBuy[]
  private readonly weapons: WeaponSystem
  private readonly points: PointsSystem
  private readonly events: GameEventBus
  private readonly t: PurchaseTuning

  constructor(
    wallBuys: readonly WallBuy[],
    weapons: WeaponSystem,
    points: PointsSystem,
    events: GameEventBus,
    tuning: PurchaseTuning,
  ) {
    this.wallBuys = wallBuys
    this.weapons = weapons
    this.points = points
    this.events = events
    this.t = tuning
  }

  /** What the player would get here right now, or null if there's nothing to buy. */
  prompt(wb: WallBuy): string | null {
    const name = weaponDefs[wb.weapon].name
    if (this.weapons.owns(wb.weapon)) {
      if (this.weapons.ammoFull(wb.weapon)) return null
      return this.points.canAfford(wb.ammoCost)
        ? `Hold F to buy ${name} ammo [${fmt(wb.ammoCost)}]`
        : `${name} ammo [${fmt(wb.ammoCost)}] — not enough points`
    }
    return this.points.canAfford(wb.cost)
      ? `Hold F to buy ${name} [${fmt(wb.cost)}]`
      : `${name} [${fmt(wb.cost)}] — not enough points`
  }

  /** Buys the weapon or its ammo. Returns false if nothing was bought. */
  use(wb: WallBuy): boolean {
    if (this.weapons.owns(wb.weapon)) {
      if (this.weapons.ammoFull(wb.weapon) || !this.points.spend(wb.ammoCost)) return false
      this.weapons.refillAmmo(wb.weapon)
      this.events.emit('ammoPurchased', { weaponId: wb.weapon, cost: wb.ammoCost })
      return true
    }
    if (!this.points.spend(wb.cost)) return false
    this.weapons.giveWeapon(wb.weapon)
    this.events.emit('weaponPurchased', { weaponId: wb.weapon, cost: wb.cost })
    return true
  }

  createInteractables(): Interactable[] {
    return this.wallBuys.map((wb) => ({
      // Stand in front of the sign.
      position: new THREE.Vector3().copy(wb.position).addScaledVector(wb.facing, 0.6),
      range: this.t.wallBuyRange,
      prompt: () => this.prompt(wb),
      ...oncePerPress(() => this.use(wb)),
    }))
  }
}
