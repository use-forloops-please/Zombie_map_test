import * as THREE from 'three'
import {
  buildBrushMesh,
  createBrushMaterials,
  type BrushMaterials,
  type BrushTextures,
} from '../maps/brushes'
import { CRATE_SIZE, type BrushDef } from '../maps/schema'
import type { EditorDocument, ItemKind, ItemRef } from './document'

/** Colour coding for entity markers, also used by the panels. */
export const kindColors: Record<ItemKind, string> = {
  brush: '#8a8d92',
  spawn: '#4cd964',
  zone: '#5ac8fa',
  window: '#ffcc00',
  door: '#ff9500',
  wallBuy: '#af52de',
  crateSpot: '#a2845e',
  dummy: '#c7c7cc',
  lamp: '#ffc98a',
}

/**
 * Builds the editor's picture of each map item: real brush meshes, and simple coloured
 * markers (with a facing arrow where the item has a yaw) for everything else. Geometry
 * and materials are shared; each object carries `userData.ref` for picking.
 */
export class Visuals {
  private readonly brushMaterials: BrushMaterials
  private readonly materials = new Map<string, THREE.Material>()
  private readonly box = new THREE.BoxGeometry(1, 1, 1)
  private readonly edges = new THREE.EdgesGeometry(this.box)
  private readonly capsule = new THREE.CapsuleGeometry(0.3, 1.1, 4, 10)
  private readonly sphere = new THREE.SphereGeometry(0.18, 12, 8)
  private readonly arrow = new THREE.ConeGeometry(0.16, 0.45, 10).rotateX(-Math.PI / 2)

  constructor(textures: BrushTextures) {
    this.brushMaterials = createBrushMaterials(textures)
  }

  build(doc: EditorDocument, ref: ItemRef): THREE.Object3D {
    const item = doc.get(ref) ?? {}
    const group = new THREE.Group()
    const color = kindColors[ref.kind]
    const pos = doc.position(ref)
    group.position.set(...pos)

    switch (ref.kind) {
      case 'brush': {
        // map.json may leave material/walkable to their defaults.
        const brush = { material: 'concrete', walkable: false, ...item } as BrushDef
        const mesh = buildBrushMesh(brush, this.brushMaterials)
        mesh.position.set(0, 0, 0)
        mesh.userData.ownGeometry = true
        group.add(mesh)
        break
      }
      case 'zone':
      case 'door': {
        const size = doc.size(ref)
        const fill = new THREE.Mesh(
          this.box,
          this.material(color, ref.kind === 'zone' ? 0.06 : 0.45),
        )
        fill.scale.set(...size)
        const outline = new THREE.LineSegments(this.edges, this.line(color))
        outline.scale.set(...size)
        group.add(fill, outline)
        break
      }
      case 'spawn':
      case 'dummy': {
        const body = new THREE.Mesh(this.capsule, this.material(color, 0.9))
        body.position.y = 0.85
        group.add(body, this.facing(color, 1.2))
        break
      }
      case 'window': {
        const width = typeof item.width === 'number' ? item.width : 1.2
        const height = typeof item.height === 'number' ? item.height : 1.2
        const frame = new THREE.LineSegments(this.edges, this.line(color))
        frame.scale.set(width, height, 0.1)
        const pane = new THREE.Mesh(this.box, this.material(color, 0.25))
        pane.scale.set(width, height, 0.05)
        group.add(frame, pane, this.facing(color, 0))
        break
      }
      case 'wallBuy': {
        const sign = new THREE.Mesh(this.box, this.material(color, 0.9))
        sign.scale.set(0.9, 0.6, 0.05)
        group.add(sign, this.facing(color, 0))
        break
      }
      case 'crateSpot': {
        const [w, h, d] = CRATE_SIZE
        const crate = new THREE.Mesh(this.box, this.material(color, 0.8))
        crate.scale.set(w, h, d)
        crate.position.y = h / 2
        group.add(crate, this.facing(color, h / 2))
        break
      }
      case 'lamp': {
        const lampColor = typeof item.color === 'string' ? item.color : color
        group.add(new THREE.Mesh(this.sphere, this.material(lampColor, 1, true)))
        break
      }
    }
    if (ref.kind !== 'brush' && ref.kind !== 'zone' && ref.kind !== 'door') {
      group.rotation.y = THREE.MathUtils.degToRad(doc.yaw(ref))
    }
    tag(group, ref)
    return group
  }

  /** A window's zombie-spawn point, linked to the window by a line. */
  buildOutside(doc: EditorDocument, ref: ItemRef): THREE.Object3D {
    const handle: ItemRef = { ...ref, handle: 'outside' }
    const group = new THREE.Group()
    const at = doc.position(handle)
    group.position.set(...at)
    const marker = new THREE.Mesh(this.sphere, this.material(kindColors.window, 0.9))
    marker.position.y = 0.2
    const window = doc.position(ref)
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.2, 0),
        new THREE.Vector3(window[0] - at[0], window[1] - at[1], window[2] - at[2]),
      ]),
      this.line(kindColors.window),
    )
    group.add(marker, line)
    tag(group, handle)
    return group
  }

  /** Frees the per-object geometry made by `buildOutside` (everything else is shared). */
  release(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      if (o instanceof THREE.Line && !(o instanceof THREE.LineSegments)) o.geometry.dispose()
      if (o instanceof THREE.Mesh && o.userData.ownGeometry === true) o.geometry.dispose()
    })
  }

  dispose(): void {
    this.brushMaterials.dispose()
    for (const m of this.materials.values()) m.dispose()
    for (const g of [this.box, this.edges, this.capsule, this.sphere, this.arrow]) g.dispose()
  }

  /** A cone at `height` pointing the way the item faces (local -Z). */
  private facing(color: string, height: number): THREE.Mesh {
    const cone = new THREE.Mesh(this.arrow, this.material(color, 1))
    cone.position.set(0, height, -0.55)
    return cone
  }

  private material(color: string, opacity: number, glow = false): THREE.Material {
    const key = `${color}/${opacity}/${glow}`
    let m = this.materials.get(key)
    if (!m) {
      m = glow
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshStandardMaterial({
            color,
            roughness: 0.7,
            transparent: opacity < 1,
            opacity,
            depthWrite: opacity >= 0.5,
          })
      this.materials.set(key, m)
    }
    return m
  }

  private line(color: string): THREE.LineBasicMaterial {
    const key = `line/${color}`
    let m = this.materials.get(key)
    if (!m) {
      m = new THREE.LineBasicMaterial({ color })
      this.materials.set(key, m)
    }
    return m as THREE.LineBasicMaterial
  }
}

function tag(obj: THREE.Object3D, ref: ItemRef): void {
  obj.userData.ref = ref
  obj.traverse((o) => {
    o.userData.ref = ref
  })
}

/** Stable key for an item (for maps of visuals). */
export function refKey(ref: ItemRef): string {
  return `${ref.kind}:${ref.index}${ref.handle ? `:${ref.handle}` : ''}`
}
