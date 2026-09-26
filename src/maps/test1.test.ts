import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import test1 from '../../public/maps/test-1/map.json'
import { Physics } from '../engine/Physics'
import { balance } from '../game/config/balance'
import { buildMapWorld } from './MapLoader'
import { buildNavigation, initNavigation, type Navigation } from './navmesh'
import { crateSpotAsBrush, doorAsBrush, parseMap, type MapDef } from './schema'

/* test-1 is bunker-01 with a second floor: stairs from the hall, a loft over it and a room over the start room. */

let def: MapDef

beforeAll(async () => {
  await initNavigation()
  const parsed = parseMap(test1)
  if (!parsed.ok) throw new Error(parsed.error)
  def = parsed.map
})

/** Navmesh with the given doors still closed. */
function navWith(closed: readonly string[]): Navigation {
  return buildNavigation(
    [
      ...def.brushes,
      ...def.crateSpots.map(crateSpotAsBrush),
      ...def.doors.filter((d) => closed.includes(d.id)).map(doorAsBrush),
    ],
    balance.navmesh,
  )
}

/** Whether a path from the player spawn ends at `to` (on the floor at that height). */
function reaches(nav: Navigation, to: [number, number, number]): boolean {
  const from = new THREE.Vector3()
  const target = new THREE.Vector3()
  const spawn = def.playerSpawns[0]
  if (!spawn || nav.closestPoint(new THREE.Vector3(...spawn.pos), from) === 0)
    throw new Error('spawn off the navmesh')
  if (nav.closestPoint(new THREE.Vector3(...to), target) === 0)
    throw new Error(`no navmesh near ${to.join(', ')}`)
  expect(Math.abs(target.y - to[1])).toBeLessThan(0.3)
  const path = Array.from({ length: 128 }, () => new THREE.Vector3())
  const n = nav.findPath(from, target, path)
  const end = path[n - 1]
  return end !== undefined && end.distanceTo(target) < 0.3
}

describe('test-1', () => {
  it('builds, with every window passing the loader checks', async () => {
    const physics = await Physics.create()
    const world = buildMapWorld({ def, art: null }, physics)
    expect(world.windows.map((w) => w.def.id)).toContain('upper-start-west')
    world.dispose()
  })

  it('opens the upper floor one door at a time', () => {
    const upperHall: [number, number, number] = [9, 3.125, 2]
    const upperStart: [number, number, number] = [0, 3.125, 0]

    const closed = navWith(['start-hall', 'hall-upstairs', 'upper-west'])
    expect(reaches(closed, upperHall)).toBe(false)

    const hallOpen = navWith(['hall-upstairs', 'upper-west'])
    expect(reaches(hallOpen, [9, 0, 2])).toBe(true)
    expect(reaches(hallOpen, upperHall)).toBe(false)

    const upstairsOpen = navWith(['upper-west'])
    expect(reaches(upstairsOpen, upperHall)).toBe(true)
    expect(reaches(upstairsOpen, upperStart)).toBe(false)

    const allOpen = navWith([])
    expect(reaches(allOpen, upperStart)).toBe(true)
    for (const nav of [closed, hallOpen, upstairsOpen, allOpen]) nav.dispose()
  })
})
