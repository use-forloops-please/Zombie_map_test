import { beforeAll, describe, expect, it } from 'vitest'
import { Physics } from '../../engine/Physics'
import { createRng } from '../../engine/rng'
import { balance, type EffectsTuning } from '../config/balance'
import { EventBus, type GameEvents } from '../events'
import { GoreSystem } from './GoreSystem'

let physics: Physics
beforeAll(async () => {
  physics = await Physics.create()
  physics.addStaticBox([0, -0.25, 0], [20, 0.25, 20]) // floor
  physics.addStaticBox([0, 1.5, -5], [5, 1.5, 0.15]) // wall at z = -4.85
  physics.syncQueries()
})

/** balance.effects with some numbers changed (its literal types are widened for tests). */
const effects = (over: Partial<Record<keyof EffectsTuning, unknown>>) =>
  ({ ...balance.effects, ...over }) as unknown as EffectsTuning

function setup(tuning: EffectsTuning = balance.effects) {
  const events = new EventBus<GameEvents>()
  const splats: GameEvents['bloodSplat'][] = []
  events.on('bloodSplat', (e) => splats.push(e))
  const gore = new GoreSystem(physics, events, createRng(3), tuning)
  return { events, splats, gore }
}

const struck = (over: Partial<GameEvents['targetStruck']> = {}): GameEvents['targetStruck'] => ({
  targetKind: 'zombie',
  zone: 'torso',
  killed: false,
  cause: 'bullet',
  point: [0, 1.2, -3],
  direction: [0, 0, -1],
  ...over,
})

describe('GoreSystem', () => {
  const always = effects({ bloodSplatChance: 1 })

  it('splashes the wall behind a zombie that was shot, facing back out of the wall', () => {
    const s = setup(always)
    s.events.emit('targetStruck', struck())
    expect(s.splats).toHaveLength(1)
    const [splat] = s.splats
    expect(splat!.point[2]).toBeCloseTo(-4.85, 2)
    expect(splat!.normal[2]).toBeCloseTo(1)
    const [min, max] = balance.effects.bloodSplatSize
    expect(splat!.size).toBeGreaterThanOrEqual(min)
    expect(splat!.size).toBeLessThanOrEqual(max)
  })

  it('leaves no mark when the wall is out of reach', () => {
    const s = setup(always)
    s.events.emit('targetStruck', struck({ point: [0, 1.2, 3] })) // 7.85 m from the wall
    expect(s.splats).toHaveLength(0)
  })

  it('pools on the floor under a kill', () => {
    const s = setup(effects({ bloodSplatChance: 0 }))
    s.events.emit('targetStruck', struck({ killed: true, point: [2, 1.2, 1] }))
    expect(s.splats).toHaveLength(1)
    expect(s.splats[0]!.point).toEqual([2, expect.closeTo(0, 3), 1])
    expect(s.splats[0]!.normal[1]).toBeCloseTo(1)
    expect(s.splats[0]!.size).toBeGreaterThanOrEqual(balance.effects.bloodPoolSize[0])
  })

  it('marks only some hits, and never for target dummies', () => {
    const s = setup()
    for (let i = 0; i < 200; i++) s.events.emit('targetStruck', struck())
    const rate = s.splats.length / 200
    expect(rate).toBeGreaterThan(balance.effects.bloodSplatChance - 0.12)
    expect(rate).toBeLessThan(balance.effects.bloodSplatChance + 0.12)

    const d = setup(always)
    d.events.emit('targetStruck', struck({ targetKind: 'dummy', killed: true }))
    expect(d.splats).toHaveLength(0)
  })
})
