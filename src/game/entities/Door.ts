import type RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { Physics } from '../../engine/Physics'
import type { DoorDef } from '../../maps/schema'

/** A buyable blocker between two zones. Solid (to players and bullets) until opened. */
export class Door {
  readonly id: string
  readonly def: DoorDef
  readonly center: THREE.Vector3
  open = false
  /** Seconds since the door was opened; drives the sink-away animation. */
  openTime = 0
  private collider: RAPIER.Collider | null

  constructor(def: DoorDef, physics: Physics) {
    this.id = def.id
    this.def = def
    this.center = new THREE.Vector3(...def.pos)
    const [sx, sy, sz] = def.size
    this.collider = physics.addStaticBox(def.pos, [sx / 2, sy / 2, sz / 2])
  }

  get cost(): number {
    return this.def.cost
  }

  /** Marks the door open and removes its collider. */
  openNow(physics: Physics): void {
    this.open = true
    this.removeCollider(physics)
  }

  dispose(physics: Physics): void {
    this.removeCollider(physics)
  }

  private removeCollider(physics: Physics): void {
    if (!this.collider) return
    physics.world.removeCollider(this.collider, false)
    this.collider = null
  }
}
