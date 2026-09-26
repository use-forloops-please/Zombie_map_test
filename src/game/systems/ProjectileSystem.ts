import * as THREE from 'three'
import { CollisionGroup, createRayHit, interactionGroups, type Physics } from '../../engine/Physics'
import type { Damageable, HitboxEntry, HitboxRegistry } from '../entities/hitboxes'
import type { GameEventBus } from '../events'
import { weaponDefs, type WeaponDef } from '../weapons/definitions'
import type { DamageCause } from './WeaponSystem'

/** Projectiles collide with level geometry and hitboxes, like bullets. */
const PROJECTILE_GROUPS = interactionGroups(
  CollisionGroup.SHOT,
  CollisionGroup.WORLD | CollisionGroup.HITBOX,
)
/** Splash finds targets by their hitboxes. */
const SPLASH_GROUPS = interactionGroups(CollisionGroup.SHOT, CollisionGroup.HITBOX)
/** Walls between a blast and a target shield it. */
const COVER_GROUPS = interactionGroups(CollisionGroup.SHOT, CollisionGroup.WORLD)
/** Explosions sit this far off the surface they hit. */
const SURFACE_OFFSET = 0.05

export const PROJECTILE_POOL_SIZE = 16

export interface Projectile {
  active: boolean
  def: WeaponDef | null
  readonly position: THREE.Vector3
  readonly prevPosition: THREE.Vector3
  readonly velocity: THREE.Vector3
  age: number
}

type DealDamage = (entry: HitboxEntry, damage: number, cause: DamageCause) => void

/**
 * Travelling projectiles for weapons with a `projectile` block. Each step sweeps a ray
 * along the projectile's path (so fast shots can't tunnel through thin walls); on impact
 * or at the end of its lifetime it explodes, hitting every target within the splash
 * radius once, unless a wall is between the blast and that target. Pooled: no allocation per shot.
 */
export class ProjectileSystem {
  readonly projectiles: readonly Projectile[]
  private readonly physics: Physics
  private readonly hitboxes: HitboxRegistry
  private readonly events: GameEventBus
  private readonly dealDamage: DealDamage
  private readonly unsubscribe: () => void

  private readonly hit = createRayHit()
  private readonly dir = new THREE.Vector3()
  private readonly blast = new THREE.Vector3()
  private readonly struck = new Set<Damageable>()
  private readonly targets: HitboxEntry[] = []
  /** Centre of the struck hitbox for each entry in `targets` (grown as needed, reused). */
  private readonly targetPoints: THREE.Vector3[] = []
  private readonly cover = createRayHit()
  private readonly toTarget = new THREE.Vector3()

  constructor(
    physics: Physics,
    hitboxes: HitboxRegistry,
    events: GameEventBus,
    dealDamage: DealDamage,
  ) {
    this.physics = physics
    this.hitboxes = hitboxes
    this.events = events
    this.dealDamage = dealDamage
    this.projectiles = Array.from({ length: PROJECTILE_POOL_SIZE }, () => ({
      active: false,
      def: null,
      position: new THREE.Vector3(),
      prevPosition: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: 0,
    }))
    this.unsubscribe = events.on('projectileFired', (e) => {
      this.launch(weaponDefs[e.weaponId], e.origin, e.direction)
    })
  }

  /** Starts a projectile. If the pool is exhausted the oldest one detonates early to make room. */
  launch(
    def: WeaponDef,
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
  ): void {
    if (!def.projectile) return
    let p = this.projectiles.find((q) => !q.active)
    if (!p) {
      p = this.projectiles.reduce((a, b) => (a.age >= b.age ? a : b))
      this.explode(p, p.position)
    }
    p.active = true
    p.def = def
    p.age = 0
    p.position.set(...origin)
    p.prevPosition.copy(p.position)
    p.velocity
      .set(...direction)
      .normalize()
      .multiplyScalar(def.projectile.speed)
  }

  update(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.active || !p.def?.projectile) continue
      p.prevPosition.copy(p.position)
      p.age += dt
      const step = p.velocity.length() * dt
      this.dir.copy(p.velocity).normalize()
      if (this.physics.castRay(p.position, this.dir, step, PROJECTILE_GROUPS, this.hit)) {
        const { point, normal } = this.hit
        this.blast.set(point.x, point.y, point.z)
        // Back off the surface (for walls); a hitbox has no meaningful normal to use.
        if (!this.hitboxes.get(this.hit.colliderHandle)) {
          this.blast.x += normal.x * SURFACE_OFFSET
          this.blast.y += normal.y * SURFACE_OFFSET
          this.blast.z += normal.z * SURFACE_OFFSET
        }
        this.explode(p, this.blast)
        continue
      }
      p.position.addScaledVector(p.velocity, dt)
      if (p.age >= p.def.projectile.lifetime) this.explode(p, p.position)
    }
  }

  dispose(): void {
    this.unsubscribe()
  }

  /** True if level geometry stands between the blast and `target`. */
  private shielded(at: THREE.Vector3, target: { x: number; y: number; z: number }): boolean {
    this.toTarget.set(target.x - at.x, target.y - at.y, target.z - at.z)
    const dist = this.toTarget.length()
    if (dist < 1e-3) return false
    this.toTarget.divideScalar(dist)
    return this.physics.castRay(at, this.toTarget, dist, COVER_GROUPS, this.cover)
  }

  private explode(p: Projectile, at: THREE.Vector3): void {
    const spec = p.def?.projectile
    p.active = false
    if (!spec) return
    p.position.copy(at)
    this.struck.clear()
    this.targets.length = 0
    // Collect first, damage after: killing a target disables its colliders, which must
    // not happen while Rapier is still iterating the query.
    this.physics.overlapBall(at, spec.splashRadius, SPLASH_GROUPS, (collider) => {
      const entry = this.hitboxes.get(collider.handle)
      if (!entry || !entry.owner.alive || this.struck.has(entry.owner)) return
      const centre = collider.translation()
      if (this.shielded(at, centre)) return
      this.struck.add(entry.owner)
      const i = this.targets.push(entry) - 1
      const point = (this.targetPoints[i] ??= new THREE.Vector3())
      point.set(centre.x, centre.y, centre.z)
    })
    this.targets.forEach((entry, i) => {
      // Splash is a body blow wherever it lands (for points and stats).
      this.dealDamage({ ...entry, zone: 'torso' }, spec.splashDamage, 'splash')
      const point = this.targetPoints[i]
      if (!point) return
      this.toTarget.subVectors(point, at).normalize()
      this.events.emit('targetStruck', {
        targetKind: entry.owner.kind,
        zone: 'torso',
        killed: !entry.owner.alive,
        cause: 'splash',
        point: [point.x, point.y, point.z],
        direction: [this.toTarget.x, this.toTarget.y, this.toTarget.z],
      })
    })
    this.events.emit('explosion', {
      point: [at.x, at.y, at.z],
      radius: spec.splashRadius,
      color: spec.color,
    })
  }
}
