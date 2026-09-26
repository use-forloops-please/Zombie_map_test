import { describe, expect, it } from 'vitest'
import bunker01 from '../../public/maps/bunker-01/map.json'
import { brushMaterials, parseMap } from './schema'
import {
  brushTexture,
  materialTextures,
  textureCatalog,
  textureIds,
  texturesUsed,
} from './textures'

/** Every texture image shipped in public/ (file names only; nothing is loaded). */
const shipped = Object.keys(import.meta.glob('/public/assets/textures/*/*.jpg'))

describe('brush textures', () => {
  it('ships colour, normal and roughness images for every catalogued texture, and nothing else', () => {
    const expected = textureIds.flatMap((id) =>
      ['color', 'normal', 'rough'].map((m) => `/public/assets/textures/${id}/${m}.jpg`),
    )
    expect(shipped.sort()).toEqual(expected.sort())
    for (const id of textureIds) expect(textureCatalog[id].tileSize).toBeGreaterThan(0)
  })

  it('gives every brush material a default texture, and lets a brush pick another', () => {
    for (const m of brushMaterials) expect(textureIds).toContain(materialTextures[m])
    expect(brushTexture({ material: 'concrete' })).toBe('concrete-wall')
    expect(brushTexture({ material: 'concrete', texture: 'red-brick' })).toBe('red-brick')
  })

  it('downloads only the textures a map uses', () => {
    const parsed = parseMap(bunker01)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(texturesUsed(parsed.map).sort()).toEqual(
      ['concrete-wall', 'dirt', 'plaster', 'rusty-metal', 'wood-planks'].sort(),
    )
  })

  it('validates the texture field in map.json', () => {
    const map = (texture: string) => ({
      id: 't',
      name: 'T',
      version: 1,
      brushes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], texture }],
      playerSpawns: [{ pos: [0, 0, 0] }],
    })
    expect(parseMap(map('red-brick')).ok).toBe(true)
    const bad = parseMap(map('marble'))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('brushes[0].texture')
  })
})
