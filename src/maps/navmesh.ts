import { init as initRecast, NavMeshQuery, type NavMesh } from '@recast-navigation/core'
import { generateSoloNavMesh } from '@recast-navigation/generators'
import * as THREE from 'three'
import type { Vec3Like } from '../engine/Physics'
import type { NavmeshTuning } from '../game/config/balance'
import type { BrushDef } from './schema'

let recastReady: Promise<void> | null = null

/** Loads the Recast/Detour WASM module. Safe to call more than once. */
export function initNavigation(): Promise<void> {
  recastReady ??= initRecast()
  return recastReady
}

/*
 * Box corner order: bit 0 → +x, bit 1 → +y, bit 2 → +z.
 * Each face is two counter-clockwise triangles seen from outside.
 */
const TOP_FACE = [2, 7, 3, 2, 6, 7]
const OTHER_FACES = [
  [0, 1, 5, 0, 5, 4], // bottom (-y)
  [0, 4, 6, 0, 6, 2], // -x
  [1, 3, 7, 1, 7, 5], // +x
  [0, 2, 3, 0, 3, 1], // -z
  [4, 5, 7, 4, 7, 6], // +z
]

/**
 * World-space triangles from a map's art (level.glb). A `walkable` mesh is ground agents
 * can stand on (floors, stairs, crates); any other mesh is an obstacle only.
 */
export interface NavTriangles {
  positions: Float32Array
  indices: Uint32Array
  walkable: boolean
}

/**
 * Triangulates brushes as navmesh input. Every brush is an obstacle; only brushes marked
 * `walkable` contribute their top face, so agents can stand on floors, crates and stairs
 * but never on top of walls.
 */
export function buildNavGeometry(
  brushes: readonly BrushDef[],
  meshes: readonly NavTriangles[] = [],
  maxSlopeDeg = 45,
): {
  positions: Float32Array
  indices: Uint32Array
} {
  const meshVerts = meshes.reduce((n, m) => n + m.positions.length, 0)
  const positions = new Float32Array(brushes.length * 8 * 3 + meshVerts)
  const indices: number[] = []
  brushes.forEach((brush, b) => {
    const [px, py, pz] = brush.pos
    const [hx, hy, hz] = [brush.size[0] / 2, brush.size[1] / 2, brush.size[2] / 2]
    for (let c = 0; c < 8; c++) {
      positions[(b * 8 + c) * 3] = px + (c & 1 ? hx : -hx)
      positions[(b * 8 + c) * 3 + 1] = py + (c & 2 ? hy : -hy)
      positions[(b * 8 + c) * 3 + 2] = pz + (c & 4 ? hz : -hz)
    }
    const faces = brush.walkable ? [TOP_FACE, ...OTHER_FACES] : OTHER_FACES
    for (const face of faces) for (const i of face) indices.push(b * 8 + i)
  })

  // Art meshes follow the same rule as brushes: an obstacle-only mesh keeps its steep
  // triangles (so it blocks agents) but drops any it could be stood on (its "top").
  const minWalkableUp = Math.cos(THREE.MathUtils.degToRad(maxSlopeDeg))
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let base = brushes.length * 8
  for (const mesh of meshes) {
    positions.set(mesh.positions, base * 3)
    for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
      const i0 = mesh.indices[t] ?? 0
      const i1 = mesh.indices[t + 1] ?? 0
      const i2 = mesh.indices[t + 2] ?? 0
      if (!mesh.walkable) {
        a.fromArray(mesh.positions, i0 * 3)
        b.fromArray(mesh.positions, i1 * 3).sub(a)
        c.fromArray(mesh.positions, i2 * 3).sub(a)
        const normal = b.cross(c).normalize()
        if (normal.y >= minWalkableUp) continue
      }
      indices.push(base + i0, base + i1, base + i2)
    }
    base += mesh.positions.length / 3
  }
  return { positions, indices: Uint32Array.from(indices) }
}

/** Detour queries over a built navmesh, in world units. */
export class Navigation {
  private mesh: NavMesh
  private query: NavMeshQuery
  private readonly halfExtents = { x: 1, y: 2, z: 1 }
  /** Art geometry that never changes; included in every rebuild. */
  private readonly staticMeshes: readonly NavTriangles[]

  constructor(navMesh: NavMesh, staticMeshes: readonly NavTriangles[] = []) {
    this.mesh = navMesh
    this.query = new NavMeshQuery(navMesh)
    this.staticMeshes = staticMeshes
  }

  get navMesh(): NavMesh {
    return this.mesh
  }

  /**
   * Rebuilds the navmesh in place (e.g. after a door opens). Every polygon ref handed out
   * before this is invalid afterwards; callers must re-snap with `closestPoint`.
   */
  rebuild(brushes: readonly BrushDef[], t: NavmeshTuning): void {
    const next = generateNavMesh(brushes, this.staticMeshes, t)
    this.query.destroy()
    this.mesh.destroy()
    this.mesh = next
    this.query = new NavMeshQuery(next)
  }

  /** Writes the nearest navmesh point to `p` into `out`. Returns its polygon ref, or 0 if none nearby. */
  closestPoint(p: Vec3Like, out: THREE.Vector3): number {
    const r = this.query.findClosestPoint(p, { halfExtents: this.halfExtents })
    if (!r.success || r.polyRef === 0) return 0
    out.set(r.point.x, r.point.y, r.point.z)
    return r.polyRef
  }

  /**
   * Computes a straight-line path (corner points) from `from` to `to` into `out`, reusing
   * its Vector3s. Returns the number of points written, or 0 if there is no path.
   */
  findPath(from: Vec3Like, to: Vec3Like, out: THREE.Vector3[]): number {
    const r = this.query.computePath(from, to, {
      halfExtents: this.halfExtents,
      maxStraightPathPoints: out.length,
    })
    if (!r.success) return 0
    const n = Math.min(r.path.length, out.length)
    for (let i = 0; i < n; i++) {
      const p = r.path[i]
      if (p) out[i]?.set(p.x, p.y, p.z)
    }
    return n
  }

  /**
   * Slides from `from` toward `to` along the navmesh surface (never through walls or off
   * ledges) and writes the result, snapped to the surface height, into `out`.
   * Returns the polygon ref at the new position.
   */
  moveAlong(ref: number, from: Vec3Like, to: Vec3Like, out: THREE.Vector3): number {
    const r = this.query.moveAlongSurface(ref, from, to)
    if (!r.success) {
      out.set(from.x, from.y, from.z)
      return ref
    }
    const newRef = r.visited[r.visited.length - 1] ?? ref
    out.set(r.resultPosition.x, r.resultPosition.y, r.resultPosition.z)
    const h = this.query.getPolyHeight(newRef, out)
    if (h.success) out.y = h.height
    return newRef
  }

  /** Writes a uniformly random navmesh point into `out`. Returns its polygon ref, or 0 on failure. */
  randomPoint(out: THREE.Vector3): number {
    const r = this.query.findRandomPoint()
    if (!r.success) return 0
    out.set(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z)
    return r.randomPolyRef
  }

  dispose(): void {
    this.query.destroy()
    this.mesh.destroy()
  }
}

/**
 * Builds a navmesh from the map's brushes plus any art meshes (which stay part of every
 * later rebuild). Throws with a readable message on failure.
 */
export function buildNavigation(
  brushes: readonly BrushDef[],
  t: NavmeshTuning,
  meshes: readonly NavTriangles[] = [],
): Navigation {
  return new Navigation(generateNavMesh(brushes, meshes, t), meshes)
}

function generateNavMesh(
  brushes: readonly BrushDef[],
  meshes: readonly NavTriangles[],
  t: NavmeshTuning,
): NavMesh {
  const { positions, indices } = buildNavGeometry(brushes, meshes, t.agentMaxSlopeDeg)
  const result = generateSoloNavMesh(positions, indices, {
    cs: t.cellSize,
    ch: t.cellHeight,
    walkableSlopeAngle: t.agentMaxSlopeDeg,
    walkableHeight: Math.ceil(t.agentHeight / t.cellHeight),
    walkableClimb: Math.floor(t.agentMaxClimb / t.cellHeight),
    walkableRadius: Math.ceil(t.agentRadius / t.cellSize),
    maxEdgeLen: Math.round(12 / t.cellSize),
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  })
  if (!result.success) throw new Error(`Navmesh generation failed: ${result.error}`)
  return result.navMesh
}
