import type { BrushDef, BrushMaterial, MapDef } from './schema'

/**
 * Surface textures for brushes: CC0 texture sets from Poly Haven, stored in
 * `public/assets/textures/<id>/` as color.jpg (1024 px), normal.jpg and rough.jpg (512 px).
 * Every one is logged in ASSETS.md. A brush uses its material's default texture unless it
 * names another with `texture`.
 */
export const textureIds = [
  'concrete-wall',
  'concrete-floor',
  'dirty-concrete',
  'plaster',
  'wood-planks',
  'rusty-metal',
  'dirt',
  'red-brick',
] as const
export type TextureId = (typeof textureIds)[number]

export interface TextureInfo {
  /** Shown in the editor. */
  name: string
  /** Poly Haven asset id (https://polyhaven.com/a/<source>). */
  source: string
  /** Metres one repeat of the texture covers, from the scan's real-world size. */
  tileSize: number
  metalness: number
}

export const textureCatalog: Record<TextureId, TextureInfo> = {
  'concrete-wall': {
    name: 'Concrete wall',
    source: 'concrete_wall_003',
    tileSize: 3,
    metalness: 0,
  },
  'concrete-floor': {
    name: 'Worn concrete floor',
    source: 'concrete_floor_worn_001',
    tileSize: 3,
    metalness: 0,
  },
  'dirty-concrete': { name: 'Dirty concrete', source: 'dirty_concrete', tileSize: 3, metalness: 0 },
  plaster: { name: 'Beige plaster', source: 'beige_wall_001', tileSize: 3, metalness: 0 },
  'wood-planks': {
    name: 'Weathered planks',
    source: 'weathered_brown_planks',
    tileSize: 1.8,
    metalness: 0,
  },
  'rusty-metal': { name: 'Rusty metal', source: 'rusty_metal_02', tileSize: 1, metalness: 0.4 },
  dirt: { name: 'Dirt', source: 'dirt', tileSize: 2, metalness: 0 },
  'red-brick': { name: 'Red brick', source: 'red_brick_03', tileSize: 1, metalness: 0 },
}

/** The texture each brush material gets by default. */
export const materialTextures: Record<BrushMaterial, TextureId> = {
  concrete: 'concrete-wall',
  plaster: 'plaster',
  wood: 'wood-planks',
  metal: 'rusty-metal',
  dirt: 'dirt',
}

/** The files for one texture, relative to the site root. */
export function textureFiles(id: TextureId): { color: string; normal: string; rough: string } {
  const dir = `${import.meta.env.BASE_URL}assets/textures/${id}/`
  return { color: `${dir}color.jpg`, normal: `${dir}normal.jpg`, rough: `${dir}rough.jpg` }
}

/** The texture a brush is drawn with. */
export function brushTexture(brush: Pick<BrushDef, 'material' | 'texture'>): TextureId {
  return brush.texture ?? materialTextures[brush.material]
}

/** Every texture a map's brushes use, so only those are downloaded. */
export function texturesUsed(def: Pick<MapDef, 'brushes'>): TextureId[] {
  return [...new Set(def.brushes.map(brushTexture))]
}
