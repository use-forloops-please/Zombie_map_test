import { describe, expect, it } from 'vitest'
import { balance } from '../config/balance'
import { EventBus, type GameEvents } from '../events'
import { PlayerHealthSystem } from './PlayerHealthSystem'

const DT = 1 / 60
const t = balance.player
const zombieHit = balance.zombie.attackDamage

function setup() {
  const events = new EventBus<GameEvents>()
  const health = new PlayerHealthSystem(events, t)
  let downs = 0
  events.on('playerDowned', () => downs++)
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) health.update(DT)
  }
  return { events, health, run, downs: () => downs }
}

describe('PlayerHealthSystem', () => {
  it('takes damage from playerHit events', () => {
    const { events, health } = setup()
    events.emit('playerHit', { damage: zombieHit })
    expect(health.health).toBe(t.maxHealth - zombieHit)
  })

  it('two quick zombie hits down the player', () => {
    const { events, run, downs } = setup()
    events.emit('playerHit', { damage: zombieHit })
    run(1)
    events.emit('playerHit', { damage: zombieHit })
    expect(downs()).toBe(1)
  })

  it('regenerates to full after the delay, but not before', () => {
    const { events, health, run } = setup()
    events.emit('playerHit', { damage: zombieHit })
    run(t.regenDelay - 0.1)
    expect(health.health).toBe(t.maxHealth - zombieHit)
    run(0.1 + zombieHit / t.regenRate + 0.1)
    expect(health.health).toBe(t.maxHealth)
  })

  it('a hit, full regen, then another hit does not down the player', () => {
    const { events, run, downs } = setup()
    events.emit('playerHit', { damage: zombieHit })
    run(t.regenDelay + zombieHit / t.regenRate + 0.5)
    events.emit('playerHit', { damage: zombieHit })
    expect(downs()).toBe(0)
  })

  it('ignores hits while downed and recovers on reset', () => {
    const { events, health, downs } = setup()
    events.emit('playerHit', { damage: 999 })
    events.emit('playerHit', { damage: 999 })
    expect(downs()).toBe(1)
    health.reset()
    expect(health.health).toBe(t.maxHealth)
    expect(health.isDowned).toBe(false)
  })
})
