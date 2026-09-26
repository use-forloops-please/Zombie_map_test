import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Action } from '../../engine/Input'
import { Physics } from '../../engine/Physics'
import { createRng } from '../../engine/rng'
import { balance } from '../config/balance'
import { HitboxRegistry } from '../entities/hitboxes'
import { createPlayer } from '../entities/Player'
import { Zombie } from '../entities/Zombie'
import { EventBus, type GameEvents } from '../events'
import { weaponDefs } from '../weapons/definitions'
import { PointsSystem } from './PointsSystem'
import { ProjectileSystem } from './ProjectileSystem'
import { WeaponSystem } from './WeaponSystem'

const DT = 1 / 60
const caster = weaponDefs.pulse_caster

let physics: Physics
beforeAll(async () => {
  physics = await Physics.create()
  physics.addStaticBox([0, -0.25, 0], [30, 0.25, 30])
  // A wall 12 m in front of the player.
  physics.addStaticBox([0, 1.5, -12], [5, 1.5, 0.15])
})

function setup(zombieSpots: [number, number][], weapon: 'pulse_caster' | 'shotgun_pump') {
  const events = new EventBus<GameEvents>()
  const registry = new HitboxRegistry()
  const pressed = new Set<Action>()
  const input = { isDown: () => false, consumePressed: (a: Action) => pressed.delete(a) }
  const player = createPlayer({ x: 0, y: 0, z: 0 }, 0) // facing -Z
  const aimAtChest = (distance: number) => {
    player.pitch = -Math.atan((balance.player.eyeHeight - 1.1) / distance)
  }
  const combat = { ...balance.combat, startingWeapons: [weapon] }
  const weapons = new WeaponSystem(
    player,
    input,
    physics,
    registry,
    events,
    createRng(1),
    combat as unknown as typeof balance.combat,
    balance.player,
  )
  const projectiles = new ProjectileSystem(physics, registry, events, (e, d, c) =>
    weapons.dealDamage(e, d, c),
  )
  const points = new PointsSystem(events, balance.points)
  const zombies = zombieSpots.map(([x, z], i) => {
    const zombie = new Zombie(i, physics, registry, balance.zombie)
    zombie.activate(new THREE.Vector3(x, 0, z), 0, 0, 150, 1.5)
    zombie.state = 'chasing'
    zombie.syncBody()
    return zombie
  })
  physics.step(DT)
  const hits: GameEvents['targetHit'][] = []
  const blasts: GameEvents['explosion'][] = []
  events.on('targetHit', (e) => hits.push(e))
  events.on('explosion', (e) => blasts.push(e))
  const fire = () => {
    pressed.add('fire')
    weapons.update(DT)
  }
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      projectiles.update(DT)
      physics.step(DT)
    }
  }
  const cleanup = () => {
    for (const z of zombies) z.dispose(physics, registry)
    projectiles.dispose()
  }
  return { zombies, hits, blasts, fire, run, points, projectiles, cleanup, aimAtChest }
}

describe('Halcyon Pulse Caster (experimental)', () => {
  it('fires a travelling projectile that takes time to arrive', () => {
    const s = setup([[0, -8]], 'pulse_caster')
    s.fire()
    expect(s.projectiles.projectiles.filter((p) => p.active)).toHaveLength(1)
    s.run(0.05)
    expect(s.hits).toHaveLength(0) // not hitscan
    s.run(1)
    expect(s.hits.length).toBeGreaterThan(0)
    s.cleanup()
  })

  it('splashes every zombie in the radius once, and spares those outside it', () => {
    // A tight group ~8 m out, plus one well to the side.
    const s = setup(
      [
        [0, -8],
        [0.9, -8.6],
        [-1, -7.8],
        [5, -8],
      ],
      'pulse_caster',
    )
    s.fire()
    s.run(1)
    expect(s.blasts).toHaveLength(1)
    expect(s.blasts[0]!.radius).toBe(caster.projectile!.splashRadius)
    const [a, b, c, far] = s.zombies
    expect([a!.alive, b!.alive, c!.alive]).toEqual([false, false, false])
    expect(far!.alive).toBe(true)
    expect(s.hits.every((h) => h.cause === 'splash' && h.zone === 'torso')).toBe(true)
    expect(s.hits).toHaveLength(3)
    // Splash kills pay body-kill points.
    expect(s.points.points).toBe(balance.points.starting + 3 * balance.points.bodyKill)
    s.cleanup()
  })

  it('detonates on walls instead of passing through them', () => {
    const s = setup([[0, -14]], 'pulse_caster') // behind the wall
    s.fire()
    s.run(1.5)
    expect(s.blasts).toHaveLength(1)
    expect(s.blasts[0]!.point[2]).toBeGreaterThan(-12)
    expect(s.zombies[0]!.alive).toBe(true)
    s.cleanup()
  })
})

describe('Tallow 12 Pump (pellets)', () => {
  it('fires several pellets per trigger pull', () => {
    const s = setup([[0, -3]], 'shotgun_pump')
    s.zombies[0]!.health = 10_000
    s.aimAtChest(3)
    s.fire()
    expect(s.hits.length).toBeGreaterThanOrEqual(4)
    expect(s.hits.length).toBeLessThanOrEqual(weaponDefs.shotgun_pump.pellets!)
    s.cleanup()
  })
})
