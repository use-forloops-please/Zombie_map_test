import type { HitZone, TargetKind } from './entities/hitboxes'
import type { WeaponId } from './weapons/definitions'

/** Every event systems can send each other, keyed by name. Payloads are plain data. */
export interface GameEvents {
  weaponFired: { weaponId: WeaponId }
  weaponSwitched: { weaponId: WeaponId }
  /** A shot hit level geometry (not a target). */
  shotImpact: { point: [number, number, number]; normal: [number, number, number] }
  targetHit: {
    targetKind: TargetKind
    zone: HitZone
    damage: number
    killed: boolean
    healthLeft: number
    cause: 'bullet' | 'melee' | 'splash'
  }
  /**
   * Where a bullet, swing or blast met a target, sent right after its `targetHit`.
   * For effects (blood, flesh sounds); `direction` is the unit vector the blow travelled.
   */
  targetStruck: {
    targetKind: TargetKind
    zone: HitZone
    killed: boolean
    cause: 'bullet' | 'melee' | 'splash'
    point: [number, number, number]
    direction: [number, number, number]
  }
  /** A zombie's blood should mark the world here (GoreSystem found the surface). */
  bloodSplat: { point: [number, number, number]; normal: [number, number, number]; size: number }
  reloadStarted: { weaponId: WeaponId }
  reloadFinished: { weaponId: WeaponId }
  /** The trigger was pulled with no ammo left at all. */
  dryFire: { weaponId: WeaponId }
  /** A purchase was refused for lack of points. */
  purchaseDenied: { cost: number }
  meleeSwung: Record<string, never>
  roundStarted: { round: number; zombies: number }
  roundEnded: { round: number }
  doorOpened: { doorId: string; zones: [string, string]; cost: number }
  zoneActivated: { zoneId: string }
  /** The navmesh was rebuilt; every polygon ref from before is invalid. */
  navmeshRebuilt: Record<string, never>
  weaponPurchased: { weaponId: WeaponId; cost: number }
  ammoPurchased: { weaponId: WeaponId; cost: number }
  /** A projectile weapon fired (ProjectileSystem launches it). */
  projectileFired: {
    weaponId: WeaponId
    origin: [number, number, number]
    direction: [number, number, number]
  }
  explosion: { point: [number, number, number]; radius: number; color: string }
  crateSpun: { cost: number }
  crateOffered: { weaponId: WeaponId }
  crateTaken: { weaponId: WeaponId }
  crateRelocating: { fromSpot: string; toSpot: string }
  gameOver: { round: number; kills: number; headshots: number; points: number }
  /** A zombie's swing connected with the player. */
  playerHit: { damage: number }
  playerHealthChanged: { health: number; max: number }
  /** Health reached zero. */
  playerDowned: Record<string, never>
  boardTorn: { windowId: string; boards: number }
  boardRepaired: { windowId: string; boards: number }
  pointsChanged: { points: number; delta: number }
}

type Handler<T> = (payload: T) => void

/** Minimal typed pub/sub. Handlers run synchronously in subscription order. */
export class EventBus<E extends object> {
  private readonly handlers: { [K in keyof E]?: Handler<E[K]>[] } = {}

  /** Subscribes to `type`. Returns an unsubscribe function. */
  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const list = (this.handlers[type] ??= [])
    list.push(fn)
    return () => {
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.handlers[type]
    if (!list) return
    for (const fn of list) fn(payload)
  }
}

export type GameEventBus = EventBus<GameEvents>
