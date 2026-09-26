import type { Physics } from '../../engine/Physics'
import type { Navigation } from '../../maps/navmesh'
import { doorAsBrush, type BrushDef } from '../../maps/schema'
import type { NavmeshTuning, PurchaseTuning } from '../config/balance'
import type { Door } from '../entities/Door'
import type { ZoneState } from '../entities/Zones'
import type { GameEventBus } from '../events'
import { oncePerPress, type Interactable } from './InteractSystem'
import type { PointsSystem } from './PointsSystem'

/**
 * Buyable doors. Opening one spends points, removes its collider, rebuilds the navmesh
 * without it (so zombies path through) and activates the zones it connects, which turns
 * on their spawn windows.
 */
export class DoorSystem {
  readonly doors: readonly Door[]
  private readonly zones: ZoneState
  private readonly nav: Navigation
  private readonly brushes: readonly BrushDef[]
  private readonly physics: Physics
  private readonly points: PointsSystem
  private readonly events: GameEventBus
  private readonly navTuning: NavmeshTuning
  private readonly t: PurchaseTuning

  constructor(
    doors: readonly Door[],
    zones: ZoneState,
    nav: Navigation,
    brushes: readonly BrushDef[],
    physics: Physics,
    points: PointsSystem,
    events: GameEventBus,
    navTuning: NavmeshTuning,
    tuning: PurchaseTuning,
  ) {
    this.doors = doors
    this.zones = zones
    this.nav = nav
    this.brushes = brushes
    this.physics = physics
    this.points = points
    this.events = events
    this.navTuning = navTuning
    this.t = tuning
  }

  update(dt: number): void {
    for (const d of this.doors) if (d.open) d.openTime += dt
  }

  /** Buys and opens `door`. Returns false if it's already open or unaffordable. */
  tryOpen(door: Door): boolean {
    if (door.open || !this.points.spend(door.cost)) return false
    door.openNow(this.physics)

    const closed = this.doors.filter((d) => !d.open).map((d) => doorAsBrush(d.def))
    this.nav.rebuild([...this.brushes, ...closed], this.navTuning)
    this.events.emit('navmeshRebuilt', {})

    for (const zoneId of door.def.connects) {
      if (this.zones.activate(zoneId)) this.events.emit('zoneActivated', { zoneId })
    }
    this.events.emit('doorOpened', {
      doorId: door.id,
      zones: door.def.connects,
      cost: door.cost,
    })
    return true
  }

  createInteractables(): Interactable[] {
    return this.doors.map((door) => {
      const [sx, , sz] = door.def.size
      const cost = door.cost.toLocaleString('en-US')
      return {
        position: door.center,
        range: Math.max(sx, sz) / 2 + this.t.doorInteractMargin,
        prompt: () => {
          if (door.open) return null
          return this.points.canAfford(door.cost)
            ? `Hold F to open [${cost}]`
            : `Open [${cost}] — not enough points`
        },
        ...oncePerPress(() => this.tryOpen(door)),
      }
    })
  }
}
