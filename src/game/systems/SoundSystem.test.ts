import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { Physics } from '../../engine/Physics'
import { createRng } from '../../engine/rng'
import type { SoundId } from '../audio/sounds'
import { balance } from '../config/balance'
import { HitboxRegistry } from '../entities/hitboxes'
import { createPlayer } from '../entities/Player'
import { Zombie } from '../entities/Zombie'
import { EventBus, type GameEvents } from '../events'
import { SoundSystem, type SoundOutput } from './SoundSystem'

const DT = 1 / 60
const t = balance.audio

let physics: Physics
beforeAll(async () => {
  physics = await Physics.create()
})

interface Played {
  id: SoundId
  at: [number, number, number] | null
  time: number
}

function setup(zombieCount = 0) {
  const events = new EventBus<GameEvents>()
  const played: Played[] = []
  let time = 0
  const out: SoundOutput = {
    play: (id) => played.push({ id, at: null, time }),
    playAt: (id, p) => played.push({ id, at: [p.x, p.y, p.z], time }),
  }
  const player = createPlayer({ x: 0, y: 0, z: 0 }, 0)
  player.grounded = true
  const registry = new HitboxRegistry()
  const zombies = Array.from(
    { length: zombieCount },
    (_, i) => new Zombie(i, physics, registry, balance.zombie),
  )
  const sounds = new SoundSystem(
    events,
    out,
    player,
    zombies,
    [],
    [],
    null,
    createRng(7),
    t,
    balance.zombie,
  )
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      each?.()
      sounds.update(DT)
      time += DT
    }
  }
  const ids = () => played.map((p) => p.id)
  return { events, played, player, zombies, sounds, run, ids }
}

const hit = (killed: boolean): GameEvents['targetHit'] => ({
  targetKind: 'zombie',
  zone: 'torso',
  damage: 30,
  killed,
  healthLeft: killed ? 0 : 100,
  cause: 'bullet',
})

const struck: GameEvents['targetStruck'] = {
  targetKind: 'zombie',
  zone: 'torso',
  killed: false,
  cause: 'bullet',
  point: [1, 1.2, -3],
  direction: [0, 0, -1],
}

describe('SoundSystem', () => {
  it("plays each weapon's own shot, reload and empty-click sounds in the player's head", () => {
    const s = setup()
    s.events.emit('weaponFired', { weaponId: 'shotgun_pump' })
    s.events.emit('weaponFired', { weaponId: 'pulse_caster' })
    s.events.emit('reloadStarted', { weaponId: 'pistol_service' })
    s.events.emit('reloadFinished', { weaponId: 'pistol_service' })
    s.events.emit('dryFire', { weaponId: 'pistol_service' })
    expect(s.ids()).toEqual([
      'shot_shotgun',
      'shot_pulse',
      'reload_start',
      'reload_end',
      'dry_fire',
    ])
    expect(s.played.every((p) => p.at === null)).toBe(true)
  })

  it('a shotgun blast of eight pellet hits is one tick and at most a couple of flesh sounds', () => {
    const s = setup()
    for (let i = 0; i < 8; i++) {
      s.events.emit('targetHit', hit(false))
      s.events.emit('targetStruck', struck)
    }
    s.run(DT)
    expect(s.ids().filter((id) => id === 'hit_tick')).toHaveLength(1)
    const flesh = s.played.filter((p) => p.id === 'flesh_hit')
    expect(flesh).toHaveLength(t.hitSoundsPerStep)
    expect(flesh[0]!.at).toEqual(struck.point)
  })

  it('a kill ticks differently, and a headshot sounds different from a body hit', () => {
    const s = setup()
    s.events.emit('targetHit', hit(false))
    s.events.emit('targetHit', hit(true))
    s.events.emit('targetStruck', { ...struck, zone: 'head', killed: true })
    s.run(DT)
    expect(s.ids()).toEqual(['headshot', 'kill_tick'])
  })

  it('footsteps follow distance walked, quicken when sprinting, and stop in the air', () => {
    const walk = setup()
    walk.player.velocity.set(balance.player.walkSpeed, 0, 0)
    walk.run(4)
    const walkSteps = walk.ids().filter((id) => id.startsWith('footstep')).length
    // Every stride is one step: roughly distance / stride length.
    const stride = t.strideLength * (0.75 + balance.player.walkSpeed / 16)
    expect(walkSteps).toBe(Math.floor((balance.player.walkSpeed * 4) / stride))
    // Alternating feet.
    expect(walk.ids().slice(0, 2)).toEqual(['footstep_2', 'footstep_1'])

    const sprint = setup()
    sprint.player.velocity.set(balance.player.sprintSpeed, 0, 0)
    sprint.run(4)
    const sprintSteps = sprint.ids().filter((id) => id.startsWith('footstep')).length
    expect(sprintSteps).toBeGreaterThan(walkSteps)

    const air = setup()
    air.player.grounded = false
    air.player.velocity.set(balance.player.walkSpeed, 0, 0)
    air.run(2)
    expect(air.ids()).toEqual([])
  })

  it('lands with a thud after a real fall, not after a hop down a step', () => {
    const s = setup()
    s.player.grounded = false
    s.player.velocity.y = -2
    s.run(0.1)
    s.player.grounded = true
    s.run(DT)
    expect(s.ids()).not.toContain('land')

    s.player.grounded = false
    s.player.velocity.y = -(t.landSpeed + 1)
    s.run(0.1)
    s.player.grounded = true
    s.run(DT)
    expect(s.ids().filter((id) => id === 'land')).toHaveLength(1)
  })

  it('heartbeat only while badly hurt, faster than once a second', () => {
    const s = setup()
    s.events.emit('playerHealthChanged', { health: 80, max: 100 })
    s.run(3)
    expect(s.ids()).not.toContain('heartbeat')
    s.events.emit('playerHealthChanged', { health: 30, max: 100 })
    s.run(3)
    const beats = s.ids().filter((id) => id === 'heartbeat').length
    expect(beats).toBe(Math.ceil(3 / t.heartbeatInterval))
  })

  it('a horde of 24 groans from where the zombies are, never piling up on the same instant', () => {
    const s = setup(24)
    s.zombies.forEach((z, i) => {
      z.activate(new THREE.Vector3(i, 0, -10), 0, 0, 150, balance.zombie.walkSpeed)
      z.state = 'chasing'
    })
    s.run(20)
    const groans = s.played.filter((p) => p.id.startsWith('zombie_groan'))
    expect(groans.length).toBeGreaterThan(24)
    for (let i = 1; i < groans.length; i++) {
      expect(groans[i]!.time - groans[i - 1]!.time).toBeGreaterThanOrEqual(t.groanSpacing - 1e-9)
    }
    for (const g of groans) {
      expect(g.at![2]).toBe(-10)
      expect(g.at![1]).toBeCloseTo(1.6)
    }
  })

  it('zombies snarl when they swing and cry out once when they die', () => {
    const s = setup(1)
    const z = s.zombies[0]!
    z.activate(new THREE.Vector3(0, 0, -2), 0, 0, 150, balance.zombie.walkSpeed)
    s.run(DT)
    expect(s.ids()).toContain('zombie_spawn')
    z.state = 'attacking'
    s.run(DT)
    z.state = 'dead'
    s.run(1)
    expect(s.ids().filter((id) => id === 'zombie_attack')).toHaveLength(1)
    expect(s.ids().filter((id) => id === 'zombie_death')).toHaveLength(1)
  })

  it('spending points chimes; being short buzzes', () => {
    const s = setup()
    s.events.emit('pointsChanged', { points: 400, delta: 10 })
    s.events.emit('pointsChanged', { points: 0, delta: -950 })
    s.events.emit('purchaseDenied', { cost: 950 })
    expect(s.ids()).toEqual(['purchase', 'denied'])
  })
})
