import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import bunker01 from '../../public/maps/bunker-01/map.json'
import twinGlb from '../../public/maps/bunker-01-art/level.glb?inline'
import twinJson from '../../public/maps/bunker-01-art/map.json'
import {
  CollisionGroup,
  createRayHit,
  interactionGroups,
  Physics,
  type RayHit,
} from '../engine/Physics'
import { createRng } from '../engine/rng'
import { balance } from '../game/config/balance'
import { HitboxRegistry } from '../game/entities/hitboxes'
import { createPlayer } from '../game/entities/Player'
import { Zombie } from '../game/entities/Zombie'
import { ZoneState } from '../game/entities/Zones'
import { EventBus, type GameEvents } from '../game/events'
import { BarricadeSystem } from '../game/systems/BarricadeSystem'
import { DoorSystem } from '../game/systems/DoorSystem'
import { PointsSystem } from '../game/systems/PointsSystem'
import { RoundSystem } from '../game/systems/RoundSystem'
import { SpawnSystem } from '../game/systems/SpawnSystem'
import { ZombieAISystem } from '../game/systems/ZombieAISystem'
import { extractArt, mergeArt, type ArtScene } from './art'
import { buildMapWorld, type MapSource } from './MapLoader'
import { initNavigation } from './navmesh'
import { parseMap } from './schema'

/*
 * The milestone 9 check: bunker-01-art is bunker-01 authored in Blender
 * (tools/blender/build_twin.py) and exported to level.glb. Loaded through the art route,
 * it must play exactly like the JSON original.
 */

/** Parses a .glb imported with `?inline` (a base64 data URL). */
async function loadArt(dataUrl: string): Promise<ArtScene> {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) =>
    c.charCodeAt(0),
  )
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '')
  return extractArt(gltf.scene)
}

let json: MapSource
let twin: MapSource

beforeAll(async () => {
  await initNavigation()
  const parsedJson = parseMap(bunker01)
  if (!parsedJson.ok) throw new Error(parsedJson.error)
  json = { def: parsedJson.map, art: null }

  const art = await loadArt(twinGlb)
  const { merged, issues } = mergeArt(twinJson, art.placeholders, art.issues)
  expect(issues).toEqual([])
  const parsedTwin = parseMap(merged)
  if (!parsedTwin.ok) throw new Error(parsedTwin.error)
  twin = { def: parsedTwin.map, art }
})

describe('Blender twin of bunker-01', () => {
  it('reads every entity from the empties exactly as map.json defines it', () => {
    const keys = [
      'playerSpawns',
      'zones',
      'windows',
      'doors',
      'wallBuys',
      'crateSpots',
      'targetDummies',
    ] as const
    for (const key of keys) expect(twin.def[key], key).toEqual(json.def[key])
    expect(twin.def.lighting).toEqual(json.def.lighting)
    // Geometry comes from meshes, not brushes.
    expect(twin.def.brushes).toEqual([])
    expect(twin.art!.colliders).toHaveLength(json.def.brushes.length)
    const walkable = json.def.brushes.filter((b) => b.walkable).length
    expect(twin.art!.navMeshes.filter((m) => m.walkable)).toHaveLength(walkable)
  })

  it('is solid in exactly the same places (rays from all over the map)', async () => {
    const [a, b] = await Promise.all([Physics.create(), Physics.create()])
    buildMapWorld(json, a).dispose()
    buildMapWorld(twin, b).dispose()
    a.syncQueries()
    b.syncQueries()
    const groups = interactionGroups(CollisionGroup.SHOT, CollisionGroup.WORLD)
    const hitA = createRayHit()
    const hitB = createRayHit()
    const insideBrush = (p: THREE.Vector3) =>
      json.def.brushes.some((br) =>
        [0, 1, 2].every((k) => Math.abs(p.getComponent(k) - br.pos[k]!) < br.size[k]! / 2 + 0.01),
      )
    const dirs = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2
      return new THREE.Vector3(Math.cos(a), i % 3 === 0 ? -0.3 : 0.1, Math.sin(a)).normalize()
    })
    dirs.push(new THREE.Vector3(0, -1, 0))
    const describeHit = (hit: boolean, h: RayHit) => (hit ? Math.round(h.distance * 1000) : null)

    let rays = 0
    for (let x = -9; x <= 19; x += 0.7) {
      for (let z = -9; z <= 9; z += 0.7) {
        for (const y of [0.3, 1.1, 2.4]) {
          const from = new THREE.Vector3(x, y, z)
          if (insideBrush(from)) continue
          for (const dir of dirs) {
            const ha = describeHit(a.castRay(from, dir, 30, groups, hitA), hitA)
            const hb = describeHit(b.castRay(from, dir, 30, groups, hitB), hitB)
            if (ha !== null && hb !== null) expect(Math.abs(ha - hb)).toBeLessThanOrEqual(1)
            else expect([x, y, z, ha, hb]).toEqual([x, y, z, ha, ha])
            rays++
          }
        }
      }
    }
    expect(rays).toBeGreaterThan(20_000)
  })

  it('builds the same navmesh: same window anchors and the same paths, doors shut and open', async () => {
    const [a, b] = await Promise.all([Physics.create(), Physics.create()])
    const wa = buildMapWorld(json, a)
    const wb = buildMapWorld(twin, b)
    wa.windows.forEach((w, i) => {
      const v = wb.windows[i]!
      expect(v.id).toBe(w.id)
      for (const k of ['outsideStand', 'insideLand', 'spawnPoint'] as const) {
        expect(v.anchors[k].distanceTo(w.anchors[k]), `${w.id} ${k}`).toBeLessThan(0.01)
      }
    })

    const points: THREE.Vector3[] = []
    for (let x = -8; x <= 18; x += 2.5)
      for (let z = -8; z <= 8; z += 2.5) points.push(new THREE.Vector3(x, 0, z))
    const pathA = Array.from({ length: 64 }, () => new THREE.Vector3())
    const pathB = Array.from({ length: 64 }, () => new THREE.Vector3())
    const comparePaths = () => {
      let compared = 0
      for (const from of points) {
        for (const to of points) {
          const na = wa.nav.findPath(from, to, pathA)
          const nb = wb.nav.findPath(from, to, pathB)
          expect(nb).toBe(na)
          for (let i = 0; i < na; i++) expect(pathB[i]!.distanceTo(pathA[i]!)).toBeLessThan(0.01)
          compared++
        }
      }
      return compared
    }
    expect(comparePaths()).toBeGreaterThan(1000)
    // Every door open: rebuilds include the art meshes too.
    wa.nav.rebuild(wa.navObstacles, balance.navmesh)
    wb.nav.rebuild(wb.navObstacles, balance.navmesh)
    comparePaths()
    wa.dispose()
    wb.dispose()
  })

  it('plays identically: same seed, same scripted session, same zombies doing the same things', async () => {
    const play = async (source: MapSource) => {
      const physics = await Physics.create()
      const world = buildMapWorld(source, physics)
      const events = new EventBus<GameEvents>()
      const log: string[] = []
      events.on('boardTorn', (e) => log.push(`torn ${e.windowId} ${e.boards}`))
      events.on('playerHit', () => log.push('playerHit'))
      events.on('roundStarted', (e) => log.push(`round ${e.round}`))
      events.on('zoneActivated', (e) => log.push(`zone ${e.zoneId}`))
      const rng = createRng(1234)
      const spawn = source.def.playerSpawns[0]!
      const player = createPlayer(new THREE.Vector3(...spawn.pos), 0)
      const zones = new ZoneState(source.def.zones)
      const points = new PointsSystem(events, balance.points)
      const doors = new DoorSystem(
        world.doors,
        zones,
        world.nav,
        world.navObstacles,
        physics,
        points,
        events,
        balance.navmesh,
        balance.purchases,
      )
      const barricades = new BarricadeSystem(world.windows, events, balance.barricade)
      const registry = new HitboxRegistry()
      const zombies = Array.from(
        { length: balance.zombie.maxAlive },
        (_, i) => new Zombie(i, physics, registry, balance.zombie),
      )
      const ai = new ZombieAISystem(
        zombies,
        player,
        world.nav,
        barricades,
        events,
        balance.zombie,
        balance.barricade,
      )
      const spawner = new SpawnSystem(zombies, world.windows, zones, world.nav, rng, balance.zombie)
      const rounds = new RoundSystem(spawner, events, balance.rounds, balance.zombie.maxAlive)

      const frames: string[] = []
      const dt = 1 / 60
      for (let step = 0; step < 60 * 70; step++) {
        if (step === 60) {
          // Buy the hall door before round 1: its windows join in, and the navmesh is rebuilt
          // (for the twin, from the art meshes).
          points.grant(1000)
          expect(doors.tryOpen(world.doors[0]!)).toBe(true)
        }
        doors.update(dt)
        rounds.update(dt)
        ai.update(dt)
        physics.step(dt)
        if (step % 30 === 0) {
          const f = (n: number) => n.toFixed(2)
          frames.push(
            zombies
              .filter((z) => z.active)
              .map(
                (z) =>
                  `${z.index}:${z.state}@${f(z.position.x)},${f(z.position.y)},${f(z.position.z)}`,
              )
              .join(' '),
          )
        }
      }
      world.dispose()
      return { frames, log }
    }

    const a = await play(json)
    const b = await play(twin)
    expect(a.log.filter((l) => l === 'playerHit').length).toBeGreaterThan(0)
    expect(a.log).toContain('zone hall')
    expect(a.log.some((l) => l.startsWith('torn hall'))).toBe(true)
    expect(b.log).toEqual(a.log)
    expect(b.frames).toEqual(a.frames)
  })
})
