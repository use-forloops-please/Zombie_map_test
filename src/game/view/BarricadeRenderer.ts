import * as THREE from 'three'
import type { SpawnWindow } from '../entities/SpawnWindow'

/** Board thickness and how far outside the wall centre boards sit. */
const BOARD_DEPTH = 0.05
const BOARD_OFFSET = 0.2
/** Fraction of a board slot's height the plank fills. */
const BOARD_FILL = 0.75
/** How fast a board animates on or off (1 / seconds). */
const ANIM_SPEED = 5
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

interface BoardSlot {
  window: SpawnWindow
  index: number
  /** Resting transform in world space. */
  rest: THREE.Matrix4
  /** 0 = gone, 1 = nailed in place. Animates toward the window's current board count. */
  presence: number
}

/**
 * All window boards in one InstancedMesh. Boards slide in when repaired and get pulled
 * outward and dropped when torn. Placeholder planks until real models land.
 */
export class BarricadeRenderer {
  readonly mesh: THREE.InstancedMesh
  private readonly slots: BoardSlot[] = []
  private readonly offset = new THREE.Matrix4()
  private readonly out = new THREE.Matrix4()

  constructor(windows: readonly SpawnWindow[]) {
    const total = windows.reduce((n, w) => n + w.maxBoards, 0)
    const geo = new THREE.BoxGeometry(1, 1, BOARD_DEPTH)
    const mat = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.9 })
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(total, 1))
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false

    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    const scale = new THREE.Vector3()
    for (const w of windows) {
      const { width, height } = w.def
      const slotHeight = height / w.maxBoards
      for (let i = 0; i < w.maxBoards; i++) {
        // Local frame: x across the opening, y up, -z outward. Alternate a slight tilt.
        const tilt = (i % 2 === 0 ? 1 : -1) * 0.12
        euler.set(0, w.yawRad, tilt)
        quat.setFromEuler(euler)
        pos
          .set(0, -height / 2 + (i + 0.5) * slotHeight, 0)
          .applyEuler(new THREE.Euler(0, w.yawRad, 0))
          .add(w.center)
          .addScaledVector(w.outward, BOARD_OFFSET)
        scale.set(width + 0.3, slotHeight * BOARD_FILL, 1)
        const rest = new THREE.Matrix4().compose(pos, quat, scale)
        this.slots.push({ window: w, index: i, rest, presence: i < w.boards ? 1 : 0 })
      }
    }
    this.update(0)
  }

  update(frameDt: number): void {
    const step = Math.min(frameDt * ANIM_SPEED, 1)
    this.slots.forEach((slot, i) => {
      const target = slot.index < slot.window.boards ? 1 : 0
      slot.presence +=
        Math.sign(target - slot.presence) * Math.min(step, Math.abs(target - slot.presence))
      if (slot.presence <= 0.01) {
        this.mesh.setMatrixAt(i, HIDDEN)
        return
      }
      // Missing boards sit out and down from the window, as if pulled off / held ready.
      const away = 1 - slot.presence
      const o = slot.window.outward
      this.offset.makeTranslation(o.x * away * 0.6, -away * 0.6, o.z * away * 0.6)
      this.mesh.setMatrixAt(i, this.out.multiplyMatrices(this.offset, slot.rest))
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
