import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { BrushDef, BrushMaterial } from './schema'
import { brushTexture, textureCatalog, textureFiles, type TextureId } from './textures'

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

/** The loaded images for a texture: colour, normal and roughness maps, set to tile in metres. */
interface TextureSet {
  color: THREE.Texture
  normal: THREE.Texture
  rough: THREE.Texture
}

/** Brush textures that have been downloaded (see `loadBrushTextures`). */
export interface BrushTextures {
  get(id: TextureId): TextureSet | undefined
  dispose(): void
}

/** An empty set: every brush falls back to its tinted greybox grid. */
export const noBrushTextures: BrushTextures = { get: () => undefined, dispose: () => {} }

/**
 * Downloads the given textures' images. Brushes tile them at the scan's real-world size
 * (UVs are in metres). Rejects, naming the file, if any image fails to load.
 */
export async function loadBrushTextures(ids: readonly TextureId[]): Promise<BrushTextures> {
  const loader = new THREE.TextureLoader()
  const sets = new Map<TextureId, TextureSet>()
  const load = async (url: string, repeat: number, srgb: boolean) => {
    let tex: THREE.Texture
    try {
      tex = await loader.loadAsync(url)
    } catch {
      throw new Error(`Could not load texture ${url}`)
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1 / repeat, 1 / repeat)
    tex.anisotropy = 8
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    return tex
  }
  await Promise.all(
    ids.map(async (id) => {
      const files = textureFiles(id)
      const { tileSize } = textureCatalog[id]
      const [color, normal, rough] = await Promise.all([
        load(files.color, tileSize, true),
        load(files.normal, tileSize, false),
        load(files.rough, tileSize, false),
      ])
      sets.set(id, { color, normal, rough })
    }),
  )
  return {
    get: (id) => sets.get(id),
    dispose() {
      for (const set of sets.values()) for (const t of Object.values(set)) t.dispose()
    },
  }
}

export interface BrushMaterials {
  get(brush: Pick<BrushDef, 'material' | 'texture'>): THREE.MeshStandardMaterial
  dispose(): void
}

/**
 * One shared material per texture (or, for textures not loaded, per brush material type),
 * so brushes batch well and share GPU state. Textured brushes use their Poly Haven set;
 * anything else gets the tinted greybox grid.
 */
export function createBrushMaterials(textures: BrushTextures = noBrushTextures): BrushMaterials {
  const grid = createGridTexture()
  const cache = new Map<string, THREE.MeshStandardMaterial>()
  return {
    get(brush) {
      const id = brushTexture(brush)
      const set = textures.get(id)
      const key = set ? id : `grid:${brush.material}`
      let m = cache.get(key)
      if (!m) {
        m = set
          ? new THREE.MeshStandardMaterial({
              map: set.color,
              normalMap: set.normal,
              roughnessMap: set.rough,
              metalness: textureCatalog[id].metalness,
            })
          : new THREE.MeshStandardMaterial({
              color: MATERIAL_COLORS[brush.material],
              map: grid,
              roughness: brush.material === 'metal' ? 0.55 : 0.92,
              metalness: brush.material === 'metal' ? 0.3 : 0,
            })
        cache.set(key, m)
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

function brushGeometry(brush: BrushDef): THREE.BoxGeometry {
  const [sx, sy, sz] = brush.size
  const geo = new THREE.BoxGeometry(sx, sy, sz)
  scaleBoxUVs(geo, sx, sy, sz)
  return geo
}

/** One mesh per brush, for the editor (which selects and moves brushes individually). */
export function buildBrushMesh(brush: BrushDef, materials: BrushMaterials): THREE.Mesh {
  const mesh = new THREE.Mesh(brushGeometry(brush), materials.get(brush))
  mesh.position.set(...brush.pos)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.walkable = brush.walkable
  return mesh
}

/**
 * The game's brush meshes: every brush sharing a material merged into one mesh, so a map
 * costs one draw call (plus one shadow draw) per material rather than per brush.
 */
export function buildBrushBatches(
  brushes: readonly BrushDef[],
  materials: BrushMaterials,
): THREE.Mesh[] {
  const groups = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>()
  for (const brush of brushes) {
    const geo = brushGeometry(brush).translate(...brush.pos)
    const material = materials.get(brush)
    const group = groups.get(material)
    if (group) group.push(geo)
    else groups.set(material, [geo])
  }
  return [...groups].map(([material, geos]) => {
    const merged = mergeGeometries(geos)
    for (const g of geos) g.dispose()
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  })
}
