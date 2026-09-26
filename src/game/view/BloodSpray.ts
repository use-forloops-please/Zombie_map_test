import * as THREE from 'three'

const GRAVITY = 9.8
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

interface Droplet {
  readonly position: THREE.Vector3
  readonly velocity: THREE.Vector3
  life: number
  size: number
}

/**
 * Droplets that burst from a hit, mostly along the shot, and fall under gravity.
 * Fixed pool in one InstancedMesh; a new burst reuses the oldest droplets.
 */
export class BloodSpray {
  readonly mesh: THREE.InstancedMesh
  private readonly droplets: Droplet[] = []
  private next = 0

  private readonly dir = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly matrix = new THREE.Matrix4()

  constructor(capacity = 192) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: '#6e0b0d' }),
      capacity,
    )
    this.mesh.frustumCulled = false
    for (let i = 0; i < capacity; i++) {
      this.droplets.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        size: 0,
      })
      this.mesh.setMatrixAt(i, HIDDEN)
    }
  }

  /** Sprays `count` droplets from `point`, biased along `direction` (the blow's travel). */
  burst(
    point: readonly [number, number, number],
    direction: readonly [number, number, number],
    count: number,
  ): void {
    this.dir.set(...direction).normalize()
    for (let i = 0; i < count; i++) {
      const d = this.droplets[this.next]
      this.next = (this.next + 1) % this.droplets.length
      if (!d) continue
      const speed = 1.5 + Math.random() * 3
      d.position.set(...point)
      d.velocity
        .set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5)
        .multiplyScalar(2.2)
        .addScaledVector(this.dir, speed)
      d.life = 0.35 + Math.random() * 0.35
      d.size = 0.012 + Math.random() * 0.02
    }
  }

  update(frameDt: number): void {
    this.droplets.forEach((d, i) => {
      if (d.life <= 0) return
      d.life -= frameDt
      if (d.life <= 0) {
        this.mesh.setMatrixAt(i, HIDDEN)
        return
      }
      d.velocity.y -= GRAVITY * frameDt
      d.position.addScaledVector(d.velocity, frameDt)
      this.scale.setScalar(d.size * Math.min(d.life * 6, 1))
      this.matrix.compose(d.position, this.quat, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
