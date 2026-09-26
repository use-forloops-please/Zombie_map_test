import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { ALL_GROUPS, CollisionGroup, interactionGroups, type Physics } from '../../engine/Physics'
import type { ZombieTuning } from '../config/balance'
import { zombieHitboxes, type Damageable, type HitboxRegistry } from './hitboxes'
import type { SpawnWindow } from './SpawnWindow'

export type ZombieState =
  | 'inactive'
  | 'spawning'
  | 'approachWindow'
  | 'tearingBoards'
  | 'entering'
  | 'chasing'
  | 'attacking'
  | 'dead'

/** Longest straight path (in corners) a zombie keeps. */
export const MAX_PATH_POINTS = 32

const HITBOX_GROUPS = interactionGroups(CollisionGroup.HITBOX, CollisionGroup.SHOT)
const BLOCKER_GROUPS = interactionGroups(CollisionGroup.CHARACTER_BLOCKER, ALL_GROUPS)
/** Where pooled zombies wait while inactive. */
const PARKED = { x: 0, y: -1000, z: 0 }
const FLASH_TIME = 0.1

/**
 * One pooled zombie. Holds simulation state and its physics body (hitbox sensors plus a
 * capsule that blocks the player). Behaviour lives in ZombieAISystem; visuals in ZombieRenderer.
 */
export class Zombie implements Damageable {
  readonly kind = 'zombie'
  readonly index: number

  state: ZombieState = 'inactive'
  health = 0
  /** Movement speed for this zombie's life (walker or runner). */
  speed = 0

  /** Feet position after the latest step / before it (for render interpolation). */
  readonly position = new THREE.Vector3()
  readonly prevPosition = new THREE.Vector3()
  /** Radians about +Y; 0 faces -Z. */
  yaw = 0
  prevYaw = 0
  /** Navmesh polygon the zombie is standing on. */
  polyRef = 0

  readonly path: THREE.Vector3[] = Array.from(
    { length: MAX_PATH_POINTS },
    () => new THREE.Vector3(),
  )
  pathLength = 0
  pathIndex = 0
  repathTimer = 0

  /** Counts down the current state's timed phase (rise, swing, recovery, corpse). */
  stateTimer = 0
  swingLanded = false
  /** The window this zombie is headed for / tearing at / climbing through; null once inside. */
  entryWindow: SpawnWindow | null = null
  /** Where the climb through the window started. */
  readonly climbFrom = new THREE.Vector3()
  /** > 0 while the hit flash is showing. */
  flashTimer = 0

  private readonly tuning: ZombieTuning
  private readonly body: RAPIER.RigidBody
  private readonly colliders: RAPIER.Collider[] = []

  constructor(index: number, physics: Physics, registry: HitboxRegistry, tuning: ZombieTuning) {
    this.index = index
    this.tuning = tuning
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(PARKED.x, PARKED.y, PARKED.z),
    )

    zombieHitboxes.forEach((part, i) => {
      const shape = part.shape
      const desc =
        shape.kind === 'ball'
          ? RAPIER.ColliderDesc.ball(shape.radius)
          : RAPIER.ColliderDesc.cuboid(...shape.half)
      desc
        .setTranslation(...part.offset)
        .setSensor(true)
        .setCollisionGroups(HITBOX_GROUPS)
      const collider = physics.world.createCollider(desc, this.body)
      registry.register(collider.handle, { owner: this, zone: part.zone, partIndex: i })
      this.colliders.push(collider)
    })

    const blockerHalfHeight = 0.9 - tuning.radius
    this.colliders.push(
      physics.world.createCollider(
        RAPIER.ColliderDesc.capsule(blockerHalfHeight, tuning.radius)
          .setTranslation(0, 0.9, 0)
          .setCollisionGroups(BLOCKER_GROUPS),
        this.body,
      ),
    )
    this.setCollidersEnabled(false)
  }

  get alive(): boolean {
    return this.state !== 'inactive' && this.state !== 'dead'
  }

  get active(): boolean {
    return this.state !== 'inactive'
  }

  /** Takes the zombie from the pool. With `entryWindow` it must get in through that window first. */
  activate(
    feet: THREE.Vector3,
    polyRef: number,
    yaw: number,
    health: number,
    speed: number,
    entryWindow: SpawnWindow | null = null,
  ): void {
    this.entryWindow = entryWindow
    this.state = 'spawning'
    this.stateTimer = this.tuning.spawnRiseTime
    this.health = health
    this.speed = speed
    this.position.copy(feet)
    this.prevPosition.copy(feet)
    this.yaw = yaw
    this.prevYaw = yaw
    this.polyRef = polyRef
    this.pathLength = 0
    this.pathIndex = 0
    this.repathTimer = 0
    this.flashTimer = 0
    this.swingLanded = false
    this.body.setTranslation(feet, true)
    this.body.setRotation(yawQuat(yaw), true)
    this.setCollidersEnabled(true)
  }

  applyDamage(amount: number): boolean {
    if (!this.alive) return false
    this.health = Math.max(this.health - amount, 0)
    this.flashTimer = FLASH_TIME
    if (this.health > 0) return false
    this.state = 'dead'
    // Free the window if we died mid-climb, so the next zombie can use it.
    this.entryWindow?.release(this)
    this.entryWindow = null
    this.stateTimer = this.tuning.corpseTime
    // Corpses don't block the player or soak up bullets.
    this.setCollidersEnabled(false)
    return true
  }

  /** Returns the zombie to the pool. */
  deactivate(): void {
    this.entryWindow?.release(this)
    this.entryWindow = null
    this.state = 'inactive'
    this.setCollidersEnabled(false)
    this.body.setTranslation(PARKED, false)
  }

  /** Moves the physics body to the zombie's current position and facing for the next step. */
  syncBody(): void {
    this.body.setNextKinematicTranslation(this.position)
    this.body.setNextKinematicRotation(yawQuat(this.yaw))
  }

  dispose(physics: Physics, registry: HitboxRegistry): void {
    for (const c of this.colliders) registry.unregister(c.handle)
    physics.world.removeRigidBody(this.body)
  }

  private setCollidersEnabled(enabled: boolean): void {
    for (const c of this.colliders) c.setEnabled(enabled)
  }
}

const quat = { x: 0, y: 0, z: 0, w: 1 }
function yawQuat(yaw: number): typeof quat {
  quat.y = Math.sin(yaw / 2)
  quat.w = Math.cos(yaw / 2)
  return quat
}
