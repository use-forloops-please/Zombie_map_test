import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import bunker01 from '../../public/maps/bunker-01/map.json'
import { balance } from '../game/config/balance'
import { buildNavGeometry, buildNavigation, initNavigation, type Navigation } from './navmesh'
import { parseMap, type BrushDef, type MapDef } from './schema'

let map: MapDef
let nav: Navigation

beforeAll(async () => {
  const parsed = parseMap(bunker01)
  if (!parsed.ok) throw new Error(parsed.error)
  map = parsed.map
  await initNavigation()
  nav = buildNavigation(map.brushes, balance.navmesh)
})

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
  const out = Array.from({ length: 64 }, () => new THREE.Vector3())
  return out.slice(0, nav.findPath(from, to, out))
}

function length(points: THREE.Vector3[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += points[i]!.distanceTo(points[i - 1]!)
  return total
}

/** True if the horizontal segment a→b passes through the XZ rectangle, grown by `pad`. */
function crossesBox(a: THREE.Vector3, b: THREE.Vector3, min: number[], max: number[], pad: number) {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    if (x > min[0]! - pad && x < max[0]! + pad && z > min[1]! - pad && z < max[1]! + pad)
      return true
  }
  return false
}

describe('buildNavGeometry', () => {
  it('emits 8 vertices per brush and omits the top face of non-walkable brushes', () => {
    const walkable: BrushDef = {
      type: 'box',
      pos: [0, 0, 0],
      size: [1, 1, 1],
      material: 'concrete',
      walkable: true,
    }
    const wall = { ...walkable, walkable: false }
    expect(buildNavGeometry([walkable]).positions.length).toBe(24)
    expect(buildNavGeometry([walkable]).indices.length).toBe(36)
    expect(buildNavGeometry([wall]).indices.length).toBe(30)
  })
})

describe('bunker-01 navmesh', () => {
  it('covers the open floor', () => {
    const out = new THREE.Vector3()
    expect(nav.closestPoint(v(0, 0, 3), out)).not.toBe(0)
    expect(out.distanceTo(v(0, 0, 3))).toBeLessThan(0.1)
  })

  it('has no walkable surface on top of walls', () => {
    const out = new THREE.Vector3()
    nav.closestPoint(v(0, 3, -6.15), out) // top of the north wall
    expect(out.y).toBeLessThan(0.5)
  })

  it('keeps agents a radius away from walls', () => {
    const out = new THREE.Vector3()
    nav.closestPoint(v(-2.5, 0, -2.5), out) // inside the pillar
    const dx = Math.max(Math.abs(out.x + 2.5) - 0.4, 0)
    const dz = Math.max(Math.abs(out.z + 2.5) - 0.4, 0)
    expect(Math.max(dx, dz)).toBeGreaterThanOrEqual(balance.navmesh.agentRadius - 0.11)
  })

  it('paths around the pillar instead of through it', () => {
    const p = path(v(-2.5, 0, 0), v(-2.5, 0, -5))
    expect(p.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < p.length; i++) {
      expect(crossesBox(p[i - 1]!, p[i]!, [-2.9, -2.9], [-2.1, -2.1], 0.1)).toBe(false)
    }
    expect(length(p)).toBeGreaterThan(5)
  })

  it('paths from the start room into the hall through the doorway', () => {
    const p = path(v(-4, 0, 4), v(14, 0, 0))
    expect(p.length).toBeGreaterThanOrEqual(2)
    const end = p[p.length - 1]!
    expect(end.distanceTo(v(14, 0, 0))).toBeLessThan(0.2)
    const throughDoor = p.some((pt, i) => {
      const prev = p[i - 1]
      if (!prev || (prev.x - 6.15) * (pt.x - 6.15) > 0) return false
      const t = (6.15 - prev.x) / (pt.x - prev.x)
      const z = prev.z + (pt.z - prev.z) * t
      return Math.abs(z) < 1
    })
    expect(throughDoor).toBe(true)
  })

  it('paths around the low wall rather than over it', () => {
    const p = path(v(10, 0, 0.8), v(10, 0, 3.4))
    for (let i = 1; i < p.length; i++) {
      expect(crossesBox(p[i - 1]!, p[i]!, [9, 1.8], [11, 2.2], 0.1)).toBe(false)
    }
  })

  it('climbs the stairs onto the platform', () => {
    const p = path(v(9, 0, -3), v(14.5, 1.5, -2.5))
    const end = p[p.length - 1]!
    expect(end.y).toBeCloseTo(1.5, 1)
    expect(end.distanceTo(v(14.5, 1.5, -2.5))).toBeLessThan(0.2)
  })

  it('moveAlong never passes through a wall', () => {
    const out = new THREE.Vector3()
    const ref = nav.closestPoint(v(5, 0, 3), out)
    nav.moveAlong(ref, out, v(8, 0, 3), out) // east wall is at x = 6.0..6.3
    expect(out.x).toBeLessThan(6)
  })
})
