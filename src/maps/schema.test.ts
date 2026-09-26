import { describe, expect, it } from 'vitest'
import bunker01 from '../../public/maps/bunker-01/map.json'
import testRange from '../../public/maps/test-range/map.json'
import { lightingPresetIds } from './lighting'
import { MAX_LAMPS, parseMap } from './schema'

const startZone = { id: 'start', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, activeAtStart: true }

const minimal = {
  id: 'test-map',
  name: 'Test',
  version: 1,
  brushes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1] }],
  playerSpawns: [{ pos: [0, 0, 0] }],
}

describe('parseMap', () => {
  it('accepts the shipped bunker-01 map', () => {
    const result = parseMap(bunker01)
    if (!result.ok) throw new Error(result.error)
    expect(result.map.id).toBe('bunker-01')
    expect(result.map.brushes.length).toBeGreaterThan(0)
  })

  it('accepts the shipped test-range map', () => {
    const result = parseMap(testRange)
    if (!result.ok) throw new Error(result.error)
    expect(result.map.targetDummies.length).toBeGreaterThan(0)
    expect(result.map.windows).toEqual([])
  })

  it('fills in defaults', () => {
    const result = parseMap(minimal)
    if (!result.ok) throw new Error(result.error)
    expect(result.map.brushes[0]).toMatchObject({ material: 'concrete', walkable: false })
    expect(result.map.playerSpawns[0]?.yaw).toBe(0)
    expect(result.map.lighting).toEqual({ preset: 'night-dim', lamps: [] })
    expect(result.map.targetDummies).toEqual([])
  })

  it('rejects non-positive brush sizes with a readable path', () => {
    const result = parseMap({
      ...minimal,
      brushes: [{ type: 'box', pos: [0, 0, 0], size: [1, 0, 1] }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('brushes[0].size')
      expect(result.error).toContain('size component must be > 0')
    }
  })

  it('requires at least one player spawn', () => {
    const result = parseMap({ ...minimal, playerSpawns: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('playerSpawns')
  })

  it('rejects unknown materials and bad fog', () => {
    const bad = parseMap({
      ...minimal,
      brushes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], material: 'lava' }],
      lighting: { preset: 'night-dim', fog: { color: '#000000', near: 10, far: 5 } },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toContain('brushes[0].material')
      expect(bad.error).toContain('fog.far must be greater than fog.near')
    }
  })

  it('accepts every lighting preset, fills lamp defaults, and caps the lamp count', () => {
    for (const preset of lightingPresetIds) {
      expect(parseMap({ ...minimal, lighting: { preset } }).ok).toBe(true)
    }
    const lit = parseMap({
      ...minimal,
      lighting: { preset: 'blackout', lamps: [{ pos: [0, 2, 0] }] },
    })
    expect(lit.ok && lit.map.lighting.lamps).toEqual([
      { pos: [0, 2, 0], color: '#ffc98a', intensity: 6, range: 8 },
    ])

    const unknown = parseMap({ ...minimal, lighting: { preset: 'daylight-bright' } })
    expect(unknown.ok).toBe(false)
    const tooMany = parseMap({
      ...minimal,
      lighting: {
        preset: 'night-dim',
        lamps: Array.from({ length: MAX_LAMPS + 1 }, () => ({ pos: [0, 2, 0] })),
      },
    })
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) expect(tooMany.error).toContain(`at most ${MAX_LAMPS} lamps`)
  })

  it('parses windows with default boards and size', () => {
    const result = parseMap({
      ...minimal,
      zones: [startZone],
      windows: [{ id: 'w1', zone: 'start', pos: [0, 1.5, 5], yaw: 180, outsideSpawn: [0, 0, 8] }],
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.map.windows[0]).toMatchObject({ boards: 6, width: 1.2, height: 1.2 })
  })

  it('rejects duplicate window ids', () => {
    const w = { id: 'w1', zone: 'start', pos: [0, 1.5, 5], yaw: 180, outsideSpawn: [0, 0, 8] }
    const result = parseMap({ ...minimal, windows: [w, { ...w, pos: [3, 1.5, 5] }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('duplicate window id "w1"')
  })

  it('rejects windows and doors that reference unknown zones', () => {
    const result = parseMap({
      ...minimal,
      zones: [startZone],
      windows: [{ id: 'w1', zone: 'attic', pos: [0, 1.5, 5], yaw: 0, outsideSpawn: [0, 0, 8] }],
      doors: [
        { id: 'd1', cost: 500, pos: [0, 1, 0], size: [1, 2, 0.3], connects: ['start', 'cellar'] },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('unknown zone "attic"')
      expect(result.error).toContain('unknown zone "cellar"')
    }
  })

  it('requires a starting zone and distinct door ends', () => {
    const hall = { id: 'hall', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }
    const result = parseMap({
      ...minimal,
      zones: [hall],
      doors: [
        { id: 'd1', cost: 500, pos: [0, 1, 0], size: [1, 2, 0.3], connects: ['hall', 'hall'] },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('at least one zone needs "activeAtStart": true')
      expect(result.error).toContain('a door must connect two different zones')
    }
  })

  it('rejects wall-buys for weapons that do not exist', () => {
    const result = parseMap({
      ...minimal,
      wallBuys: [{ weapon: 'raygun', pos: [0, 1, 0], yaw: 0 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('wallBuys[0].weapon')
  })

  it('validates crate spots: known zones and at most one starting spot', () => {
    const result = parseMap({
      ...minimal,
      zones: [startZone],
      crateSpots: [
        { id: 'a', pos: [0, 0, 0], startsHere: true },
        { id: 'b', pos: [2, 0, 0], startsHere: true, zone: 'nowhere' },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('only one crate spot can have "startsHere": true')
      expect(result.error).toContain('unknown zone "nowhere"')
    }
  })

  it('rejects non-JSON-object input without throwing', () => {
    expect(parseMap(null).ok).toBe(false)
    expect(parseMap('bunker').ok).toBe(false)
  })
})
