import * as THREE from 'three'
import type { BrushDef, BrushMaterial } from './schema'

const MATERIAL_COLORS: Record<BrushMaterial, string> = {
  concrete: '#8a8d92',
  plaster: '#a39c8e',
  wood: '#8c6a45',
  metal: '#6c7680',
  dirt: '#5e5242',
}

/** A 1 m greybox grid, tinted per material. Makes scale and motion readable before real textures land. */
function createGridTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  ctx.fillStyle = '#d8d8d8'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#bcbcbc'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(size / 2, 0)
  ctx.lineTo(size / 2, size)
  ctx.moveTo(0, size / 2)
  ctx.lineTo(size, size / 2)
  ctx.stroke()
  ctx.strokeStyle = '#8f8f8f'
  ctx.lineWidth = 4
  ctx.strokeRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export interface BrushMaterials {
  get(material: BrushMaterial): THREE.MeshStandardMaterial
  dispose(): void
}

/** One shared material per brush material type, so brushes batch well and share GPU state. */
export function createBrushMaterials(): BrushMaterials {
  const grid = createGridTexture()
  const cache = new Map<BrushMaterial, THREE.MeshStandardMaterial>()
  return {
    get(material) {
      let m = cache.get(material)
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color: MATERIAL_COLORS[material],
          map: grid,
          roughness: material === 'metal' ? 0.55 : 0.92,
          metalness: material === 'metal' ? 0.3 : 0,
        })
        cache.set(material, m)
      }
      return m
    },
    dispose() {
      for (const m of cache.values()) m.dispose()
      grid.dispose()
    },
  }
}

/**
 * Rescales a BoxGeometry's UVs from 0..1 per face to metres, so a repeating texture
 * tiles at the same world scale on every brush regardless of its size.
 * Face order in BoxGeometry is +X, -X, +Y, -Y, +Z, -Z, four vertices each.
 */
function scaleBoxUVs(geo: THREE.BoxGeometry, sx: number, sy: number, sz: number): void {
  const uv = geo.getAttribute('uv')
  const faceDims: ReadonlyArray<readonly [number, number]> = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ]
  faceDims.forEach(([du, dv], face) => {
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv)
    }
  })
  uv.needsUpdate = true
}

export function buildBrushMesh(brush: BrushDef, materials: BrushMaterials): THREE.Mesh {
  const [sx, sy, sz] = brush.size
  const geo = new THREE.BoxGeometry(sx, sy, sz)
  scaleBoxUVs(geo, sx, sy, sz)
  const mesh = new THREE.Mesh(geo, materials.get(brush.material))
  mesh.position.set(...brush.pos)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.walkable = brush.walkable
  return mesh
}
