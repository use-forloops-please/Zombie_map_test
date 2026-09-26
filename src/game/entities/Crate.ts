import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { ALL_GROUPS, CollisionGroup, interactionGroups, type Physics } from '../../engine/Physics'
import { CRATE_SIZE, type CrateSpotDef } from '../../maps/schema'
import type { WeaponId } from '../weapons/definitions'

export type CrateState = 'idle' | 'cycling' | 'offering' | 'relocating'

const GROUPS = interactionGroups(CollisionGroup.WORLD, ALL_GROUPS)

/**
 * The supply crate: sits at one of the map's crate spots, solid like level geometry.
 * State only; CrateSystem runs it and CrateRenderer draws it.
 */
export class Crate {
  spot: CrateSpotDef
  state: CrateState = 'idle'
  /** Counts down the current timed state (cycle, offer, relocation). */
  stateTimer = 0
  /** Spins since the crate arrived at this spot. */
  spinsAtSpot = 0
  /** The weapon on offer (or about to be revealed); null on a relocating spin. */
  offer: WeaponId | null = null
  /** Where the crate is going when relocating. */
  nextSpot: CrateSpotDef | null = null
  /** Floor point under the crate's centre. */
  readonly position = new THREE.Vector3()
  /** Unit vector out of the crate's front. */
  readonly front = new THREE.Vector3()
  /** Where the player stands to use it (kept up to date for the interact system). */
  readonly usePoint = new THREE.Vector3()

  private readonly collider: RAPIER.Collider

  constructor(spot: CrateSpotDef, physics: Physics) {
    this.spot = spot
    const [w, h, d] = CRATE_SIZE
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setCollisionGroups(GROUPS),
    )
    this.place(spot)
  }

  get yaw(): number {
    return THREE.MathUtils.degToRad(this.spot.yaw)
  }

  /** Puts the crate (and its collider) at `spot`. */
  place(spot: CrateSpotDef): void {
    this.spot = spot
    const yaw = THREE.MathUtils.degToRad(spot.yaw)
    this.position.set(...spot.pos)
    this.front.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    this.usePoint.copy(this.position).addScaledVector(this.front, 0.8)
    this.collider.setTranslation({
      x: this.position.x,
      y: this.position.y + CRATE_SIZE[1] / 2,
      z: this.position.z,
    })
    this.collider.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
  }

  dispose(physics: Physics): void {
    physics.world.removeCollider(this.collider, false)
  }
}
