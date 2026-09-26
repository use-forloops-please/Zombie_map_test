import * as THREE from 'three'
import { evictGltf, loadGltf } from '../engine/Assets'
import type { Physics } from '../engine/Physics'
import { balance, type BarricadeTuning } from '../game/config/balance'
import type { HitboxRegistry } from '../game/entities/hitboxes'
import { Crate } from '../game/entities/Crate'
import { Door } from '../game/entities/Door'
import { SpawnWindow, type WindowAnchors } from '../game/entities/SpawnWindow'
import { createWallBuy, type WallBuy } from '../game/entities/WallBuy'
import { TargetDummy } from '../game/entities/TargetDummy'
import { extractArt, mergeArt, type ArtScene } from './art'
import { buildBrushMesh, createBrushMaterials } from './brushes'
import { lightingPresets } from './lighting'
import { buildNavigation, type Navigation } from './navmesh'
import {
  crateSpotAsBrush,
  doorAsBrush,
  parseMap,
  type BrushDef,
  type LightingDef,
  type MapDef,
  type WindowDef,
} from './schema'

/** A map failed to fetch or validate. The message is shown to the player as-is. */
export class MapLoadError extends Error {
  override name = 'MapLoadError'
}

/** A validated map plus its art, ready for `buildMap`. */
export interface MapSource {
  readonly def: MapDef
  /** The map's level.glb (collision, navmesh input, visuals), or null for a JSON-only map. */
  readonly art: ArtScene | null
}

const ART_FILE = /^[\w-]+\.glb$/

/**
 * Fetches `maps/<mapId>/map.json` and, if it names one, its art file. Placeholders from the
 * art are merged in (map.json wins on conflicts) before validation. Throws MapLoadError
 * with a readable message for anything wrong.
 */
export async function fetchMap(mapId: string): Promise<MapSource> {
  const url = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}/map.json`
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new MapLoadError(`Could not fetch map "${mapId}" from ${url}: ${String(err)}`)
  }
  if (!res.ok) {
    throw new MapLoadError(`Map "${mapId}" not found (${url} returned HTTP ${res.status}).`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (err) {
    throw new MapLoadError(`Map "${mapId}" is not valid JSON: ${String(err)}`)
  }
  return mapSourceFromJson(json, mapId)
}

/**
 * Turns map.json data already in hand (fetched, or handed over by the editor's play test)
 * into a MapSource: loads its art from `maps/<mapId>/` if it names any, merges the art's
 * placeholders, and validates. Throws MapLoadError with a readable message.
 */
export async function mapSourceFromJson(json: unknown, mapId: string): Promise<MapSource> {
  const folder = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}/`
  let art: ArtScene | null = null
  const artFile = isRecord(json) && typeof json.art === 'string' ? json.art : null
  // A malformed file name is left for validation to report.
  if (isRecord(json) && artFile && ART_FILE.test(artFile)) {
    const artUrl = folder + artFile
    try {
      art = extractArt((await loadGltf(artUrl)).scene)
    } catch (err) {
      throw new MapLoadError(
        `Map "${mapId}": could not load its art "${artFile}": ${String(err)}`,
        {
          cause: err,
        },
      )
    } finally {
      // Each game gets its own copy: the map owns (and disposes) what it builds from it.
      evictGltf(artUrl)
    }
    const { merged, issues } = mergeArt(json, art.placeholders, art.issues)
    if (issues.length > 0) {
      const lines = issues.map(
        (i) => `- ${i.list}${i.id === null ? '' : ` "${i.id}"`}: ${i.message}`,
      )
      throw new MapLoadError(
        `Map "${mapId}": placeholders in ${artFile} have problems:\n${lines.join('\n')}`,
      )
    }
    if (art.colliders.length === 0 && (!Array.isArray(json.brushes) || json.brushes.length === 0)) {
      throw new MapLoadError(
        `Map "${mapId}": ${artFile} has no meshes with "collide" set and map.json has no brushes, so there is nothing to stand on.`,
      )
    }
    json = merged
  }

  const parsed = parseMap(json)
  if (!parsed.ok) throw new MapLoadError(`Map "${mapId}" failed validation:\n${parsed.error}`)
  if (parsed.map.id !== mapId) {
    throw new MapLoadError(`Map folder "${mapId}" contains a map.json with id "${parsed.map.id}".`)
  }
  return { def: parsed.map, art }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface LoadedMap extends MapWorld {
  readonly def: MapDef
  /** World-space bounds of everything drawn. */
  readonly bounds: THREE.Box3
  readonly dummies: readonly TargetDummy[]
  dispose(): void
}

/** The simulation side of a map: colliders, navmesh and entities. No rendering, no DOM. */
export interface MapWorld {
  readonly windows: readonly SpawnWindow[]
  readonly doors: readonly Door[]
  readonly wallBuys: readonly WallBuy[]
  /** The supply crate, if the map has crate spots. */
  readonly crate: Crate | null
  /** Permanent navmesh obstacles: brushes plus every crate spot (doors are handled separately). */
  readonly navObstacles: readonly BrushDef[]
  /** Navmesh with every door closed; DoorSystem rebuilds it as doors open. */
  readonly nav: Navigation
  dispose(): void
}

/**
 * Builds everything that affects play: static colliders for brushes and `collide` art
 * meshes, the navmesh (brushes, crate spots, closed doors and art), window anchors, doors,
 * wall-buys and the crate. A JSON map and its Blender twin go through exactly this code.
 * Call `initNavigation()` first. Throws MapLoadError if the navmesh can't be built or a
 * window's navmesh anchors are invalid.
 */
export function buildMapWorld({ def, art }: MapSource, physics: Physics): MapWorld {
  for (const brush of def.brushes) {
    const [sx, sy, sz] = brush.size
    physics.addStaticBox(brush.pos, [sx / 2, sy / 2, sz / 2])
  }
  for (const c of art?.colliders ?? []) physics.addStaticTrimesh(c.positions, c.indices)
  const artNav = art?.navMeshes ?? []

  const navObstacles = [...def.brushes, ...def.crateSpots.map(crateSpotAsBrush)]
  let nav: Navigation | undefined
  let allDoorsOpen: Navigation | undefined
  let anchors: WindowAnchors[]
  try {
    nav = buildNavigation([...navObstacles, ...def.doors.map(doorAsBrush)], balance.navmesh, artNav)
    const closedNav = nav
    anchors = def.windows.map((w) => resolveWindowAnchors(w, closedNav, balance.barricade))
    if (def.doors.length > 0) {
      // Opening doors must never let zombies walk in without climbing through a window.
      allDoorsOpen = buildNavigation(navObstacles, balance.navmesh, artNav)
      const openNav = allDoorsOpen
      for (const w of def.windows) {
        try {
          resolveWindowAnchors(w, openNav, balance.barricade)
        } catch (err) {
          throw new Error(`with every door open, ${err instanceof Error ? err.message : err}`, {
            cause: err,
          })
        }
      }
    }
  } catch (err) {
    nav?.dispose()
    throw new MapLoadError(`Map "${def.id}": ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    })
  } finally {
    allDoorsOpen?.dispose()
  }
  const builtNav = nav

  const windows = def.windows.map((w, i) => {
    const a = anchors[i]
    if (!a) throw new MapLoadError(`Map "${def.id}": window "${w.id}" has no anchors`)
    return new SpawnWindow(w, a, physics)
  })
  const doors = def.doors.map((d) => new Door(d, physics))
  const wallBuys = def.wallBuys.map(createWallBuy)
  const firstSpot = def.crateSpots.find((s) => s.startsHere) ?? def.crateSpots[0]
  const crate = firstSpot ? new Crate(firstSpot, physics) : null

  return {
    windows,
    doors,
    wallBuys,
    crate,
    navObstacles,
    nav: builtNav,
    dispose() {
      for (const d of doors) d.dispose(physics)
      for (const w of windows) w.dispose(physics)
      builtNav.dispose()
    },
  }
}

/**
 * Builds a validated map: its world (see `buildMapWorld`) plus everything drawn: brush
 * meshes, art, lighting and target dummies.
 */
export function buildMap(
  source: MapSource,
  scene: THREE.Scene,
  physics: Physics,
  hitboxes: HitboxRegistry,
): LoadedMap {
  const { def, art } = source
  const world = buildMapWorld(source, physics)

  const root = new THREE.Group()
  root.name = `map:${def.id}`
  const materials = createBrushMaterials()
  const bounds = new THREE.Box3()
  for (const brush of def.brushes) {
    const mesh = buildBrushMesh(brush, materials)
    root.add(mesh)
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    if (box) bounds.union(box.clone().translate(mesh.position))
  }
  if (art) {
    art.root.traverse((obj) => {
      obj.userData.fromArt = true
    })
    root.add(art.root)
    bounds.expandByObject(art.root)
  }
  scene.add(root)

  const lights = applyLighting(def.lighting, scene, bounds)

  const dummies = def.targetDummies.map(
    (d) =>
      new TargetDummy(
        d.pos,
        THREE.MathUtils.degToRad(d.yaw),
        scene,
        physics,
        hitboxes,
        balance.targetDummy,
      ),
  )

  return {
    ...world,
    def,
    bounds,
    dummies,
    dispose() {
      world.dispose()
      for (const d of dummies) d.dispose(scene)
      scene.remove(root, ...lights)
      scene.fog = null
      disposeMeshes(root)
      materials.dispose()
      for (const obj of lights) {
        if (obj instanceof THREE.DirectionalLight) obj.shadow.dispose()
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
      }
    },
  }
}

/** Frees geometry, and any materials and textures that came with the art. */
function disposeMeshes(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.geometry.dispose()
    if (obj.userData.fromArt !== true) return
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      for (const value of Object.values(m as THREE.Material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      ;(m as THREE.Material).dispose()
    }
  })
}

/**
 * Finds where a window's zombies spawn, stand while tearing, and land inside, all on the
 * navmesh. Throws if a point can't be found, or if the inside and outside connect without
 * the window (zombies would walk in without climbing).
 */
export function resolveWindowAnchors(
  w: WindowDef,
  nav: Navigation,
  t: BarricadeTuning,
): WindowAnchors {
  const yaw = THREE.MathUtils.degToRad(w.yaw)
  const outward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
  const sillY = w.pos[1] - w.height / 2
  const probe = (offset: number) =>
    new THREE.Vector3(w.pos[0], sillY, w.pos[2]).addScaledVector(outward, offset)

  const snap = (p: THREE.Vector3, what: string) => {
    const out = new THREE.Vector3()
    const ref = nav.closestPoint(p, out)
    const gap = Math.hypot(out.x - p.x, out.z - p.z)
    if (ref === 0 || gap > 0.75) {
      throw new Error(
        `window "${w.id}": no walkable ground ${what} (near ${p.x.toFixed(2)}, ${p.z.toFixed(2)})`,
      )
    }
    return { point: out, ref }
  }

  const outside = snap(probe(t.outsideStandOffset), 'outside the opening')
  const inside = snap(probe(-t.insideLandOffset), 'inside the opening')
  const spawn = snap(new THREE.Vector3(...w.outsideSpawn), 'at outsideSpawn')

  const path = Array.from({ length: 128 }, () => new THREE.Vector3())
  const n = nav.findPath(outside.point, inside.point, path)
  const end = path[n - 1]
  if (end && end.distanceTo(inside.point) < 0.5) {
    throw new Error(
      `window "${w.id}": the ground inside and outside are connected, so zombies could walk in ` +
        `without climbing through. Raise the sill or close the gap in the walls.`,
    )
  }
  const reachable = nav.findPath(spawn.point, outside.point, path)
  const reached = path[reachable - 1]
  if (!reached || reached.distanceTo(outside.point) > 0.5) {
    throw new Error(`window "${w.id}": outsideSpawn can't reach the window`)
  }

  return {
    outsideStand: outside.point,
    insideLand: inside.point,
    spawnPoint: spawn.point,
  }
}

/**
 * Sets up the preset's fill and shadow-casting key light, fog (the map's, or the preset's
 * default), and the map's lamps. Returns everything it added to the scene.
 */
function applyLighting(
  lighting: LightingDef,
  scene: THREE.Scene,
  bounds: THREE.Box3,
): THREE.Object3D[] {
  const preset = lightingPresets[lighting.preset]
  const fog = lighting.fog ?? preset.fog
  scene.background = new THREE.Color(fog.color)
  scene.fog = new THREE.Fog(fog.color, fog.near, fog.far)

  const hemi = new THREE.HemisphereLight(preset.hemi.sky, preset.hemi.ground, preset.hemi.intensity)
  const key = new THREE.DirectionalLight(preset.key.color, preset.key.intensity)
  fitShadowToBounds(key, bounds, new THREE.Vector3(...preset.key.dir))
  const added: THREE.Object3D[] = [hemi, key, key.target]

  for (const lamp of lighting.lamps) {
    const light = new THREE.PointLight(lamp.color, lamp.intensity, lamp.range, 2)
    light.position.set(...lamp.pos)
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: lamp.color }),
    )
    bulb.position.copy(light.position)
    added.push(light, bulb)
  }
  scene.add(...added)
  return added
}

/** Points a directional light along `dir` at the map centre and sizes its shadow camera to cover the map. */
function fitShadowToBounds(
  light: THREE.DirectionalLight,
  bounds: THREE.Box3,
  dir: THREE.Vector3,
): void {
  const center = bounds.getCenter(new THREE.Vector3())
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius
  light.target.position.copy(center)
  light.position.copy(center).addScaledVector(dir.normalize(), radius * 2)
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.bias = -0.0005
  light.shadow.normalBias = 0.02
  const cam = light.shadow.camera
  cam.left = -radius
  cam.right = radius
  cam.top = radius
  cam.bottom = -radius
  cam.near = 0.1
  cam.far = radius * 4
  cam.updateProjectionMatrix()
}
