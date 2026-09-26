import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import bunker01 from '../../../public/maps/bunker-01/map.json'
import { Physics } from '../../engine/Physics'
import { buildNavigation, initNavigation, type Navigation } from '../../maps/navmesh'
import { parseMap, type MapDef } from '../../maps/schema'
import { balance } from '../config/balance'
import { HitboxRegistry } from '../entities/hitboxes'
import { createPlayer } from '../entities/Player'
import { Zombie } from '../entities/Zombie'
import { EventBus, type GameEvents } from '../events'
import { BarricadeSystem } from './BarricadeSystem'
import { addSeparation, turnToward, yawFromDirection, ZombieAISystem } from './ZombieAISystem'

const DT = 1 / 60
const t = balance.zombie
const bt = balance.barricade
const noWindows = (events: EventBus<GameEvents>) => new BarricadeSystem([], events, bt)

describe('steering helpers', () => {
  it('yawFromDirection matches the -Z-forward convention', () => {
    expect(yawFromDirection(0, -1)).toBeCloseTo(0)
    expect(yawFromDirection(-1, 0)).toBeCloseTo(Math.PI / 2)
    expect(Math.abs(yawFromDirection(0, 1))).toBeCloseTo(Math.PI)
  })

  it('turnToward takes the short way round and caps the step', () => {
    expect(turnToward(0, 0.1, 1)).toBeCloseTo(0.1)
    expect(turnToward(0, 2, 0.5)).toBeCloseTo(0.5)
    // From just below +π to just above -π is a small turn, not a full spin.
    const next = turnToward(Math.PI - 0.1, -Math.PI + 0.1, 0.05)
    expect(next).toBeCloseTo(Math.PI - 0.05)
  })
})

describe('separation and the zombie AI (real physics + navmesh)', () => {
  let physics: Physics
  let map: MapDef
  let nav: Navigation

  beforeAll(async () => {
    const parsed = parseMap(bunker01)
    if (!parsed.ok) throw new Error(parsed.error)
    map = parsed.map
    ;[physics] = await Promise.all([Physics.create(), initNavigation()])
    nav = buildNavigation(map.brushes, balance.navmesh)
  })

  function makeZombies(n: number) {
    const registry = new HitboxRegistry()
    return Array.from({ length: n }, (_, i) => new Zombie(i, physics, registry, t))
  }

  function spawn(z: Zombie, x: number, zPos: number, speed = t.runSpeed) {
    const p = new THREE.Vector3()
    const ref = nav.closestPoint(new THREE.Vector3(x, 0, zPos), p)
    z.activate(p, ref, 0, balance.rounds.healthBase, speed)
  }

  it('addSeparation pushes overlapping zombies apart and ignores distant ones', () => {
    const [a, b, c] = makeZombies(3) as [Zombie, Zombie, Zombie]
    spawn(a, 0, 0)
    spawn(b, 0.3, 0)
    spawn(c, 5, 0)
    const push = addSeparation(a, [a, b, c], t.separationRadius, new THREE.Vector3())
    expect(push.x).toBeLessThan(0) // away from b, which is to the +x side
    expect(Math.abs(push.z)).toBeLessThan(1e-9)
    const far = addSeparation(c, [a, b, c], t.separationRadius, new THREE.Vector3())
    expect(far.length()).toBe(0)
  })

  it('a zombie in the hall paths to the player in the start room, never entering walls, and attacks', () => {
    const events = new EventBus<GameEvents>()
    let hits = 0
    events.on('playerHit', () => hits++)
    const player = createPlayer({ x: -3, y: 0, z: -4 }, 0) // behind the pillar from the hall
    const zombies = makeZombies(1)
    const ai = new ZombieAISystem(zombies, player, nav, noWindows(events), events, t, bt)
    const z = zombies[0]!
    spawn(z, 14, 0)

    const walls = map.brushes.filter((b) => !b.walkable)
    const insideWall = (p: THREE.Vector3) =>
      walls.some(
        (w) =>
          Math.abs(p.x - w.pos[0]) < w.size[0] / 2 - 0.02 &&
          Math.abs(p.z - w.pos[2]) < w.size[2] / 2 - 0.02 &&
          // Body (feet to 1.8 m) overlaps the wall vertically; the lintel above the door does not.
          p.y < w.pos[1] + w.size[1] / 2 &&
          p.y + 1.8 > w.pos[1] - w.size[1] / 2,
      )

    let reachedAt = -1
    for (let step = 0; step < 60 * 30 && hits === 0; step++) {
      ai.update(DT)
      physics.step(DT)
      expect(insideWall(z.position)).toBe(false)
      if (reachedAt < 0 && z.state === 'attacking') reachedAt = step * DT
    }
    expect(reachedAt).toBeGreaterThan(0)
    expect(z.position.distanceTo(player.position)).toBeLessThanOrEqual(t.attackRange + 0.05)
    expect(hits).toBe(1)
  })

  it('a group of zombies spreads out instead of stacking on the player', () => {
    const events = new EventBus<GameEvents>()
    const player = createPlayer({ x: 0, y: 0, z: 3 }, 0)
    const zombies = makeZombies(6)
    const ai = new ZombieAISystem(zombies, player, nav, noWindows(events), events, t, bt)
    zombies.forEach((z, i) => spawn(z, 12 + (i % 3) * 0.1, (i - 3) * 0.1))
    for (let step = 0; step < 60 * 20; step++) {
      ai.update(DT)
      physics.step(DT)
    }
    let minGap = Infinity
    for (const a of zombies) {
      for (const b of zombies) {
        if (a !== b) minGap = Math.min(minGap, a.position.distanceTo(b.position))
      }
    }
    expect(minGap).toBeGreaterThan(0.3)
  })

  it('dead zombies return to the pool after the corpse delay', () => {
    const events = new EventBus<GameEvents>()
    const player = createPlayer({ x: 0, y: 0, z: 3 }, 0)
    const [z] = makeZombies(1) as [Zombie]
    const ai = new ZombieAISystem([z], player, nav, noWindows(events), events, t, bt)
    spawn(z, 12, 0)
    expect(z.applyDamage(balance.rounds.healthBase)).toBe(true)
    expect(z.alive).toBe(false)
    expect(z.active).toBe(true)
    for (let i = 0; i < Math.ceil(t.corpseTime / DT) + 1; i++) ai.update(DT)
    expect(z.active).toBe(false)
  })
})
