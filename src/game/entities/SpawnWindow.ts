import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { ALL_GROUPS, CollisionGroup, interactionGroups, type Physics } from '../../engine/Physics'
import type { WindowDef } from '../../maps/schema'
import type { Zombie } from './Zombie'

/** Stops the player climbing out; zombies (which don't use physics) and bullets pass. */
const BLOCKER_GROUPS = interactionGroups(CollisionGroup.CHARACTER_BLOCKER, ALL_GROUPS)

/**
 * Navmesh points a window needs, resolved by the map loader. Points only (no polygon refs),
 * since refs change whenever the navmesh is rebuilt.
 */
export interface WindowAnchors {
  /** Where zombies stand outside while tearing boards. */
  outsideStand: THREE.Vector3
  /** Where zombies land inside after climbing through. */
  insideLand: THREE.Vector3
  /** Navmesh point nearest the def's `outsideSpawn`. */
  spawnPoint: THREE.Vector3
}

/**
 * A boarded window: the only way zombies get inside. Tracks its boards and which zombie
 * (if any) is currently climbing through. Board changes go through BarricadeSystem.
 */
export class SpawnWindow {
  readonly id: string
  readonly zone: string
  readonly def: WindowDef
  readonly maxBoards: number
  boards: number
  /** Centre of the opening. */
  readonly center: THREE.Vector3
  /** Unit vector from inside to outside (horizontal). */
  readonly outward: THREE.Vector3
  readonly anchors: WindowAnchors
  /** The zombie currently climbing through; others wait their turn. */
  climber: Zombie | null = null

  private readonly collider: RAPIER.Collider

  constructor(def: WindowDef, anchors: WindowAnchors, physics: Physics) {
    this.id = def.id
    this.zone = def.zone
    this.def = def
    this.maxBoards = def.boards
    this.boards = def.boards
    this.center = new THREE.Vector3(...def.pos)
    const yaw = THREE.MathUtils.degToRad(def.yaw)
    this.outward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    this.anchors = anchors

    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(def.width / 2, def.height / 2, 0.1)
        .setTranslation(...def.pos)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setCollisionGroups(BLOCKER_GROUPS),
    )
  }

  get yawRad(): number {
    return THREE.MathUtils.degToRad(this.def.yaw)
  }

  /** Removes one board. Returns false if there were none left. */
  removeBoard(): boolean {
    if (this.boards === 0) return false
    this.boards--
    return true
  }

  /** Adds one board. Returns false if already fully boarded. */
  addBoard(): boolean {
    if (this.boards >= this.maxBoards) return false
    this.boards++
    return true
  }

  /** Lets `zombie` start climbing if the window is open and free. */
  tryClaim(zombie: Zombie): boolean {
    if (this.boards > 0 || (this.climber && this.climber !== zombie)) return false
    this.climber = zombie
    return true
  }

  release(zombie: Zombie): void {
    if (this.climber === zombie) this.climber = null
  }

  dispose(physics: Physics): void {
    physics.world.removeCollider(this.collider, false)
  }
}
