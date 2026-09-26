import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import {
  ALL_GROUPS,
  CollisionGroup,
  interactionGroups,
  type Physics,
  type Vec3Tuple,
} from '../../engine/Physics'
import type { balance } from '../config/balance'
import { humanoidHitboxes, type Damageable, type HitboxRegistry, type HitZone } from './hitboxes'

type DummyTuning = typeof balance.targetDummy

const ZONE_COLORS: Record<HitZone, string> = {
  head: '#d9a441',
  neck: '#d97941',
  torso: '#7f8a99',
  limb: '#5f6875',
}
const DEAD_COLOR = new THREE.Color('#5a1f1a')
const FLASH_TIME = 0.12

const HITBOX_GROUPS = interactionGroups(CollisionGroup.HITBOX, CollisionGroup.SHOT)
const BLOCKER_GROUPS = interactionGroups(CollisionGroup.CHARACTER_BLOCKER, ALL_GROUPS)

/**
 * A static humanoid target for testing weapons. Its visible parts match its hitboxes
 * exactly and are coloured by zone. The part that was hit flashes. A "killed" dummy
 * goes dark, then resets to full health.
 */
export class TargetDummy implements Damageable {
  readonly kind = 'dummy'
  health: number

  private readonly tuning: DummyTuning
  private readonly physics: Physics
  private readonly registry: HitboxRegistry
  private readonly group = new THREE.Group()
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly baseColors: THREE.Color[] = []
  private readonly flashTimers: number[] = []
  private readonly body: RAPIER.RigidBody
  private readonly hitboxHandles: number[] = []
  private resetTimer = 0

  constructor(
    pos: Vec3Tuple,
    yawRad: number,
    scene: THREE.Scene,
    physics: Physics,
    registry: HitboxRegistry,
    tuning: DummyTuning,
  ) {
    this.tuning = tuning
    this.physics = physics
    this.registry = registry
    this.health = tuning.health

    const [x, y, z] = pos
    const rotation = { x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) }
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(rotation),
    )

    humanoidHitboxes.forEach((part, i) => {
      const [ox, oy, oz] = part.offset
      const shape = part.shape
      const desc =
        shape.kind === 'ball'
          ? RAPIER.ColliderDesc.ball(shape.radius)
          : RAPIER.ColliderDesc.cuboid(...shape.half)
      desc.setTranslation(ox, oy, oz).setSensor(true).setCollisionGroups(HITBOX_GROUPS)
      const collider = physics.world.createCollider(desc, this.body)
      this.hitboxHandles.push(collider.handle)
      registry.register(collider.handle, { owner: this, zone: part.zone, partIndex: i })

      const geo =
        shape.kind === 'ball'
          ? new THREE.SphereGeometry(shape.radius, 16, 12)
          : new THREE.BoxGeometry(shape.half[0] * 2, shape.half[1] * 2, shape.half[2] * 2)
      const color = new THREE.Color(ZONE_COLORS[part.zone])
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(ox, oy, oz)
      mesh.castShadow = true
      this.group.add(mesh)
      this.materials.push(mat)
      this.baseColors.push(color.clone())
      this.flashTimers.push(0)
    })

    // Stops the player walking through the dummy without blocking shots.
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, 0.88, 0.15)
        .setTranslation(0, 0.88, 0)
        .setCollisionGroups(BLOCKER_GROUPS),
      this.body,
    )

    this.group.position.set(x, y, z)
    this.group.rotation.y = yawRad
    scene.add(this.group)
  }

  get alive(): boolean {
    return this.health > 0
  }

  applyDamage(amount: number, _zone: HitZone, partIndex: number): boolean {
    if (!this.alive) return false
    this.health = Math.max(this.health - amount, 0)
    this.flashTimers[partIndex] = FLASH_TIME
    if (this.health > 0) return false
    this.resetTimer = this.tuning.resetDelay
    return true
  }

  update(dt: number): void {
    if (!this.alive) {
      this.resetTimer -= dt
      if (this.resetTimer <= 0) this.health = this.tuning.health
    }
    this.materials.forEach((mat, i) => {
      const flash = (this.flashTimers[i] ?? 0) - dt
      this.flashTimers[i] = Math.max(flash, 0)
      if (!this.alive) mat.color.copy(DEAD_COLOR)
      else if (flash > 0) mat.color.setRGB(1, 1, 1)
      else mat.color.copy(this.baseColors[i] ?? DEAD_COLOR)
    })
  }

  dispose(scene: THREE.Scene): void {
    for (const handle of this.hitboxHandles) this.registry.unregister(handle)
    this.physics.world.removeRigidBody(this.body)
    scene.remove(this.group)
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose()
    })
    for (const m of this.materials) m.dispose()
  }
}
