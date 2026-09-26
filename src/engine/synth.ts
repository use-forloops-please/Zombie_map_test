import type { Rng } from './rng'

/**
 * Tiny offline synthesiser: pure functions and small filter classes that render sounds into
 * Float32Arrays. No WebAudio, so sounds are generated the same way in the browser and in
 * tests. The game's sound recipes (game/audio/sounds.ts) are built from these parts.
 */

export const SAMPLE_RATE = 44100

/** A mono buffer of `seconds` of silence. */
export function buffer(seconds: number, sr = SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * sr)))
}

/** Linear attack then exponential decay with time constant `decay` (seconds). */
export function env(t: number, attack: number, decay: number): number {
  if (t < 0) return 0
  if (t < attack) return t / attack
  return Math.exp(-(t - attack) / decay)
}

/** Exponential glide from `from` to `to` over `time` seconds, then holds `to`. */
export function glide(t: number, from: number, to: number, time: number): number {
  const k = Math.min(Math.max(t / time, 0), 1)
  return from * Math.pow(to / from, k)
}

/** Converts a MIDI note number to Hz. */
export function midi(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** Soft clipper: pushes loud peaks into saturation instead of hard clipping. */
export function saturate(x: number, drive = 1): number {
  return Math.tanh(x * drive)
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass'

/** RBJ-cookbook biquad. Call `set` to change it mid-sound (e.g. every 32 samples). */
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private readonly type: FilterType
  private readonly sr: number

  constructor(type: FilterType, freq: number, q = 0.707, sr = SAMPLE_RATE) {
    this.type = type
    this.sr = sr
    this.set(freq, q)
  }

  set(freq: number, q = 0.707): void {
    const f = Math.min(Math.max(freq, 10), this.sr * 0.45)
    const w = (2 * Math.PI * f) / this.sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    switch (this.type) {
      case 'lowpass':
        this.b0 = (1 - cos) / 2
        this.b1 = 1 - cos
        this.b2 = (1 - cos) / 2
        break
      case 'highpass':
        this.b0 = (1 + cos) / 2
        this.b1 = -(1 + cos)
        this.b2 = (1 + cos) / 2
        break
      case 'bandpass':
        // Constant 0 dB peak gain.
        this.b0 = alpha
        this.b1 = 0
        this.b2 = -alpha
        break
    }
    this.b0 /= a0
    this.b1 /= a0
    this.b2 /= a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Noise sources driven by a seeded RNG, so every render of a sound is identical. */
export class Noise {
  private readonly rng: Rng
  private brownLast = 0

  constructor(rng: Rng) {
    this.rng = rng
  }

  white(): number {
    return this.rng() * 2 - 1
  }

  /** Integrated (red) noise: deep rumble. */
  brown(): number {
    this.brownLast = (this.brownLast + this.white() * 0.02) / 1.02
    return this.brownLast * 3.5
  }
}

/** Phase-accumulating oscillator; frequency can change every sample without clicks. */
export class Osc {
  private phase: number

  constructor(phase = 0) {
    this.phase = phase
  }

  /** Advances by one sample at `freq` Hz and returns the current phase in [0, 1). */
  step(freq: number, sr = SAMPLE_RATE): number {
    const p = this.phase
    this.phase = (this.phase + freq / sr) % 1
    return p
  }

  sine(freq: number, sr = SAMPLE_RATE): number {
    return Math.sin(2 * Math.PI * this.step(freq, sr))
  }

  saw(freq: number, sr = SAMPLE_RATE): number {
    return this.step(freq, sr) * 2 - 1
  }

  /** Rounded "glottal" pulse, the raw buzz behind a voice. */
  pulse(freq: number, sr = SAMPLE_RATE): number {
    const p = this.step(freq, sr)
    return p < 0.4 ? Math.sin((Math.PI * p) / 0.4) : -0.25
  }
}

/**
 * Small Schroeder reverb (four damped combs into two allpasses): the concrete-bunker
 * room every sound is played "in".
 */
export class Reverb {
  private readonly combs: { buf: Float32Array; i: number; g: number; lp: number }[]
  private readonly allpasses: { buf: Float32Array; i: number }[]
  private readonly damp: number

  constructor(rt60: number, damp = 0.35, sr = SAMPLE_RATE) {
    this.damp = damp
    this.combs = [29.7, 37.1, 41.1, 43.7].map((ms) => {
      const len = Math.round((ms / 1000) * sr)
      return { buf: new Float32Array(len), i: 0, g: Math.pow(10, (-3 * ms) / 1000 / rt60), lp: 0 }
    })
    this.allpasses = [5, 1.7].map((ms) => ({
      buf: new Float32Array(Math.round((ms / 1000) * sr)),
      i: 0,
    }))
  }

  process(x: number): number {
    let out = 0
    for (const c of this.combs) {
      const y = c.buf[c.i] ?? 0
      c.lp = y * (1 - this.damp) + c.lp * this.damp
      c.buf[c.i] = x + c.lp * c.g
      c.i = (c.i + 1) % c.buf.length
      out += y
    }
    out *= 0.25
    for (const a of this.allpasses) {
      const y = a.buf[a.i] ?? 0
      a.buf[a.i] = out + y * 0.7
      a.i = (a.i + 1) % a.buf.length
      out = y - out * 0.7
    }
    return out
  }
}

/** Adds `src` into `dst` starting at `offset` seconds, scaled by `gain`. */
export function mixInto(
  dst: Float32Array,
  src: Float32Array,
  offset = 0,
  gain = 1,
  sr = SAMPLE_RATE,
): void {
  const start = Math.round(offset * sr)
  const n = Math.min(src.length, dst.length - start)
  for (let i = 0; i < n; i++) dst[start + i]! += (src[i] ?? 0) * gain
}

/** Runs `buf` through a reverb and mixes the wet signal back in. The tail must fit in `buf`. */
export function addReverb(buf: Float32Array, rt60: number, wet: number, sr = SAMPLE_RATE): void {
  const reverb = new Reverb(rt60, 0.35, sr)
  for (let i = 0; i < buf.length; i++) buf[i]! += reverb.process(buf[i] ?? 0) * wet
}

/** Fades both ends of `buf` to avoid clicks, then scales it so its loudest sample is `peak`. */
export function finish(buf: Float32Array, peak = 0.9, sr = SAMPLE_RATE): Float32Array {
  const fadeIn = Math.min(Math.round(0.0005 * sr), buf.length)
  const fadeOut = Math.min(Math.round(0.02 * sr), buf.length)
  let max = 0
  for (let i = 0; i < buf.length; i++) {
    let g = 1
    if (i < fadeIn) g *= i / fadeIn
    const fromEnd = buf.length - 1 - i
    if (fromEnd < fadeOut) g *= fromEnd / fadeOut
    const x = (buf[i] ?? 0) * g
    buf[i] = x
    max = Math.max(max, Math.abs(x))
  }
  const k = max > 0 ? peak / max : 0
  for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] ?? 0) * k
  return buf
}
