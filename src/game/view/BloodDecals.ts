import * as THREE from 'three'
import { createBloodTexture } from './textures'

/** Lift off the surface to avoid z-fighting. */
const SURFACE_OFFSET = 0.006
const FORWARD = new THREE.Vector3(0, 0, 1)

/**
 * Blood splats on walls and floors: a fixed ring buffer in one InstancedMesh (the oldest
 * splat is reused when it's full), so a whole game of gore is one draw call and no
 * allocation. Each splat gets a random spin so repeats don't look stamped.
 */
export class BloodDecals {
  readonly mesh: THREE.InstancedMesh
  private readonly capacity: number
  private next = 0

  private readonly pos = new THREE.Vector3()
  private readonly normal = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly spin = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly matrix = new THREE.Matrix4()

  constructor(capacity = 128) {
    this.capacity = capacity
    const material = new THREE.MeshStandardMaterial({
      map: createBloodTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 0.35,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.receiveShadow = true
  }

  spawn(
    point: readonly [number, number, number],
    normal: readonly [number, number, number],
    size: number,
  ): void {
    this.normal.set(...normal).normalize()
    this.pos.set(...point).addScaledVector(this.normal, SURFACE_OFFSET)
    this.spin.setFromAxisAngle(FORWARD, Math.random() * Math.PI * 2)
    this.quat.setFromUnitVectors(FORWARD, this.normal).multiply(this.spin)
    this.scale.set(size, size, 1)
    this.matrix.compose(this.pos, this.quat, this.scale)
    this.mesh.setMatrixAt(this.next, this.matrix)
    this.mesh.instanceMatrix.needsUpdate = true
    this.next = (this.next + 1) % this.capacity
    this.mesh.count = Math.min(this.mesh.count + 1, this.capacity)
  }

  dispose(): void {
    const material = this.mesh.material as THREE.MeshStandardMaterial
    material.map?.dispose()
    material.dispose()
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}
