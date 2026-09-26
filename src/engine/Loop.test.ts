import { describe, expect, it } from 'vitest'
import { Loop } from './Loop'

function makeLoop(hz = 60, maxFrameTime = 0.25) {
  const updates: number[] = []
  const renders: number[] = []
  const loop = new Loop(
    {
      update: (dt) => updates.push(dt),
      render: (alpha) => renders.push(alpha),
    },
    { hz, maxFrameTime },
  )
  return { loop, updates, renders }
}

describe('Loop', () => {
  it('runs whole fixed steps and carries the remainder', () => {
    const { loop, updates } = makeLoop(60)
    expect(loop.advance(1 / 120)).toBe(0)
    expect(loop.advance(1 / 120)).toBe(1)
    expect(loop.advance(1 / 60 + 1e-9)).toBe(1)
    expect(updates.every((dt) => dt === 1 / 60)).toBe(true)
  })

  it('renders once per advance with alpha in [0, 1)', () => {
    const { loop, renders } = makeLoop(60)
    loop.advance(0.025) // 1.5 steps
    expect(renders).toHaveLength(1)
    expect(renders[0]).toBeCloseTo(0.5, 5)
  })

  it('simulates one second as 60 steps regardless of frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const { loop, updates } = makeLoop(60)
      for (let i = 0; i < fps; i++) loop.advance(1 / fps)
      expect(Math.abs(updates.length - 60)).toBeLessThanOrEqual(1)
    }
  })

  it('clamps long stalls to maxFrameTime', () => {
    const { loop } = makeLoop(60, 0.25)
    expect(loop.advance(5)).toBe(15)
  })

  it('ignores negative elapsed time', () => {
    const { loop, updates } = makeLoop(60)
    expect(loop.advance(-1)).toBe(0)
    expect(updates).toHaveLength(0)
  })
})
