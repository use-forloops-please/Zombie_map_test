import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import bunker01 from '../../../public/maps/bunker-01/map.json'
import { CollisionGroup, createRayHit, interactionGroups, Physics } from '../../engine/Physics'
import { createRng } from '../../engine/rng'
import { resolveWindowAnchors } from '../../maps/MapLoader'
import { buildNavigation, initNavigation, type Navigation } from '../../maps/navmesh'
import { doorAsBrush, parseMap, type MapDef } from '../../maps/schema'
import { balance } from '../config/balance'
import { Door } from '../entities/Door'
import { HitboxRegistry } from '../entities/hitboxes'
import { createPlayer } from '../entities/Player'
import { SpawnWindow } from '../entities/SpawnWindow'
import { createWallBuy } from '../entities/WallBuy'
import { Zombie } from '../entities/Zombie'
import { ZoneState } from '../entities/Zones'
import { EventBus, type GameEvents } from '../events'
import { BarricadeSystem } from './BarricadeSystem'
import { DoorSystem } from './DoorSystem'
import { PointsSystem } from './PointsSystem'
import { SpawnSystem } from './SpawnSystem'
import { WallBuySystem } from './WallBuySystem'
import { WeaponSystem } from './WeaponSystem'
import { ZombieAISystem } from './ZombieAISystem'

const DT = 1 / 60
let map: MapDef

beforeAll(async () => {
  const parsed = parseMap(bunker01)
  if (!parsed.ok) throw new Error(parsed.error)
  map = parsed.map
  await initNavigation()
})

/** A fresh bunker-01 world: brushes, closed doors, navmesh, windows, zones, points. */
async function world() {
  const physics = await Physics.create()
  for (const b of map.brushes) {
    physics.addStaticBox(b.pos, [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2])
  }
  const nav: Navigation = buildNavigation(
    [...map.brushes, ...map.doors.map(doorAsBrush)],
    balance.navmesh,
  )
  const events = new EventBus<GameEvents>()
  const zones = new ZoneState(map.zones)
  const points = new PointsSystem(events, balance.points)
  const doors = map.doors.map((d) => new Door(d, physics))
  const doorSystem = new DoorSystem(
    doors,
    zones,
    nav,
    map.brushes,
    physics,
    points,
    events,
    balance.navmesh,
    balance.purchases,
  )
  const windows = map.windows.map(
    (w) => new SpawnWindow(w, resolveWindowAnchors(w, nav, balance.barricade), physics),
  )
  physics.syncQueries()
  const log: string[] = []
  events.on('doorOpened', (e) => log.push(`door ${e.doorId}`))
  events.on('zoneActivated', (e) => log.push(`zone ${e.zoneId}`))
  events.on('navmeshRebuilt', () => log.push('navmesh'))
  const door = doors[0]!
  return { physics, nav, events, zones, points, doors, door, doorSystem, windows, log }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function reaches(nav: Navigation, from: THREE.Vector3, to: THREE.Vector3): boolean {
  const out = Array.from({ length: 64 }, () => new THREE.Vector3())
  const n = nav.findPath(from, to, out)
  return n > 0 && out[n - 1]!.distanceTo(to) < 0.5
}

const SHOT = interactionGroups(CollisionGroup.SHOT, CollisionGroup.WORLD | CollisionGroup.HITBOX)

function shotThroughDoorway(physics: Physics): boolean {
  const hit = createRayHit()
  // From the start room, straight through the doorway toward the hall's east wall (x = 16).
  const blocked = physics.castRay(v(3, 1.2, 0), v(1, 0, 0), 20, SHOT, hit)
  return blocked && hit.point.x > 15
}

describe('doors', () => {
  it('a closed door blocks bullets and zombie paths; zones start with only "start" active', async () => {
    const { physics, nav, zones } = await world()
    expect(reaches(nav, v(0, 0, 3), v(12, 0, 0))).toBe(false)
    expect(shotThroughDoorway(physics)).toBe(false)
    expect(zones.activeIds).toEqual(['start'])
  })

  it('cannot be bought without enough points', async () => {
    const { doorSystem, door, points, nav, log } = await world()
    expect(points.points).toBeLessThan(door.cost)
    expect(doorSystem.tryOpen(door)).toBe(false)
    expect(door.open).toBe(false)
    expect(points.points).toBe(balance.points.starting)
    expect(reaches(nav, v(0, 0, 3), v(12, 0, 0))).toBe(false)
    expect(log).toEqual([])
  })

  it('buying it spends points, removes the blocker, joins the navmesh and activates the hall', async () => {
    const { doorSystem, door, points, nav, physics, zones, log } = await world()
    points.grant(1000)
    const before = points.points
    expect(doorSystem.tryOpen(door)).toBe(true)
    physics.step(DT)
    expect(points.points).toBe(before - door.cost)
    expect(door.open).toBe(true)
    expect(reaches(nav, v(0, 0, 3), v(12, 0, 0))).toBe(true)
    expect(shotThroughDoorway(physics)).toBe(true)
    expect(zones.isActive('hall')).toBe(true)
    expect(log).toEqual(['navmesh', 'zone hall', 'door start-hall'])
    // Can't be bought twice.
    expect(doorSystem.tryOpen(door)).toBe(false)
    expect(points.points).toBe(before - door.cost)
  })
})

describe('zone-gated spawning (the milestone check)', () => {
  it('hall windows only spawn after the hall door opens', async () => {
    const { physics, nav, zones, windows, doorSystem, door, points } = await world()
    const registry = new HitboxRegistry()
    const zombies = [new Zombie(0, physics, registry, balance.zombie)]
    const spawner = new SpawnSystem(zombies, windows, zones, nav, createRng(3), balance.zombie)
    const zoneOf = new Map(windows.map((w) => [w.id, w.zone]))

    const sample = (n: number) => {
      const counts = new Map<string, number>()
      for (let i = 0; i < n; i++) {
        const z = spawner.spawnAt(undefined, 150, 0)!
        const zone = zoneOf.get(z.entryWindow!.id)!
        counts.set(zone, (counts.get(zone) ?? 0) + 1)
        z.deactivate()
      }
      return counts
    }

    const before = sample(300)
    expect(before.get('start')).toBe(300)
    expect(before.get('hall')).toBeUndefined()

    points.grant(1000)
    doorSystem.tryOpen(door)
    const after = sample(300)
    expect(after.get('hall')).toBeGreaterThan(60) // 2 of 5 windows → ~120 expected
    expect(after.get('start')).toBeGreaterThan(100)
  })

  it('zombies already inside re-snap to the rebuilt navmesh and chase the player into the hall', async () => {
    const { physics, nav, events, windows, doorSystem, door, points } = await world()
    const registry = new HitboxRegistry()
    const z = new Zombie(0, physics, registry, balance.zombie)
    const player = createPlayer({ x: 12, y: 0, z: 0 }, 0)
    const barricades = new BarricadeSystem(windows, events, balance.barricade)
    const ai = new ZombieAISystem(
      [z],
      player,
      nav,
      barricades,
      events,
      balance.zombie,
      balance.barricade,
    )
    const start = v(0, 0, 3)
    const ref = nav.closestPoint(start, start)
    z.activate(start, ref, 0, 150, balance.zombie.runSpeed)
    let hits = 0
    events.on('playerHit', () => hits++)

    // Door closed: the zombie can't get to the player.
    for (let i = 0; i < 60 * 8; i++) ai.update(DT)
    expect(z.position.x).toBeLessThan(6)
    expect(hits).toBe(0)

    points.grant(1000)
    doorSystem.tryOpen(door)
    for (let i = 0; i < 60 * 10 && hits === 0; i++) {
      ai.update(DT)
      physics.step(DT)
    }
    expect(hits).toBe(1)
    expect(z.position.x).toBeGreaterThan(6.3)
  })
})

describe('wall-buys', () => {
  async function openShop(combat = balance.combat) {
    const physics = await Physics.create()
    const events = new EventBus<GameEvents>()
    const points = new PointsSystem(events, balance.points)
    const player = createPlayer({ x: 0, y: 0, z: 0 }, 0)
    const pressed = new Set<string>()
    const input = { isDown: () => false, consumePressed: (a: string) => pressed.delete(a) }
    const weapons = new WeaponSystem(
      player,
      input,
      physics,
      new HitboxRegistry(),
      events,
      createRng(1),
      combat,
      balance.player,
    )
    const buys = map.wallBuys.map(createWallBuy)
    const rifle = buys.find((b) => b.weapon === 'rifle_carbine')!
    const pistol = buys.find((b) => b.weapon === 'pistol_service')!
    const shopSystem = new WallBuySystem(buys, weapons, points, events, balance.purchases)
    const fireOnce = () => {
      pressed.add('fire')
      weapons.update(DT)
    }
    return { weapons, points, shop: shopSystem, rifle, pistol, fireOnce }
  }

  it('sells a weapon into a free slot and raises it', async () => {
    const { weapons, points, shop, rifle } = await openShop()
    expect(shop.prompt(rifle)).toContain('not enough points')
    expect(shop.use(rifle)).toBe(false)
    points.grant(1000)
    expect(shop.prompt(rifle)).toBe('Hold F to buy Harrow AC-7 [1,200]')
    expect(shop.use(rifle)).toBe(true)
    expect(points.points).toBe(1500 - 1200)
    expect(weapons.hudState()?.slotNames).toEqual(['Warden P9', 'Harrow AC-7'])
    expect(weapons.hudState()?.weaponName).toBe('Harrow AC-7')
  })

  it('refills ammo for an owned weapon at the ammo price, and only when not full', async () => {
    const { weapons, points, shop, pistol, fireOnce } = await openShop()
    expect(shop.prompt(pistol)).toBeNull() // pistol owned with full ammo
    expect(shop.use(pistol)).toBe(false)
    fireOnce()
    expect(weapons.hudState()?.mag).toBe(9)
    expect(weapons.ammoFull('pistol_service')).toBe(false)
    expect(shop.prompt(pistol)).toBe('Hold F to buy Warden P9 ammo [250]')
    expect(shop.use(pistol)).toBe(true)
    expect(points.points).toBe(500 - 250)
    expect(weapons.ammoFull('pistol_service')).toBe(true)
  })

  it('replaces the weapon in hand when both slots are full', async () => {
    const oneSlot = {
      ...balance.combat,
      startingWeapons: ['rifle_carbine'] as const,
      maxWeaponSlots: 1,
    }
    const { weapons, points, shop, pistol } = await openShop(
      oneSlot as unknown as typeof balance.combat,
    )
    points.grant(1000)
    expect(shop.use(pistol)).toBe(true)
    expect(weapons.hudState()?.slotNames).toEqual(['Warden P9'])
    expect(weapons.owns('rifle_carbine')).toBe(false)
  })
})
