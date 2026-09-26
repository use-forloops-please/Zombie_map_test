import * as THREE from 'three'
import type { ZombieTuning } from '../config/balance'
import type { Zombie } from '../entities/Zombie'

const BODY_COLOR = new THREE.Color('#4a4a3c')
const SKIN_COLOR = new THREE.Color('#7d8a63')
const FLASH_COLOR = new THREE.Color('#ffffff')
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

/** Capsule torso+legs from the feet to 1.5 m, matching the leg/torso/neck hitboxes. */
const BODY_RADIUS = 0.2
const BODY_LENGTH = 1.5 - BODY_RADIUS * 2

/**
 * Draws every pooled zombie with three InstancedMeshes (bodies, heads, arms), so the
 * whole horde costs three draw calls (plus shadows) regardless of how many are alive.
 * Placeholder capsule zombies until real models land.
 */
export class ZombieRenderer {
  readonly group = new THREE.Group()
  private readonly zombies: readonly Zombie[]
  private readonly tuning: ZombieTuning
  private readonly bodies: THREE.InstancedMesh
  private readonly heads: THREE.InstancedMesh
  private readonly arms: THREE.InstancedMesh
  private readonly meshes: readonly THREE.InstancedMesh[]

  // Part offsets relative to the zombie's feet, facing -Z.
  private readonly bodyLocal = new THREE.Matrix4().makeTranslation(0, 0.75, 0)
  private readonly headLocal = new THREE.Matrix4().makeTranslation(0, 1.63, 0)
  private readonly armLocal = [
    new THREE.Matrix4().makeTranslation(-0.25, 1.32, -0.24),
    new THREE.Matrix4().makeTranslation(0.25, 1.32, -0.24),
  ]

  // Scratch objects, reused every frame.
  private readonly root = new THREE.Matrix4()
  private readonly part = new THREE.Matrix4()
  private readonly pos = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly scale = new THREE.Vector3(1, 1, 1)
  private readonly color = new THREE.Color()

  constructor(zombies: readonly Zombie[], tuning: ZombieTuning) {
    this.zombies = zombies
    this.tuning = tuning
    const n = zombies.length
    const clothes = new THREE.MeshStandardMaterial({ roughness: 0.9 })
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.8 })

    this.bodies = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 10),
      clothes,
      n,
    )
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 12, 10), skin, n)
    this.arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.56), skin, n * 2)

    this.meshes = [this.bodies, this.heads, this.arms]
    for (const mesh of this.meshes) {
      mesh.castShadow = true
      mesh.frustumCulled = false
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, HIDDEN)
        mesh.setColorAt(i, mesh === this.bodies ? BODY_COLOR : SKIN_COLOR)
      }
      this.group.add(mesh)
    }
  }

  /** Poses every zombie, interpolated between the last two simulation steps. */
  update(alpha: number): void {
    for (const z of this.zombies) {
      if (!z.active) {
        this.hide(z.index)
        continue
      }
      this.pos.lerpVectors(z.prevPosition, z.position, alpha)
      const yaw = z.prevYaw + shortAngle(z.yaw - z.prevYaw) * alpha

      let tilt = 0
      if (z.state === 'spawning') {
        // Rise out of the ground.
        const t = Math.max(z.stateTimer, 0) / this.tuning.spawnRiseTime
        this.pos.y -= t * 1.6
      } else if (z.state === 'dead') {
        // Topple backwards, then sink.
        const t = 1 - Math.max(z.stateTimer, 0) / this.tuning.corpseTime
        tilt = Math.min(t * 3, 1) * (Math.PI / 2)
        this.pos.y -= Math.max(t - 0.6, 0) * 1.5
      } else if (z.state === 'attacking' && !z.swingLanded) {
        // Lean into the swing.
        tilt = -0.35 * (1 - z.stateTimer / this.tuning.attackWindup)
      }

      this.euler.set(tilt, yaw, 0)
      this.quat.setFromEuler(this.euler)
      this.root.compose(this.pos, this.quat, this.scale)

      this.bodies.setMatrixAt(z.index, this.part.multiplyMatrices(this.root, this.bodyLocal))
      this.heads.setMatrixAt(z.index, this.part.multiplyMatrices(this.root, this.headLocal))
      this.armLocal.forEach((local, side) =>
        this.arms.setMatrixAt(z.index * 2 + side, this.part.multiplyMatrices(this.root, local)),
      )

      const flash = z.flashTimer > 0
      this.bodies.setColorAt(z.index, flash ? FLASH_COLOR : BODY_COLOR)
      this.color.copy(flash ? FLASH_COLOR : SKIN_COLOR)
      this.heads.setColorAt(z.index, this.color)
      this.arms.setColorAt(z.index * 2, this.color)
      this.arms.setColorAt(z.index * 2 + 1, this.color)
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    }
  }

  private hide(i: number): void {
    this.bodies.setMatrixAt(i, HIDDEN)
    this.heads.setMatrixAt(i, HIDDEN)
    this.arms.setMatrixAt(i * 2, HIDDEN)
    this.arms.setMatrixAt(i * 2 + 1, HIDDEN)
  }
}

function shortAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}
