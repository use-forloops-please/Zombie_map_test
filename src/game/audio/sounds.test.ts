import { describe, expect, it } from 'vitest'
import { SAMPLE_RATE } from '../../engine/synth'
import { renderSound, soundIds, soundVolume } from './sounds'

describe('synthesised sound bank', () => {
  const rendered = new Map(soundIds.map((id) => [id, renderSound(id)]))

  it.each(soundIds)('%s renders clean, audible, bounded audio', (id) => {
    const s = rendered.get(id)!
    expect(s.length / SAMPLE_RATE).toBeLessThan(6.5)
    let peak = 0
    let energy = 0
    let finite = true
    for (const x of s) {
      finite &&= Number.isFinite(x)
      peak = Math.max(peak, Math.abs(x))
      energy += x * x
    }
    expect(finite).toBe(true)
    expect(peak).toBeCloseTo(0.9, 3)
    expect(Math.sqrt(energy / s.length)).toBeGreaterThan(0.005)
    // Faded out: no click when the voice stops.
    expect(Math.abs(s[s.length - 1]!)).toBeLessThan(1e-3)
    expect(soundVolume[id]).toBeGreaterThan(0)
  })

  it('is deterministic: the same sound renders identically every time', () => {
    for (const id of ['shot_carbine', 'zombie_groan_2', 'crate_cycle'] as const) {
      expect(renderSound(id)).toEqual(rendered.get(id))
    }
  })

  it('gives each zombie groan its own character', () => {
    const [a, b, c] = (['zombie_groan_1', 'zombie_groan_2', 'zombie_groan_3'] as const).map((id) =>
      rendered.get(id)!,
    )
    expect(a!.length).not.toBe(b!.length)
    expect(b!.length).not.toBe(c!.length)
  })
})
