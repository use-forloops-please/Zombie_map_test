import * as THREE from 'three'
import type { Projectile } from '../systems/ProjectileSystem'

const BLAST_POOL = 8
/** Seconds an explosion flash lasts. */
const BLAST_TIME = 0.45
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

interface Blast {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  age: number
  radius: number
}

/**
 * Energy projectiles as glowing orbs (one InstancedMesh, interpolated between steps) and
 * explosions as pooled expanding, fading spheres. Additive blending, no extra lights.
 */
export class ProjectileRenderer {
  readonly group = new THREE.Group()
  private readonly projectiles: readonly Projectile[]
  private readonly orbs: THREE.InstancedMesh
  private readonly blasts: Blast[] = []
  private readonly blastGeometry = new THREE.SphereGeometry(1, 20, 14)
  private nextBlast = 0
  private readonly pos = new THREE.Vector3()
  private readonly matrix = new THREE.Matrix4()

  constructor(projectiles: readonly Projectile[]) {
    this.projectiles = projectiles
    this.orbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshBasicMaterial({
        color: '#b8f4ff',
        blending: THREE.AdditiveBlending,
        transparent: true,
      }),
      projectiles.length,
    )
    this.orbs.frustumCulled = false
    this.group.add(this.orbs)

    for (let i = 0; i < BLAST_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(this.blastGeometry, material)
      mesh.visible = false
      this.group.add(mesh)
      this.blasts.push({ mesh, material, age: BLAST_TIME, radius: 1 })
    }
  }

  /** Starts an explosion flash. */
  explode(point: readonly [number, number, number], radius: number, color: string): void {
    const blast = this.blasts[this.nextBlast]
    this.nextBlast = (this.nextBlast + 1) % this.blasts.length
    if (!blast) return
    blast.age = 0
    blast.radius = radius
    blast.mesh.position.set(...point)
    blast.material.color.set(color)
    blast.mesh.visible = true
  }

  update(alpha: number, frameDt: number): void {
    this.projectiles.forEach((p, i) => {
      if (!p.active) {
        this.orbs.setMatrixAt(i, HIDDEN)
        return
      }
      this.pos.lerpVectors(p.prevPosition, p.position, alpha)
      this.orbs.setMatrixAt(i, this.matrix.makeTranslation(this.pos.x, this.pos.y, this.pos.z))
    })
    this.orbs.instanceMatrix.needsUpdate = true

    for (const b of this.blasts) {
      if (!b.mesh.visible) continue
      b.age += frameDt
      const t = b.age / BLAST_TIME
      if (t >= 1) {
        b.mesh.visible = false
        continue
      }
      b.mesh.scale.setScalar(b.radius * (0.3 + 0.7 * Math.sqrt(t)))
      b.material.opacity = 0.7 * (1 - t)
    }
  }

  dispose(): void {
    this.orbs.geometry.dispose()
    ;(this.orbs.material as THREE.Material).dispose()
    this.orbs.dispose()
    this.blastGeometry.dispose()
    for (const b of this.blasts) b.material.dispose()
  }
}
