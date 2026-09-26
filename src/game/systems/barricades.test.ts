import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import bunker01 from '../../../public/maps/bunker-01/map.json'
import { Physics } from '../../engine/Physics'
import { createRng } from '../../engine/rng'
import { resolveWindowAnchors } from '../../maps/MapLoader'
import { buildNavigation, initNavigation, type Navigation } from '../../maps/navmesh'
import { parseMap, type MapDef } from '../../maps/schema'
import { balance } from '../config/balance'
import { HitboxRegistry } from '../entities/hitboxes'
import { createPlayer, type Player } from '../entities/Player'
import { SpawnWindow } from '../entities/SpawnWindow'
import { Zombie } from '../entities/Zombie'
import { ZoneState } from '../entities/Zones'
import { EventBus, type GameEvents } from '../events'
import { BarricadeSystem } from './BarricadeSystem'
import { InteractSystem } from './InteractSystem'
import { PointsSystem } from './PointsSystem'
import { SpawnSystem } from './SpawnSystem'
import { ZombieAISystem } from './ZombieAISystem'

const DT = 1 / 60
const bt = balance.barricade
const zt = balance.zombie
const HEALTH = balance.rounds.healthBase

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

/** Interior of bunker-01: the start room and the hall. */
function insideBuilding(p: THREE.Vector3): boolean {
  const inStart = Math.abs(p.x) < 6 && Math.abs(p.z) < 6
  const inHall = p.x > 6 && p.x < 16 && Math.abs(p.z) < 4
  return inStart || inHall
}

function setup(windowId: string, player: Player, poolSize = 4) {
  const events = new EventBus<GameEvents>()
  const def = map.windows.find((w) => w.id === windowId)
  if (!def) throw new Error(`no window ${windowId}`)
  const w = new SpawnWindow(def, resolveWindowAnchors(def, nav, bt), physics)
  const barricades = new BarricadeSystem([w], events, bt)
  const registry = new HitboxRegistry()
  const zombies = Array.from({ length: poolSize }, (_, i) => new Zombie(i, physics, registry, zt))
  const ai = new ZombieAISystem(zombies, player, nav, barricades, events, zt, bt)
  const spawner = new SpawnSystem(zombies, [w], new ZoneState(map.zones), nav, createRng(7), zt)
  const step = () => {
    ai.update(DT)
    physics.step(DT)
  }
  return { events, w, barricades, zombies, ai, spawner, step }
}

describe('window anchors', () => {
  it('every bunker-01 window resolves spawn, stand and landing points', () => {
    for (const def of map.windows) {
      const a = resolveWindowAnchors(def, nav, bt)
      expect(insideBuilding(a.outsideStand)).toBe(false)
      expect(insideBuilding(a.insideLand)).toBe(true)
      expect(insideBuilding(a.spawnPoint)).toBe(false)
    }
  })

  it('rejects a window whose inside and outside are connected (sill missing)', () => {
    const noSill = map.brushes.filter(
      (b) => !(b.pos[0] === -6.15 && b.pos[1] === 0.45 && b.pos[2] === 0),
    )
    expect(noSill.length).toBe(map.brushes.length - 1)
    const leaky = buildNavigation(noSill, balance.navmesh)
    const def = map.windows.find((w) => w.id === 'start-west')!
    expect(() => resolveWindowAnchors(def, leaky, bt)).toThrow(/connected/)
    leaky.dispose()
  })
})

describe('zombies and windows', () => {
  it('a zombie tears all 6 boards, only then climbs in, then chases and hits the player', () => {
    const player = createPlayer({ x: 0, y: 0, z: 3 }, 0)
    const { events, w, spawner, zombies, step } = setup('start-west', player)
    const torn: number[] = []
    let hits = 0
    events.on('boardTorn', (e) => torn.push(e.boards))
    events.on('playerHit', () => hits++)

    const z = spawner.spawnAt(w, HEALTH, 0)!
    expect(z).toBe(zombies[0])
    const states = new Set<string>()
    for (let i = 0; i < 60 * 40 && hits === 0; i++) {
      step()
      states.add(z.state)
      if (torn.length < w.maxBoards) expect(insideBuilding(z.position)).toBe(false)
    }
    expect(torn).toEqual([5, 4, 3, 2, 1, 0])
    expect([...states]).toEqual(
      expect.arrayContaining([
        'approachWindow',
        'tearingBoards',
        'entering',
        'chasing',
        'attacking',
      ]),
    )
    expect(hits).toBe(1)
    expect(w.climber).toBeNull()
  })

  it('tearing takes tearInterval per board', () => {
    const player = createPlayer({ x: 0, y: 0, z: 3 }, 0)
    const { events, w, spawner, step } = setup('start-west', player)
    const times: number[] = []
    let steps = 0
    events.on('boardTorn', () => times.push(steps * DT))
    spawner.spawnAt(w, HEALTH, 0)
    for (; steps < 60 * 30 && times.length < 6; steps++) step()
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeCloseTo(bt.tearInterval, 1)
    }
  })

  it('only one zombie climbs through a window at a time', () => {
    const player = createPlayer({ x: 0, y: 0, z: 3 }, 0)
    const { w, spawner, zombies, step } = setup('start-south', player)
    w.boards = 0
    spawner.spawnAt(w, HEALTH, 0)
    spawner.spawnAt(w, HEALTH, 0)
    spawner.spawnAt(w, HEALTH, 0)
    let maxClimbing = 0
    for (let i = 0; i < 60 * 30; i++) {
      step()
      const climbing = zombies.filter((z) => z.state === 'entering').length
      maxClimbing = Math.max(maxClimbing, climbing)
    }
    expect(maxClimbing).toBe(1)
    const inside = zombies.filter((z) => z.active && insideBuilding(z.position)).length
    expect(inside).toBe(3)
  })

  it('a zombie at the window swipes at a player repairing right behind it', () => {
    // Player pressed up against the inside of the west window.
    const player = createPlayer({ x: -5.65, y: 0, z: 0 }, Math.PI / 2)
    const { events, w, spawner, step } = setup('start-west', player)
    let hits = 0
    events.on('playerHit', () => hits++)
    spawner.spawnAt(w, HEALTH, 0)
    for (let i = 0; i < 60 * 20 && hits === 0; i++) step()
    expect(hits).toBe(1)
    expect(w.boards).toBeGreaterThan(0) // swiped before getting in
  })
})

describe('repairing', () => {
  function repairSetup(yaw: number) {
    // Just inside the west window; yaw π/2 faces it (-X).
    const player = createPlayer({ x: -5.2, y: 0, z: 0 }, yaw)
    const { events, w, barricades } = setup('start-west', player)
    const points = new PointsSystem(events, balance.points)
    let holding = true
    const input = { isDown: (a: string) => holding && a === 'interact' }
    const interact = new InteractSystem(player, input)
    for (const item of barricades.createInteractables()) interact.add(item)
    const hold = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) interact.update(DT)
    }
    const setHolding = (v: boolean) => (holding = v)
    return { w, points, interact, hold, setHolding }
  }

  it('holding interact rebuilds one board per repairInterval and awards points', () => {
    const { w, points, interact, hold } = repairSetup(Math.PI / 2)
    w.boards = 2
    hold(0.1)
    expect(interact.prompt).toBe('Hold F to rebuild barrier')
    hold(bt.repairInterval * 2 - 0.1 + DT)
    expect(w.boards).toBe(4)
    expect(points.points).toBe(balance.points.starting + 2 * balance.points.boardRepaired)
    hold(bt.repairInterval * 3)
    expect(w.boards).toBe(6)
    expect(interact.prompt).toBeNull()
  })

  it('does nothing when the player looks away', () => {
    const { w, points, interact, hold } = repairSetup(-Math.PI / 2)
    w.boards = 2
    hold(3)
    expect(interact.prompt).toBeNull()
    expect(w.boards).toBe(2)
    expect(points.points).toBe(balance.points.starting)
  })

  it('letting go resets partial progress', () => {
    const { w, hold, setHolding } = repairSetup(Math.PI / 2)
    w.boards = 2
    hold(bt.repairInterval * 0.9)
    setHolding(false)
    hold(DT)
    setHolding(true)
    hold(bt.repairInterval * 0.9)
    // 1.8 intervals of holding in total, but never 1 interval in one go.
    expect(w.boards).toBe(2)
  })
})

describe('PointsSystem', () => {
  it('caps repair points per round and resets on startRound', () => {
    const events = new EventBus<GameEvents>()
    const points = new PointsSystem(events, balance.points)
    const p = balance.points
    for (let i = 0; i < 100; i++) events.emit('boardRepaired', { windowId: 'x', boards: 1 })
    expect(points.points).toBe(p.starting + p.repairCapPerRound)
    events.emit('roundStarted', { round: 2, zombies: 10 })
    events.emit('boardRepaired', { windowId: 'x', boards: 1 })
    expect(points.points).toBe(p.starting + p.repairCapPerRound + p.boardRepaired)
  })
})
