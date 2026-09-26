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
import { zombieHealthForRound } from '../rounds/scaling'
import { PointsSystem } from './PointsSystem'
import { WeaponSystem } from './WeaponSystem'

const DT = 1 / 60
let physics: Physics

beforeAll(async () => {
  physics = await Physics.create()
  physics.addStaticBox([0, -0.25, 0], [20, 0.25, 20])
})

/** Input stub: `press` queues one press of an action for the next step. */
function stubInput() {
  const pressed = new Set<Action>()
  return {
    press: (a: Action) => pressed.add(a),
    isDown: () => false,
    consumePressed: (a: Action) => pressed.delete(a),
  }
}

function setup(zombieDistance: number) {
  const events = new EventBus<GameEvents>()
  const registry = new HitboxRegistry()
  const player = createPlayer({ x: 0, y: 0, z: 0 }, 0) // facing -Z
  const input = stubInput()
  const weapons = new WeaponSystem(
    player,
    input,
    physics,
    registry,
    events,
    createRng(1),
    balance.combat,
    balance.player,
  )
  const points = new PointsSystem(events, balance.points)
  const zombie = new Zombie(0, physics, registry, balance.zombie)
  zombie.activate(
    new THREE.Vector3(0, 0, -zombieDistance),
    0,
    Math.PI, // facing the player
    zombieHealthForRound(1, balance.rounds),
    balance.zombie.walkSpeed,
  )
  zombie.state = 'chasing'
  zombie.syncBody()
  physics.step(DT)
  const hits: GameEvents['targetHit'][] = []
  events.on('targetHit', (e) => hits.push(e))
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      weapons.update(DT)
      physics.step(DT)
    }
  }
  return { weapons, input, points, zombie, hits, step }
}

describe('melee', () => {
  it('one-hit kills a round-1 zombie in reach and pays the melee kill bonus', () => {
    const { input, points, zombie, hits, step } = setup(1.1)
    input.press('melee')
    step()
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ cause: 'melee', killed: true })
    expect(zombie.alive).toBe(false)
    expect(points.points).toBe(balance.points.starting + balance.points.meleeKill)
  })

  it('misses a zombie out of reach', () => {
    const { input, zombie, hits, step } = setup(balance.combat.meleeRange + 1)
    input.press('melee')
    step()
    expect(hits).toHaveLength(0)
    expect(zombie.alive).toBe(true)
  })

  it('cannot be spammed faster than the cooldown', () => {
    const { input, hits, step, zombie } = setup(1.1)
    zombie.health = 10_000
    input.press('melee')
    step()
    input.press('melee')
    step(Math.floor(balance.combat.meleeCooldown / DT) - 2)
    expect(hits).toHaveLength(1)
    step(4)
    input.press('melee')
    step()
    expect(hits).toHaveLength(2)
  })
})
