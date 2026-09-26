import * as THREE from 'three'
import type { NavTriangles } from './navmesh'

/*
 * The Blender route (see docs/MAPPING.md). A map's optional `level.glb` supplies art and,
 * through naming and custom properties (glTF `extras`), collision, navmesh input and
 * entity placeholders:
 *
 * - Meshes with `collide: true` become solid (triangle-mesh colliders; they block agents).
 * - Meshes with `nav: true` are ground agents walk on.
 * - Meshes with `hidden: true` are not drawn (invisible blockers, nav helpers).
 * - Empties named `<kind>_<id>` are placeholders: spawn, zone, window, outside, door,
 *   wallbuy, crate, dummy, lamp. Their position, rotation and scale plus their custom
 *   properties become the matching map.json entity.
 *
 * Everything here is plain three.js (no DOM), so it runs in tests on a parsed .glb.
 */

type Vec3 = [number, number, number]

/** Placeholder entities read from a level.glb, in map.json's shape (validated later). */
export interface ArtPlaceholders {
  playerSpawns: { pos: Vec3; yaw: number }[]
  zones: { id: string; bounds: { min: Vec3; max: Vec3 }; activeAtStart?: boolean }[]
  windows: {
    id: string
    zone?: string
    pos: Vec3
    yaw: number
    outsideSpawn?: Vec3
    boards?: number
    width?: number
    height?: number
  }[]
  doors: { id: string; cost?: number; pos: Vec3; size: Vec3; connects?: string[] }[]
  wallBuys: { weapon?: string; pos: Vec3; yaw: number; cost?: number; ammoCost?: number }[]
  crateSpots: { id: string; pos: Vec3; yaw: number; zone?: string; startsHere?: boolean }[]
  targetDummies: { pos: Vec3; yaw: number }[]
  lamps: { pos: Vec3; color?: string; intensity?: number; range?: number }[]
}

/** A problem with one placeholder, reported only if map.json doesn't replace that entity. */
export interface ArtIssue {
  /** Which list and entity it belongs to, e.g. `windows` / `w1` (null for id-less lists). */
  list: keyof ArtPlaceholders
  id: string | null
  message: string
}

export interface ArtScene {
  /** Everything to draw (placeholder empties are left in; they render nothing). */
  readonly root: THREE.Object3D
  /** World-space triangles for every `collide` mesh. */
  readonly colliders: readonly { positions: Float32Array; indices: Uint32Array }[]
  /** Navmesh input: `nav` meshes (walkable) and `collide` meshes (obstacles). */
  readonly navMeshes: readonly NavTriangles[]
  readonly placeholders: ArtPlaceholders
  readonly issues: readonly ArtIssue[]
}

const PLACEHOLDER = /^(spawn|zone|window|outside|door|wallbuy|crate|dummy|lamp)_(.+)$/
/** Blender renames duplicates `Name.001`; the suffix isn't part of the id. */
const BLENDER_DUPLICATE = /\.\d{3}$/

/** Rounds away float32 noise from the export (1.2000000476837158 → 1.2). */
const clean = (n: number): number => Math.round(n * 1e4) / 1e4 + 0
const vec = (v: THREE.Vector3): Vec3 => [clean(v.x), clean(v.y), clean(v.z)]

/** The name the author typed (three.js sanitises `node.name`; the original is kept in userData). */
function authoredName(obj: THREE.Object3D): string {
  const original: unknown = obj.userData.name
  return (typeof original === 'string' ? original : obj.name).replace(BLENDER_DUPLICATE, '')
}

/** A custom property on `obj` or its nearest ancestor that sets it (multi-material meshes). */
function inherited(obj: THREE.Object3D, key: string): unknown {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (key in o.userData) return o.userData[key]
  }
  return undefined
}

/** Blender exports booleans as true/false or, from integer properties, 1/0. */
function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

export function extractArt(root: THREE.Object3D): ArtScene {
  root.updateMatrixWorld(true)
  const colliders: { positions: Float32Array; indices: Uint32Array }[] = []
  const navMeshes: NavTriangles[] = []
  const issues: ArtIssue[] = []
  const placeholders: ArtPlaceholders = {
    playerSpawns: [],
    zones: [],
    windows: [],
    doors: [],
    wallBuys: [],
    crateSpots: [],
    targetDummies: [],
    lamps: [],
  }
  const outside = new Map<string, Vec3>()

  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const forward = new THREE.Vector3()

  // Visit placeholders in name order, so entity order (which spawn logic depends on) is
  // the same whatever order an exporter writes nodes in.
  const objects: THREE.Object3D[] = []
  root.traverse((obj) => objects.push(obj))
  objects.sort((a, b) => authoredName(a).localeCompare(authoredName(b), 'en', { numeric: true }))

  for (const obj of objects) {
    if (obj instanceof THREE.Mesh) {
      const collide = flag(inherited(obj, 'collide'))
      const nav = flag(inherited(obj, 'nav'))
      if (flag(inherited(obj, 'hidden'))) obj.visible = false
      obj.castShadow = true
      obj.receiveShadow = true
      if (collide || nav) {
        const tris = worldTriangles(obj)
        if (collide) colliders.push(tris)
        navMeshes.push({ ...tris, walkable: nav })
      }
      continue
    }

    const match = PLACEHOLDER.exec(authoredName(obj))
    if (!match) continue
    const [, kind, id = ''] = match
    const x = obj.userData as Record<string, unknown>
    obj.matrixWorld.decompose(pos, quat, scale)
    // An empty faces along its local -Z in glTF, which is Blender's +Y.
    forward.set(0, 0, -1).applyQuaternion(quat)
    let yaw = clean(THREE.MathUtils.radToDeg(Math.atan2(-forward.x, -forward.z)))
    if (yaw <= -180) yaw += 360
    const p = vec(pos)
    // Box empties (zones, doors) span ±scale with Blender's default display size of 1.
    const half = new THREE.Vector3(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
    const str = (key: string) => (typeof x[key] === 'string' ? (x[key] as string) : undefined)
    const num = (key: string) => (typeof x[key] === 'number' ? (x[key] as number) : undefined)
    const opt = <T>(key: string, value: T | undefined) =>
      value === undefined ? {} : ({ [key]: value } as Record<string, T>)

    switch (kind) {
      case 'spawn':
        placeholders.playerSpawns.push({ pos: p, yaw })
        break
      case 'zone':
        placeholders.zones.push({
          id,
          bounds: { min: vec(pos.clone().sub(half)), max: vec(pos.clone().add(half)) },
          ...opt('activeAtStart', 'activeAtStart' in x ? flag(x.activeAtStart) : undefined),
        })
        break
      case 'window': {
        const zone = str('zone')
        if (!zone) issues.push({ list: 'windows', id, message: 'needs a "zone" property' })
        placeholders.windows.push({
          id,
          pos: p,
          yaw,
          ...opt('zone', zone),
          ...opt('boards', num('boards')),
          ...opt('width', num('width')),
          ...opt('height', num('height')),
        })
        break
      }
      case 'outside':
        outside.set(id, p)
        break
      case 'door': {
        const connects = str('connects')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (connects?.length !== 2) {
          issues.push({
            list: 'doors',
            id,
            message: 'needs a "connects" property naming two zones, like "start,hall"',
          })
        }
        if (num('cost') === undefined) {
          issues.push({ list: 'doors', id, message: 'needs a "cost" property' })
        }
        placeholders.doors.push({
          id,
          pos: p,
          size: vec(half.clone().multiplyScalar(2)),
          ...opt('cost', num('cost')),
          ...opt('connects', connects),
        })
        break
      }
      case 'wallbuy': {
        const weapon = str('weapon')
        if (!weapon) {
          issues.push({ list: 'wallBuys', id: null, message: `"${id}" needs a "weapon" property` })
        }
        placeholders.wallBuys.push({
          pos: p,
          yaw,
          ...opt('weapon', weapon),
          ...opt('cost', num('cost')),
          ...opt('ammoCost', num('ammoCost')),
        })
        break
      }
      case 'crate':
        placeholders.crateSpots.push({
          id,
          pos: p,
          yaw,
          ...opt('zone', str('zone')),
          ...opt('startsHere', 'startsHere' in x ? flag(x.startsHere) : undefined),
        })
        break
      case 'dummy':
        placeholders.targetDummies.push({ pos: p, yaw })
        break
      case 'lamp':
        placeholders.lamps.push({
          pos: p,
          ...opt('color', str('color')),
          ...opt('intensity', num('intensity')),
          ...opt('range', num('range')),
        })
        break
    }
  }

  for (const w of placeholders.windows) {
    const spawn = outside.get(w.id)
    if (spawn) w.outsideSpawn = spawn
    else {
      issues.push({
        list: 'windows',
        id: w.id,
        message: `has no "outside_${w.id}" empty marking where its zombies spawn`,
      })
    }
  }
  for (const id of outside.keys()) {
    if (!placeholders.windows.some((w) => w.id === id)) {
      issues.push({ list: 'windows', id, message: `"outside_${id}" has no "window_${id}" empty` })
    }
  }
  return { root, colliders, navMeshes, placeholders, issues }
}

/** The mesh's triangles in world space, wound counter-clockwise seen from outside. */
function worldTriangles(mesh: THREE.Mesh): { positions: Float32Array; indices: Uint32Array } {
  const geo = mesh.geometry
  const attr = geo.getAttribute('position')
  const positions = new Float32Array(attr.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld)
    positions[i * 3] = v.x
    positions[i * 3 + 1] = v.y
    positions[i * 3 + 2] = v.z
  }
  const indices = geo.index
    ? Uint32Array.from(geo.index.array)
    : Uint32Array.from({ length: attr.count }, (_, i) => i)
  // A mirrored object (negative scale) flips the winding; flip it back.
  if (mesh.matrixWorld.determinant() < 0) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const tmp = indices[t + 1] ?? 0
      indices[t + 1] = indices[t + 2] ?? 0
      indices[t + 2] = tmp
    }
  }
  return { positions, indices }
}

/**
 * Merges the art's placeholders into a raw map.json object. map.json wins on conflicts:
 * an entity with the same id in map.json replaces the art's entirely, and a non-empty
 * id-less list in map.json (playerSpawns, wallBuys, targetDummies, lighting.lamps)
 * replaces the art's list. Returns the merged object (for `parseMap`) and the art issues
 * that still apply.
 */
export function mergeArt(
  json: Record<string, unknown>,
  art: ArtPlaceholders,
  issues: readonly ArtIssue[],
): { merged: Record<string, unknown>; issues: ArtIssue[] } {
  const merged: Record<string, unknown> = { ...json }
  const remaining: ArtIssue[] = []
  const listOf = (key: string): unknown[] => (Array.isArray(json[key]) ? json[key] : [])

  const byId = ['zones', 'windows', 'doors', 'crateSpots'] as const
  for (const key of byId) {
    const own = listOf(key)
    const ownIds = new Set(own.map((e) => (e as { id?: unknown }).id))
    const fromArt = art[key].filter((e) => !ownIds.has(e.id))
    merged[key] = [...fromArt, ...own]
    for (const issue of issues) {
      if (issue.list === key && issue.id !== null && !ownIds.has(issue.id)) remaining.push(issue)
    }
  }

  const whole = ['playerSpawns', 'wallBuys', 'targetDummies'] as const
  for (const key of whole) {
    const own = listOf(key)
    merged[key] = own.length > 0 ? own : art[key]
    if (own.length === 0) remaining.push(...issues.filter((i) => i.list === key))
  }

  const lighting = (json.lighting ?? {}) as Record<string, unknown>
  const ownLamps = Array.isArray(lighting.lamps) ? lighting.lamps : []
  if (ownLamps.length === 0 && art.lamps.length > 0) {
    merged.lighting = { preset: 'night-dim', ...lighting, lamps: art.lamps }
  }
  return { merged, issues: remaining }
}
