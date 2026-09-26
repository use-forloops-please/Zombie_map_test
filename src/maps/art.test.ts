import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { extractArt, mergeArt } from './art'
import { buildNavGeometry } from './navmesh'
import { parseMap } from './schema'

/** An empty as GLTFLoader produces it: sanitised name, original in userData, extras merged in. */
function empty(name: string, extras: Record<string, unknown> = {}): THREE.Object3D {
  const obj = new THREE.Object3D()
  obj.name = name.replace(/\./g, '')
  obj.userData = { name, ...extras }
  return obj
}

function box(extras: Record<string, unknown>): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.userData = { ...extras }
  return mesh
}

const zones = [{ id: 'start', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, activeAtStart: true }]

describe('extractArt: placeholders from empties', () => {
  it('reads ids from names (ignoring Blender .001 suffixes), positions and facing', () => {
    const root = new THREE.Group()
    const w = empty('window_w1.001', { zone: 'start', boards: 4 })
    w.position.set(1, 1.5, -6)
    w.rotation.y = Math.PI // faces +Z
    const out = empty('outside_w1')
    out.position.set(1, 0, -9)
    const turned = empty('crate_c1', { startsHere: 1 })
    turned.rotation.y = Math.PI / 2 // faces -X: yaw 90
    root.add(w, out, turned, empty('Camera'))

    const art = extractArt(root)
    expect(art.issues).toEqual([])
    expect(art.placeholders.windows).toEqual([
      { id: 'w1', pos: [1, 1.5, -6], yaw: 180, zone: 'start', boards: 4, outsideSpawn: [1, 0, -9] },
    ])
    expect(art.placeholders.crateSpots).toEqual([
      { id: 'c1', pos: [0, 0, 0], yaw: 90, startsHere: true },
    ])
  })

  it('turns box empties into zone bounds and door sizes, and parses door properties', () => {
    const root = new THREE.Group()
    const zone = empty('zone_hall', { activeAtStart: false })
    zone.position.set(10, 1.5, 0)
    zone.scale.set(4, 1.5, 3)
    const door = empty('door_d1', { cost: 750, connects: 'start, hall' })
    door.position.set(6, 1.25, 0)
    door.scale.set(0.15, 1.25, 1)
    root.add(zone, door)
    const { placeholders, issues } = extractArt(root)
    expect(issues).toEqual([])
    expect(placeholders.zones).toEqual([
      { id: 'hall', bounds: { min: [6, 0, -3], max: [14, 3, 3] }, activeAtStart: false },
    ])
    expect(placeholders.doors).toEqual([
      { id: 'd1', pos: [6, 1.25, 0], size: [0.3, 2.5, 2], cost: 750, connects: ['start', 'hall'] },
    ])
  })

  it('names the empty and the fix when a placeholder is incomplete', () => {
    const root = new THREE.Group()
    root.add(empty('window_w2', {}), empty('door_d2', { connects: 'start' }), empty('wallbuy_x'))
    const messages = extractArt(root).issues.map((i) => `${i.list} ${i.id}: ${i.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        'windows w2: needs a "zone" property',
        'windows w2: has no "outside_w2" empty marking where its zombies spawn',
        'doors d2: needs a "connects" property naming two zones, like "start,hall"',
        'doors d2: needs a "cost" property',
        'wallBuys null: "x" needs a "weapon" property',
      ]),
    )
  })

  it('orders entities by name, whatever order the file lists them in', () => {
    const root = new THREE.Group()
    for (const id of ['w10', 'w2', 'w1']) {
      root.add(empty(`window_${id}`, { zone: 'start' }), empty(`outside_${id}`))
    }
    expect(extractArt(root).placeholders.windows.map((w) => w.id)).toEqual(['w1', 'w2', 'w10'])
  })
})

describe('extractArt: meshes', () => {
  it('collide meshes become colliders and nav obstacles; nav meshes are walkable', () => {
    const root = new THREE.Group()
    const floor = box({ collide: true, nav: true })
    floor.position.set(0, -0.5, 0)
    floor.scale.set(10, 1, 10)
    const wall = box({ collide: 1 })
    const deco = box({})
    root.add(floor, wall, deco)
    const art = extractArt(root)
    expect(art.colliders).toHaveLength(2)
    expect(art.navMeshes.map((m) => m.walkable)).toEqual([true, false])
    // World space: the floor's vertices were moved and scaled.
    const ys = Array.from(art.colliders[0]!.positions).filter((_, i) => i % 3 === 1)
    expect(Math.min(...ys)).toBeCloseTo(-1)
    expect(Math.max(...ys)).toBeCloseTo(0)
  })

  it('takes flags from the parent node for multi-material meshes, and hides hidden ones', () => {
    const root = new THREE.Group()
    const node = new THREE.Group()
    node.userData = { collide: true, hidden: true }
    const part = box({})
    node.add(part)
    root.add(node)
    const art = extractArt(root)
    expect(art.colliders).toHaveLength(1)
    expect(part.visible).toBe(false)
  })

  it('keeps triangles facing outward on a mirrored (negatively scaled) mesh', () => {
    const root = new THREE.Group()
    const mesh = box({ collide: true })
    mesh.scale.set(-1, 1, 1)
    root.add(mesh)
    const { positions, indices } = extractArt(root).colliders[0]!
    const v = (i: number) => new THREE.Vector3().fromArray(positions, indices[i]! * 3)
    // Each triangle's normal points away from the box centre.
    for (let t = 0; t < indices.length; t += 3) {
      const a = v(t)
      const n = v(t + 1)
        .sub(a)
        .cross(v(t + 2).sub(a))
      const centre = a
        .clone()
        .add(v(t + 1))
        .add(v(t + 2))
        .divideScalar(3)
      expect(n.dot(centre)).toBeGreaterThan(0)
    }
  })

  it('an obstacle-only mesh gives the navmesh no ground to stand on (like a non-walkable brush)', () => {
    const root = new THREE.Group()
    root.add(box({ collide: true }), box({ collide: true, nav: true }))
    const [obstacle, ground] = extractArt(root).navMeshes
    const tris = (m: typeof obstacle) => buildNavGeometry([], [m!]).indices.length / 3
    expect(tris(ground)).toBe(12)
    expect(tris(obstacle)).toBe(10) // the two top triangles are dropped
  })
})

describe('mergeArt: map.json wins', () => {
  const base = { id: 'm', name: 'M', version: 1, art: 'level.glb', zones }

  it('replaces an art entity with the same id entirely, and drops that entity’s art issues', () => {
    const root = new THREE.Group()
    root.add(empty('window_w1', {})) // incomplete in the art
    const jsonWindow = {
      id: 'w1',
      zone: 'start',
      pos: [0, 1.5, -5],
      yaw: 0,
      outsideSpawn: [0, 0, -8],
    }
    const art = extractArt(root)
    const { merged, issues } = mergeArt(
      { ...base, windows: [jsonWindow] },
      art.placeholders,
      art.issues,
    )
    expect(issues).toEqual([])
    expect(merged.windows).toEqual([jsonWindow])
  })

  it('lets a non-empty id-less list in map.json replace the art’s, and keeps the art’s otherwise', () => {
    const root = new THREE.Group()
    const s = empty('spawn_a')
    s.position.set(3, 0, 3)
    const lamp = empty('lamp_1', { intensity: 3 })
    lamp.position.set(0, 2.5, 0)
    root.add(s, lamp)
    const art = extractArt(root)

    const artOnly = mergeArt(base, art.placeholders, art.issues).merged
    const parsed = parseMap(artOnly)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.map.playerSpawns).toEqual([{ pos: [3, 0, 3], yaw: 0 }])
      expect(parsed.map.lighting.lamps).toEqual([
        { pos: [0, 2.5, 0], intensity: 3, color: '#ffc98a', range: 8 },
      ])
    }

    const own = [{ pos: [0, 0, 0], yaw: 90 }]
    expect(
      mergeArt({ ...base, playerSpawns: own }, art.placeholders, art.issues).merged.playerSpawns,
    ).toBe(own)
  })

  it('accepts a map with art and no brushes, but not one with neither', () => {
    const noArt = { id: 'm', name: 'M', version: 1, playerSpawns: [{ pos: [0, 0, 0] }] }
    const bad = parseMap(noArt)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('at least one brush, or "art"')
    expect(parseMap({ ...noArt, art: 'level.glb' }).ok).toBe(true)
    expect(parseMap({ ...noArt, art: '../secrets.glb' }).ok).toBe(false)
  })
})
