import * as THREE from 'three'
import type { Door } from '../entities/Door'

/** Planks across the blocker, as a fraction of its height. */
const PLANK_COUNT = 5

/**
 * Doors as boarded-up debris: a dark backing box with planks nailed across it. A bought
 * door sinks into the floor and fades out over `openTime` seconds, then is hidden.
 * Placeholder art until real models land.
 */
export class DoorRenderer {
  readonly group = new THREE.Group()
  private readonly openTime: number
  private readonly visuals: { door: Door; root: THREE.Group; materials: THREE.Material[] }[] = []
  private readonly geometries: THREE.BufferGeometry[] = []

  constructor(doors: readonly Door[], openTime: number) {
    this.openTime = openTime
    for (const door of doors) this.visuals.push(this.build(door))
  }

  update(): void {
    for (const v of this.visuals) {
      if (!v.door.open) continue
      const t = Math.min(v.door.openTime / this.openTime, 1)
      v.root.visible = t < 1
      v.root.position.y = v.door.center.y - t * v.door.def.size[1]
      for (const m of v.materials) m.opacity = 1 - t
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const v of this.visuals) for (const m of v.materials) m.dispose()
  }

  private build(door: Door) {
    const [sx, sy, sz] = door.def.size
    // Planks run along the door's long horizontal axis.
    const alongX = sx >= sz
    const width = alongX ? sx : sz
    const depth = alongX ? sz : sx

    const backing = new THREE.MeshStandardMaterial({
      color: '#2a221a',
      roughness: 1,
      transparent: true,
    })
    const plank = new THREE.MeshStandardMaterial({
      color: '#7a5a38',
      roughness: 0.9,
      transparent: true,
    })
    const root = new THREE.Group()
    root.position.copy(door.center)
    if (!alongX) root.rotation.y = Math.PI / 2

    const backGeo = new THREE.BoxGeometry(width, sy, depth * 0.6)
    const plankGeo = new THREE.BoxGeometry(width * 1.08, (sy / PLANK_COUNT) * 0.55, depth)
    this.geometries.push(backGeo, plankGeo)
    const back = new THREE.Mesh(backGeo, backing)
    back.castShadow = true
    back.receiveShadow = true
    root.add(back)
    for (let i = 0; i < PLANK_COUNT; i++) {
      const m = new THREE.Mesh(plankGeo, plank)
      m.position.y = -sy / 2 + (i + 0.5) * (sy / PLANK_COUNT)
      m.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.08
      m.castShadow = true
      root.add(m)
    }
    this.group.add(root)
    return { door, root, materials: [backing, plank] }
  }
}
