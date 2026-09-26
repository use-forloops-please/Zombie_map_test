import { beforeAll, describe, expect, it } from 'vitest'
import bunker01 from '../../../public/maps/bunker-01/map.json'
import { CollisionGroup, createRayHit, interactionGroups, Physics } from '../../engine/Physics'
import { createRng } from '../../engine/rng'
import { parseMap, type MapDef } from '../../maps/schema'
import { balance } from '../config/balance'
import { Crate } from '../entities/Crate'
import { HitboxRegistry } from '../entities/hitboxes'
import { createPlayer } from '../entities/Player'
import { ZoneState } from '../entities/Zones'
import { EventBus, type GameEvents } from '../events'
import { CrateSystem } from './CrateSystem'
import { PointsSystem } from './PointsSystem'
import { WeaponSystem } from './WeaponSystem'

const DT = 1 / 60
const t = balance.crate
let map: MapDef

beforeAll(() => {
  const parsed = parseMap(bunker01)
  if (!parsed.ok) throw new Error(parsed.error)
  map = parsed.map
})

async function setup(seed = 1, hallOpen = false) {
  const physics = await Physics.create()
  const events = new EventBus<GameEvents>()
  const points = new PointsSystem(events, balance.points)
  const zones = new ZoneState(map.zones)
  if (hallOpen) zones.activate('hall')
  const input = { isDown: () => false, consumePressed: () => false }
  const weapons = new WeaponSystem(
    createPlayer({ x: 0, y: 0, z: 0 }, 0),
    input,
    physics,
    new HitboxRegistry(),
    events,
    createRng(seed),
    balance.combat,
    balance.player,
  )
  const start = map.crateSpots.find((s) => s.startsHere)!
  const crate = new Crate(start, physics)
  const crates = new CrateSystem(
    crate,
    map.crateSpots,
    zones,
    weapons,
    points,
    events,
    physics,
    createRng(seed),
    t,
    balance.purchases,
  )
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) crates.update(DT)
  }
  return { physics, events, points, zones, weapons, crate, crates, run }
}

describe('supply crate', () => {
  it('costs 950 and cannot be spun without the points', async () => {
    const { crates, crate, points } = await setup()
    expect(points.points).toBe(500)
    expect(crates.prompt()).toContain('not enough points')
    expect(crates.spin()).toBe(false)
    expect(crate.state).toBe('idle')
    points.grant(1000)
    expect(crates.prompt()).toBe('Hold F to open the supply crate [950]')
    expect(crates.spin()).toBe(true)
    expect(points.points).toBe(1500 - 950)
    expect(crate.state).toBe('cycling')
    expect(crates.spin()).toBe(false) // busy
  })

  it('cycles, offers a weapon the player does not own, and gives it when taken', async () => {
    const { crates, crate, points, weapons, run } = await setup(3)
    points.grant(5000)
    crates.spin()
    expect(crates.prompt()).toBeNull()
    run(t.cycleTime - 0.1)
    expect(crate.state).toBe('cycling')
    run(0.2)
    expect(crate.state).toBe('offering')
    const offer = crate.offer!
    expect(weapons.owns(offer)).toBe(false)
    expect(offer).not.toBe('pistol_service')
    expect(crates.prompt()).toMatch(/^Hold F to take /)
    expect(crates.take()).toBe(true)
    expect(weapons.owns(offer)).toBe(true)
    expect(weapons.hudState()?.weaponName).toBeDefined()
    expect(crate.state).toBe('idle')
  })

  it('withdraws the offer if it is not taken in time', async () => {
    const { crates, crate, points, weapons, run } = await setup(4)
    points.grant(5000)
    crates.spin()
    run(t.cycleTime + 0.1)
    const offer = crate.offer!
    run(t.offerTime)
    expect(crate.state).toBe('idle')
    expect(crates.take()).toBe(false)
    expect(weapons.owns(offer)).toBe(false)
  })

  it('is solid: a shot at it stops on the crate', async () => {
    const { physics, crate } = await setup()
    physics.syncQueries()
    const hit = createRayHit()
    const groups = interactionGroups(CollisionGroup.SHOT, CollisionGroup.WORLD)
    const from = crate.usePoint.clone().setY(0.5)
    const dir = crate.front.clone().negate()
    expect(physics.castRay(from, dir, 5, groups, hit)).toBe(true)
    expect(hit.distance).toBeLessThan(0.8)
  })
})

describe('crate relocation (the milestone check)', () => {
  /** Spins (without taking anything) until the crate moves; returns the spin it moved on. */
  function spinUntilMoved(
    s: Awaited<ReturnType<typeof setup>>,
    maxSpins: number,
  ): { spins: number; refunded: boolean; to: string } | null {
    const startSpot = s.crate.spot.id
    for (let spin = 1; spin <= maxSpins; spin++) {
      s.points.grant(t.cost)
      const before = s.points.points
      expect(s.crates.spin()).toBe(true)
      s.run(t.cycleTime + 0.05)
      if (s.crate.state === 'relocating') {
        const refunded = s.points.points === before
        s.run(t.relocateTime + 0.05)
        expect(s.crate.state).toBe('idle')
        expect(s.crate.spot.id).not.toBe(startSpot)
        return { spins: spin, refunded, to: s.crate.spot.id }
      }
      s.run(t.offerTime + 0.05) // let the offer lapse
    }
    return null
  }

  it('moves after enough spins: never before spin 4, and refunds the spin it leaves on', async () => {
    const results: number[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const s = await setup(seed, true)
      const moved = spinUntilMoved(s, 80)
      expect(moved).not.toBeNull()
      expect(moved!.spins).toBeGreaterThanOrEqual(t.relocateMinSpins)
      expect(moved!.refunded).toBe(true)
      expect(['hall-south', 'hall-platform']).toContain(moved!.to)
      results.push(moved!.spins)
    }
    // More likely to move at spin 8+ than at spins 4–7.
    const late = results.filter((n) => n >= 8).length
    expect(late).toBeGreaterThan(results.length / 2 - 8)
  })

  it('stays put while every other spot is in a zone that is not open yet', async () => {
    const s = await setup(2, false)
    expect(spinUntilMoved(s, 40)).toBeNull()
    expect(s.crate.spot.id).toBe('start-corner')
  })

  it('resets its spin count at the new spot and moves its collider', async () => {
    const s = await setup(5, true)
    const moved = spinUntilMoved(s, 80)!
    expect(s.crate.spinsAtSpot).toBe(0)
    const spot = map.crateSpots.find((c) => c.id === moved.to)!
    expect(s.crate.position.toArray()).toEqual(spot.pos)
    s.physics.syncQueries()
    const hit = createRayHit()
    const groups = interactionGroups(CollisionGroup.SHOT, CollisionGroup.WORLD)
    const from = s.crate.usePoint.clone().setY(spot.pos[1] + 0.5)
    expect(s.physics.castRay(from, s.crate.front.clone().negate(), 5, groups, hit)).toBe(true)
    expect(hit.distance).toBeLessThan(0.8)
  })
})
