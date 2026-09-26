import { describe, expect, it } from 'vitest'
import { EventBus } from './events'

interface TestEvents {
  ping: { n: number }
  pong: { s: string }
}

describe('EventBus', () => {
  it('delivers payloads to subscribers of that event only', () => {
    const bus = new EventBus<TestEvents>()
    const pings: number[] = []
    const pongs: string[] = []
    bus.on('ping', (e) => pings.push(e.n))
    bus.on('pong', (e) => pongs.push(e.s))
    bus.emit('ping', { n: 1 })
    bus.emit('ping', { n: 2 })
    expect(pings).toEqual([1, 2])
    expect(pongs).toEqual([])
  })

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus<TestEvents>()
    let count = 0
    const off = bus.on('ping', () => count++)
    bus.emit('ping', { n: 0 })
    off()
    bus.emit('ping', { n: 0 })
    expect(count).toBe(1)
  })

  it('emitting with no subscribers is a no-op', () => {
    expect(() => new EventBus<TestEvents>().emit('pong', { s: 'x' })).not.toThrow()
  })
})
