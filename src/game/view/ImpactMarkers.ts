import * as THREE from 'three'

const MARK_SIZE = 0.06
/** Lift off the surface to avoid z-fighting. */
const SURFACE_OFFSET = 0.004
const FORWARD = new THREE.Vector3(0, 0, 1)

/**
 * Bullet marks on level geometry: a fixed-size ring buffer in one InstancedMesh,
 * so any number of shots costs one draw call and no allocation.
 */
export class ImpactMarkers {
  readonly mesh: THREE.InstancedMesh
  private readonly capacity: number
  private next = 0

  private readonly pos = new THREE.Vector3()
  private readonly normal = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3(1, 1, 1)
  private readonly matrix = new THREE.Matrix4()

  constructor(capacity = 64) {
    this.capacity = capacity
    const geo = new THREE.CircleGeometry(MARK_SIZE / 2, 8)
    const mat = new THREE.MeshBasicMaterial({
      color: '#0a0a0a',
      transparent: true,
      opacity: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }

  spawn(point: readonly [number, number, number], normal: readonly [number, number, number]): void {
    this.normal.set(...normal).normalize()
    this.pos.set(...point).addScaledVector(this.normal, SURFACE_OFFSET)
    this.quat.setFromUnitVectors(FORWARD, this.normal)
    this.matrix.compose(this.pos, this.quat, this.scale)
    this.mesh.setMatrixAt(this.next, this.matrix)
    this.mesh.instanceMatrix.needsUpdate = true
    this.next = (this.next + 1) % this.capacity
    this.mesh.count = Math.min(this.mesh.count + 1, this.capacity)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
