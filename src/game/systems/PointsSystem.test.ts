import { describe, expect, it } from 'vitest'
import { balance } from '../config/balance'
import type { HitZone } from '../entities/hitboxes'
import { EventBus, type GameEvents } from '../events'
import { pointsForHit, PointsSystem } from './PointsSystem'
import { StatsSystem } from './StatsSystem'

const p = balance.points

function hit(
  zone: HitZone,
  killed: boolean,
  cause: 'bullet' | 'melee' = 'bullet',
  targetKind: 'zombie' | 'dummy' = 'zombie',
): GameEvents['targetHit'] {
  return { targetKind, zone, damage: 50, killed, healthLeft: killed ? 0 : 100, cause }
}

describe('pointsForHit', () => {
  it('pays 10 for any non-lethal hit', () => {
    for (const zone of ['head', 'neck', 'torso', 'limb'] as const) {
      expect(pointsForHit(hit(zone, false), p)).toBe(10)
    }
    expect(pointsForHit(hit('torso', false, 'melee'), p)).toBe(10)
  })

  it('pays the spec kill bonuses on the killing hit', () => {
    expect(pointsForHit(hit('torso', true), p)).toBe(50)
    expect(pointsForHit(hit('limb', true), p)).toBe(50)
    expect(pointsForHit(hit('neck', true), p)).toBe(60)
    expect(pointsForHit(hit('head', true), p)).toBe(100)
    expect(pointsForHit(hit('torso', true, 'melee'), p)).toBe(130)
  })

  it('pays nothing for dummies', () => {
    expect(pointsForHit(hit('head', true, 'bullet', 'dummy'), p)).toBe(0)
    expect(pointsForHit(hit('torso', false, 'bullet', 'dummy'), p)).toBe(0)
  })
})

describe('PointsSystem', () => {
  it('starts at 500 and adds up a realistic round-1 kill (4 body shots)', () => {
    const events = new EventBus<GameEvents>()
    const points = new PointsSystem(events, p)
    expect(points.points).toBe(500)
    for (let i = 0; i < 3; i++) events.emit('targetHit', hit('torso', false))
    events.emit('targetHit', hit('torso', true))
    expect(points.points).toBe(500 + 3 * 10 + 50)
  })

  it('announces every change with the running total', () => {
    const events = new EventBus<GameEvents>()
    new PointsSystem(events, p)
    const seen: GameEvents['pointsChanged'][] = []
    events.on('pointsChanged', (e) => seen.push(e))
    events.emit('targetHit', hit('head', true))
    events.emit('boardRepaired', { windowId: 'w', boards: 3 })
    expect(seen).toEqual([
      { points: 600, delta: 100 },
      { points: 610, delta: 10 },
    ])
  })

  it('resets the repair cap when a round starts', () => {
    const events = new EventBus<GameEvents>()
    const points = new PointsSystem(events, p)
    for (let i = 0; i < 100; i++) events.emit('boardRepaired', { windowId: 'w', boards: 1 })
    expect(points.points).toBe(p.starting + p.repairCapPerRound)
    events.emit('roundStarted', { round: 2, zombies: 10 })
    events.emit('boardRepaired', { windowId: 'w', boards: 1 })
    expect(points.points).toBe(p.starting + p.repairCapPerRound + p.boardRepaired)
  })
})

describe('StatsSystem', () => {
  it('counts zombie kills and bullet headshot kills only', () => {
    const events = new EventBus<GameEvents>()
    const stats = new StatsSystem(events)
    events.emit('targetHit', hit('head', true))
    events.emit('targetHit', hit('head', false))
    events.emit('targetHit', hit('torso', true))
    events.emit('targetHit', hit('head', true, 'melee'))
    events.emit('targetHit', hit('head', true, 'bullet', 'dummy'))
    expect(stats.kills).toBe(3)
    expect(stats.headshots).toBe(1)
  })
})
