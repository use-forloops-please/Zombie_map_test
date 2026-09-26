import * as THREE from 'three'
import { CollisionGroup, createRayHit, interactionGroups, type Physics } from '../../engine/Physics'
import type { Rng } from '../../engine/rng'
import type { EffectsTuning } from '../config/balance'
import type { GameEventBus } from '../events'

/** Blood only lands on level geometry. */
const SURFACE_GROUPS = interactionGroups(CollisionGroup.SHOT, CollisionGroup.WORLD)
const DOWN = new THREE.Vector3(0, -1, 0)
/** How far below a hit to look for the floor when a zombie dies. */
const FLOOR_SEARCH = 3

/**
 * Decides where zombie blood marks the world: the wall or floor behind a hit (by chance),
 * and a pool on the floor under a kill. Emits `bloodSplat` for the renderer; purely
 * cosmetic, so it has its own RNG and never affects the simulation.
 */
export class GoreSystem {
  private readonly physics: Physics
  private readonly events: GameEventBus
  private readonly rng: Rng
  private readonly t: EffectsTuning
  private readonly unsubscribe: () => void

  private readonly from = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly hit = createRayHit()

  constructor(physics: Physics, events: GameEventBus, rng: Rng, tuning: EffectsTuning) {
    this.physics = physics
    this.events = events
    this.rng = rng
    this.t = tuning
    this.unsubscribe = events.on('targetStruck', (e) => {
      if (e.targetKind !== 'zombie') return
      this.from.set(...e.point)
      if (e.cause !== 'splash' && this.rng() < this.t.bloodSplatChance) {
        this.dir.set(...e.direction).normalize()
        this.splat(this.dir, this.t.bloodReach, this.t.bloodSplatSize)
      }
      if (e.killed) {
        this.from.set(...e.point)
        this.splat(DOWN, FLOOR_SEARCH, this.t.bloodPoolSize)
      }
    })
  }

  dispose(): void {
    this.unsubscribe()
  }

  /** Casts from `from` along `dir`; if it meets level geometry, marks it. */
  private splat(dir: THREE.Vector3, reach: number, size: readonly [number, number]): void {
    if (!this.physics.castRay(this.from, dir, reach, SURFACE_GROUPS, this.hit)) return
    const { point, normal } = this.hit
    const [min, max] = size
    this.events.emit('bloodSplat', {
      point: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
      size: min + this.rng() * (max - min),
    })
  }
}
