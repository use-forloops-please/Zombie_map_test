import { createRng, type Rng } from '../../engine/rng'
import {
  addReverb,
  Biquad,
  buffer,
  env,
  finish,
  glide,
  midi,
  mixInto,
  Noise,
  Osc,
  SAMPLE_RATE as SR,
  saturate,
} from '../../engine/synth'

/**
 * Every sound in the game, synthesised at load from the recipes below: no recorded or
 * third-party audio. Recipes are deterministic (seeded per sound id), so a sound is
 * identical on every load and in tests.
 */
export const soundIds = [
  'shot_pistol',
  'shot_carbine',
  'shot_smg',
  'shot_shotgun',
  'shot_bolt',
  'shot_pulse',
  'dry_fire',
  'reload_start',
  'reload_end',
  'weapon_raise',
  'melee_swing',
  'melee_hit',
  'flesh_hit',
  'headshot',
  'hit_tick',
  'kill_tick',
  'impact_concrete',
  'explosion',
  'zombie_spawn',
  'zombie_groan_1',
  'zombie_groan_2',
  'zombie_groan_3',
  'zombie_attack',
  'zombie_death',
  'board_tear',
  'board_repair',
  'purchase',
  'denied',
  'door_open',
  'crate_cycle',
  'crate_depart',
  'player_hurt',
  'heartbeat',
  'footstep_1',
  'footstep_2',
  'land',
  'round_start',
  'round_end',
  'game_over',
] as const
export type SoundId = (typeof soundIds)[number]

/** Default playback gain per sound, so callers only pass situational adjustments. */
export const soundVolume: Record<SoundId, number> = {
  shot_pistol: 0.75,
  shot_carbine: 0.7,
  shot_smg: 0.6,
  shot_shotgun: 0.9,
  shot_bolt: 0.9,
  shot_pulse: 0.8,
  dry_fire: 0.5,
  reload_start: 0.55,
  reload_end: 0.6,
  weapon_raise: 0.4,
  melee_swing: 0.5,
  melee_hit: 0.8,
  flesh_hit: 0.55,
  headshot: 0.65,
  hit_tick: 0.35,
  kill_tick: 0.45,
  impact_concrete: 0.35,
  explosion: 1,
  zombie_spawn: 0.6,
  zombie_groan_1: 0.7,
  zombie_groan_2: 0.7,
  zombie_groan_3: 0.7,
  zombie_attack: 0.9,
  zombie_death: 0.8,
  board_tear: 0.8,
  board_repair: 0.6,
  purchase: 0.6,
  denied: 0.45,
  door_open: 0.8,
  crate_cycle: 0.6,
  crate_depart: 0.75,
  player_hurt: 0.8,
  heartbeat: 0.7,
  footstep_1: 0.22,
  footstep_2: 0.22,
  land: 0.35,
  round_start: 0.7,
  round_end: 0.6,
  game_over: 0.75,
}

type Recipe = (rng: Rng) => Float32Array

// ─── Building blocks ─────────────────────────────────────────────────────────────────────

interface GunshotSpec {
  length: number
  /** High-pass cutoff of the initial crack. */
  crack: number
  crackDecay: number
  /** Low-pass cutoff of the noisy body. */
  body: number
  bodyDecay: number
  thumpFrom: number
  thumpTo: number
  thumpDecay: number
  /** Room reverb time and level. */
  rt60: number
  wet: number
  drive: number
}

function gunshot(s: GunshotSpec, rng: Rng): Float32Array {
  const buf = buffer(s.length)
  const n = new Noise(rng)
  const crackHp = new Biquad('highpass', s.crack)
  const bodyLp = new Biquad('lowpass', s.body, 0.9)
  const thump = new Osc()
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR
    const crack = crackHp.process(n.white()) * env(t, 0.0003, s.crackDecay)
    const body = bodyLp.process(n.white()) * env(t, 0.001, s.bodyDecay) * 1.4
    const low =
      thump.sine(glide(t, s.thumpFrom, s.thumpTo, 0.06)) * env(t, 0.001, s.thumpDecay) * 1.2
    buf[i] = saturate(crack * 0.9 + body + low, s.drive)
  }
  addReverb(buf, s.rt60, s.wet)
  return buf
}

/** A short mechanical click/clack: resonant noise burst at `freq`. */
function clack(rng: Rng, freq: number, decay: number, q = 6): Float32Array {
  const buf = buffer(decay * 8 + 0.01)
  const n = new Noise(rng)
  const bp = new Biquad('bandpass', freq, q)
  const hp = new Biquad('highpass', 4000)
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR
    const x = n.white()
    buf[i] = bp.process(x) * env(t, 0.0002, decay) * 3 + hp.process(x) * env(t, 0.0001, 0.001)
  }
  return buf
}

/** A thump: a sine dropping in pitch. */
function thump(from: number, to: number, decay: number, length = decay * 6): Float32Array {
  const buf = buffer(length)
  const osc = new Osc()
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR
    buf[i] = osc.sine(glide(t, from, to, decay * 2)) * env(t, 0.001, decay)
  }
  return buf
}

/** Noise through a filter with an envelope. */
function noiseBurst(
  rng: Rng,
  type: 'lowpass' | 'highpass' | 'bandpass',
  freq: number,
  attack: number,
  decay: number,
  q = 0.707,
  length = attack + decay * 6,
): Float32Array {
  const buf = buffer(length)
  const n = new Noise(rng)
  const f = new Biquad(type, freq, q)
  for (let i = 0; i < buf.length; i++) {
    buf[i] = f.process(n.white()) * env(i / SR, attack, decay)
  }
  return buf
}

/** A struck bell/music-box note: inharmonic partials, the upper ones dying faster. */
function bell(freq: number, decay: number, length = decay * 5): Float32Array {
  const buf = buffer(length)
  const partials = [
    { ratio: 1, gain: 1, decay: 1 },
    { ratio: 2.76, gain: 0.4, decay: 0.5 },
    { ratio: 5.4, gain: 0.18, decay: 0.25 },
    { ratio: 8.93, gain: 0.07, decay: 0.12 },
  ]
  for (const p of partials) {
    const osc = new Osc()
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      buf[i]! += osc.sine(freq * p.ratio) * p.gain * env(t, 0.002, decay * p.decay)
    }
  }
  return buf
}

/** A dark, swelling pad note (low-passed saw pair, slightly detuned). */
function pad(freq: number, length: number, attack: number, cutoff = 600): Float32Array {
  const buf = buffer(length)
  const a = new Osc()
  const b = new Osc(0.37)
  const lp = new Biquad('lowpass', cutoff, 0.9)
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR
    const shape = Math.min(t / attack, 1) * Math.min((length - t) / (length * 0.5), 1)
    buf[i] = lp.process(a.saw(freq) + b.saw(freq * 1.006)) * shape * 0.5
  }
  return buf
}

/** Sparse random crackle (splinters, sparks, grit). */
function crackle(rng: Rng, density: number, decay: number, hpFreq: number, length: number) {
  const buf = buffer(length)
  const hp = new Biquad('highpass', hpFreq)
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR
    const impulse = rng() < density / SR ? (rng() * 2 - 1) * 4 : 0
    buf[i] = hp.process(impulse) * env(t, 0.001, decay)
  }
  return buf
}

interface VoiceSpec {
  length: number
  f0From: number
  f0To: number
  /** Formant frequencies (F1, F2, F3) at the start and end; the vowel morphs between them. */
  vowelFrom: readonly [number, number, number]
  vowelTo: readonly [number, number, number]
  /** 0–1: how ragged the voice is (amplitude flutter). */
  rough: number
  /** Breath noise level. */
  breath: number
  attack: number
}

/** A formant-filtered buzz: groans, snarls and death rattles. */
function voice(s: VoiceSpec, rng: Rng): Float32Array {
  const buf = buffer(s.length + 0.6)
  const n = new Noise(rng)
  const glottis = new Osc()
  const vibrato = new Osc(rng())
  const flutterLp = new Biquad('lowpass', 30)
  const jitterLp = new Biquad('lowpass', 6)
  const formants = [0, 1, 2].map((k) => new Biquad('bandpass', s.vowelFrom[k] ?? 500, 5 + k * 3))
  const gains = [1, 0.7, 0.35]
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR
    const k = Math.min(t / s.length, 1)
    if (i % 32 === 0) {
      formants.forEach((f, j) => {
        const from = s.vowelFrom[j] ?? 500
        const to = s.vowelTo[j] ?? 500
        f.set(from + (to - from) * k, 5 + j * 3)
      })
    }
    const jitter = 1 + jitterLp.process(n.white()) * 0.6
    const f0 = glide(t, s.f0From, s.f0To, s.length) * jitter * (1 + vibrato.sine(5.5) * 0.03)
    const flutter = 1 + flutterLp.process(n.white()) * 8 * s.rough
    const src = glottis.pulse(f0) * flutter + n.white() * s.breath
    let out = 0
    formants.forEach((f, j) => {
      out += f.process(src) * (gains[j] ?? 0)
    })
    const shape =
      t > s.length ? 0 : Math.min(t / s.attack, 1) * Math.pow(Math.sin(Math.PI * k), 0.6)
    buf[i] = saturate(out * shape * 4, 1.5)
  }
  addReverb(buf, 0.9, 0.35)
  return buf
}

// ─── Recipes ─────────────────────────────────────────────────────────────────────────────

const recipes: Record<SoundId, Recipe> = {
  shot_pistol: (rng) =>
    gunshot(
      {
        length: 0.7,
        crack: 2500,
        crackDecay: 0.006,
        body: 2600,
        bodyDecay: 0.03,
        thumpFrom: 150,
        thumpTo: 60,
        thumpDecay: 0.04,
        rt60: 0.6,
        wet: 0.35,
        drive: 1.6,
      },
      rng,
    ),
  shot_carbine: (rng) =>
    gunshot(
      {
        length: 0.8,
        crack: 3000,
        crackDecay: 0.008,
        body: 3200,
        bodyDecay: 0.035,
        thumpFrom: 120,
        thumpTo: 50,
        thumpDecay: 0.05,
        rt60: 0.7,
        wet: 0.35,
        drive: 2,
      },
      rng,
    ),
  shot_smg: (rng) =>
    gunshot(
      {
        length: 0.5,
        crack: 3500,
        crackDecay: 0.005,
        body: 3800,
        bodyDecay: 0.022,
        thumpFrom: 170,
        thumpTo: 80,
        thumpDecay: 0.03,
        rt60: 0.45,
        wet: 0.3,
        drive: 1.8,
      },
      rng,
    ),
  shot_shotgun: (rng) => {
    const buf = gunshot(
      {
        length: 1.2,
        crack: 1800,
        crackDecay: 0.01,
        body: 1500,
        bodyDecay: 0.07,
        thumpFrom: 110,
        thumpTo: 40,
        thumpDecay: 0.09,
        rt60: 0.9,
        wet: 0.4,
        drive: 2.5,
      },
      rng,
    )
    // Pump: back, then forward.
    mixInto(buf, clack(rng, 1700, 0.012, 3), 0.42, 0.35)
    mixInto(buf, clack(rng, 1200, 0.015, 4), 0.56, 0.45)
    return buf
  },
  shot_bolt: (rng) => {
    const buf = gunshot(
      {
        length: 1.3,
        crack: 3200,
        crackDecay: 0.01,
        body: 2400,
        bodyDecay: 0.05,
        thumpFrom: 100,
        thumpTo: 38,
        thumpDecay: 0.08,
        rt60: 1.1,
        wet: 0.45,
        drive: 2.6,
      },
      rng,
    )
    // Bolt cycled: up-back, forward-down.
    mixInto(buf, clack(rng, 2600, 0.008), 0.55, 0.3)
    mixInto(buf, clack(rng, 1900, 0.01), 0.7, 0.3)
    mixInto(buf, clack(rng, 2200, 0.01), 0.82, 0.35)
    return buf
  },
  shot_pulse: (rng) => {
    const buf = buffer(1.1)
    const n = new Noise(rng)
    const carrier = new Osc()
    const mod = new Osc()
    const sub = new Osc()
    const hiss = new Biquad('bandpass', 3000, 1.2)
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      const fc = glide(t, 1500, 160, 0.25)
      const index = 5 * env(t, 0.001, 0.09)
      const pm = Math.sin(2 * Math.PI * mod.step(fc * 0.5))
      const zap = Math.sin(2 * Math.PI * carrier.step(fc) + index * pm) * env(t, 0.002, 0.14)
      const air = hiss.process(n.white()) * env(t, 0.001, 0.05) * 0.8
      const low = sub.sine(glide(t, 130, 45, 0.1)) * env(t, 0.002, 0.1)
      buf[i] = saturate(zap * 0.8 + air + low, 1.4)
    }
    addReverb(buf, 0.8, 0.4)
    return buf
  },
  dry_fire: (rng) => {
    const buf = buffer(0.15)
    mixInto(buf, clack(rng, 3200, 0.006), 0)
    mixInto(buf, clack(rng, 1700, 0.008), 0.035, 0.6)
    return buf
  },
  reload_start: (rng) => {
    const buf = buffer(0.45)
    mixInto(buf, clack(rng, 1900, 0.01), 0)
    mixInto(buf, noiseBurst(rng, 'bandpass', 2600, 0.04, 0.05, 2), 0.08, 0.5)
    mixInto(buf, clack(rng, 1100, 0.014, 4), 0.24, 0.6)
    addReverb(buf, 0.3, 0.2)
    return buf
  },
  reload_end: (rng) => {
    const buf = buffer(0.6)
    mixInto(buf, clack(rng, 900, 0.018, 4), 0)
    mixInto(buf, thump(200, 120, 0.02), 0, 0.5)
    mixInto(buf, clack(rng, 2300, 0.01), 0.22, 0.8)
    mixInto(buf, clack(rng, 1600, 0.012), 0.3, 0.9)
    addReverb(buf, 0.3, 0.2)
    return buf
  },
  weapon_raise: (rng) => {
    const buf = buffer(0.35)
    mixInto(buf, noiseBurst(rng, 'bandpass', 1400, 0.06, 0.04, 0.8), 0, 0.5)
    mixInto(buf, clack(rng, 2500, 0.008), 0.17, 0.7)
    return buf
  },
  melee_swing: (rng) => {
    const buf = buffer(0.35)
    const n = new Noise(rng)
    const bp = new Biquad('bandpass', 400, 1.5)
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      const k = Math.min(t / 0.25, 1)
      if (i % 32 === 0) bp.set(400 + Math.sin(Math.PI * k) * 1200, 1.5)
      buf[i] = bp.process(n.white()) * Math.pow(Math.sin(Math.PI * k), 2)
    }
    return buf
  },
  melee_hit: (rng) => {
    const buf = buffer(0.35)
    mixInto(buf, thump(120, 55, 0.06), 0)
    mixInto(buf, noiseBurst(rng, 'lowpass', 700, 0.001, 0.04), 0, 0.8)
    mixInto(buf, noiseBurst(rng, 'bandpass', 320, 0.002, 0.06, 3), 0.01, 1.2)
    addReverb(buf, 0.4, 0.2)
    return buf
  },
  flesh_hit: (rng) => {
    const buf = buffer(0.25)
    mixInto(buf, noiseBurst(rng, 'lowpass', 1300, 0.0005, 0.02), 0)
    mixInto(buf, noiseBurst(rng, 'bandpass', 300, 0.002, 0.05, 3), 0.004, 1.4)
    mixInto(buf, thump(160, 80, 0.025), 0, 0.5)
    return buf
  },
  headshot: (rng) => {
    const buf = buffer(0.3)
    mixInto(buf, noiseBurst(rng, 'lowpass', 1600, 0.0005, 0.02), 0)
    mixInto(buf, noiseBurst(rng, 'bandpass', 380, 0.002, 0.05, 3), 0.003, 1.2)
    mixInto(buf, crackle(rng, 900, 0.05, 2500, 0.2), 0, 0.8)
    mixInto(buf, clack(rng, 1200, 0.01, 3), 0, 0.5)
    return buf
  },
  hit_tick: (rng) => {
    const buf = buffer(0.06)
    const osc = new Osc()
    for (let i = 0; i < buf.length; i++) buf[i] = osc.sine(2200) * env(i / SR, 0.0005, 0.01)
    mixInto(buf, clack(rng, 4000, 0.002), 0, 0.3)
    return buf
  },
  kill_tick: () => {
    const buf = buffer(0.14)
    const a = new Osc()
    const b = new Osc()
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      buf[i] = a.sine(1760) * env(t, 0.0005, 0.02) + b.sine(2640) * env(t - 0.035, 0.0005, 0.03)
    }
    return buf
  },
  impact_concrete: (rng) => {
    const buf = buffer(0.3)
    mixInto(buf, noiseBurst(rng, 'bandpass', 2800, 0.0003, 0.01, 1), 0)
    mixInto(buf, noiseBurst(rng, 'bandpass', 900, 0.0005, 0.025, 1.5), 0, 0.6)
    mixInto(buf, crackle(rng, 400, 0.04, 3000, 0.12), 0.005, 0.4)
    addReverb(buf, 0.35, 0.25)
    return buf
  },
  explosion: (rng) => {
    const buf = buffer(2.4)
    const n = new Noise(rng)
    const boom = new Osc()
    const rumble = new Biquad('lowpass', 500)
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      const low = boom.sine(glide(t, 90, 32, 0.4)) * env(t, 0.003, 0.35) * 1.4
      const body = rumble.process(n.brown()) * env(t, 0.005, 0.45) * 2
      buf[i] = saturate(low + body, 2)
    }
    mixInto(buf, crackle(rng, 2500, 0.3, 2000, 0.8), 0, 0.6)
    mixInto(buf, noiseBurst(rng, 'highpass', 1500, 0.001, 0.04), 0, 0.8)
    addReverb(buf, 1.6, 0.4)
    return buf
  },
  zombie_spawn: (rng) => {
    const buf = buffer(1.1)
    const n = new Noise(rng)
    const lp = new Biquad('lowpass', 320)
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      buf[i] = lp.process(n.brown()) * Math.sin(Math.PI * Math.min(t / 0.9, 1)) * 2
    }
    mixInto(buf, crackle(rng, 120, 0.5, 900, 0.9), 0.05, 0.5)
    return buf
  },
  zombie_groan_1: (rng) =>
    voice(
      {
        length: 1.5,
        f0From: 95,
        f0To: 70,
        vowelFrom: [520, 900, 2400],
        vowelTo: [620, 1050, 2500],
        rough: 0.5,
        breath: 0.25,
        attack: 0.15,
      },
      rng,
    ),
  zombie_groan_2: (rng) =>
    voice(
      {
        length: 1.8,
        f0From: 80,
        f0To: 100,
        vowelFrom: [330, 850, 2300],
        vowelTo: [600, 950, 2400],
        rough: 0.7,
        breath: 0.3,
        attack: 0.3,
      },
      rng,
    ),
  zombie_groan_3: (rng) =>
    voice(
      {
        length: 1.2,
        f0From: 110,
        f0To: 75,
        vowelFrom: [650, 1100, 2500],
        vowelTo: [450, 800, 2300],
        rough: 0.6,
        breath: 0.35,
        attack: 0.08,
      },
      rng,
    ),
  zombie_attack: (rng) =>
    voice(
      {
        length: 0.65,
        f0From: 170,
        f0To: 120,
        vowelFrom: [700, 1200, 2600],
        vowelTo: [600, 1000, 2500],
        rough: 1,
        breath: 0.5,
        attack: 0.03,
      },
      rng,
    ),
  zombie_death: (rng) => {
    const buf = voice(
      {
        length: 1.1,
        f0From: 120,
        f0To: 55,
        vowelFrom: [650, 1050, 2500],
        vowelTo: [350, 700, 2200],
        rough: 0.8,
        breath: 0.4,
        attack: 0.02,
      },
      rng,
    )
    mixInto(buf, noiseBurst(rng, 'bandpass', 250, 0.01, 0.15, 2), 0.5, 0.6)
    return buf
  },
  board_tear: (rng) => {
    const buf = buffer(0.8)
    // Nails creak, then the board cracks free with a spray of splinters.
    const creak = new Osc()
    const creakBp = new Biquad('bandpass', 900, 6)
    for (let i = 0; i < Math.round(0.22 * SR); i++) {
      const t = i / SR
      buf[i] =
        creakBp.process(creak.pulse(glide(t, 190, 110, 0.22))) * Math.sin((Math.PI * t) / 0.22)
    }
    mixInto(buf, clack(rng, 700, 0.02, 4), 0.2, 1.4)
    mixInto(buf, clack(rng, 1150, 0.015, 4), 0.24, 1)
    mixInto(buf, thump(180, 90, 0.03), 0.2, 0.6)
    mixInto(buf, crackle(rng, 1500, 0.12, 2500, 0.4), 0.2, 0.7)
    addReverb(buf, 0.5, 0.3)
    return buf
  },
  board_repair: (rng) => {
    const buf = buffer(0.65)
    for (const at of [0, 0.17, 0.34]) {
      mixInto(buf, thump(260, 160, 0.035), at)
      mixInto(buf, clack(rng, 1400, 0.01, 3), at, 0.6)
    }
    addReverb(buf, 0.4, 0.25)
    return buf
  },
  purchase: () => {
    const buf = buffer(1)
    mixInto(buf, bell(midi(76), 0.35), 0)
    mixInto(buf, bell(midi(83), 0.45), 0.09, 0.8)
    addReverb(buf, 0.6, 0.25)
    return buf
  },
  denied: () => {
    const buf = buffer(0.35)
    const osc = new Osc()
    const lp = new Biquad('lowpass', 900)
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      const gate = t < 0.1 || (t > 0.15 && t < 0.25) ? 1 : 0
      buf[i] = lp.process(osc.saw(110)) * gate
    }
    return buf
  },
  door_open: (rng) => {
    const buf = buffer(1.7)
    const n = new Noise(rng)
    const rumbleLp = new Biquad('lowpass', 250)
    const scrapeBp = new Biquad('bandpass', 900, 3)
    const flutterLp = new Biquad('lowpass', 12)
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      const swell = t < 1 ? Math.sin((Math.PI * t) / 1) : 0
      const flutter = 0.6 + flutterLp.process(n.white()) * 6
      buf[i] =
        rumbleLp.process(n.brown()) * swell * 1.5 +
        scrapeBp.process(n.white()) * swell * flutter * 0.6
    }
    mixInto(buf, thump(80, 40, 0.1), 1, 1.2)
    mixInto(buf, clack(rng, 420, 0.03, 3), 1, 0.8)
    addReverb(buf, 1, 0.35)
    return buf
  },
  crate_cycle: (rng) => {
    // Lid creak, then music-box notes that slow toward the reveal (paced like the
    // crate's cycling animation for a 3 s cycle), then a chord as the weapon settles.
    const buf = buffer(4.4)
    const creak = new Osc()
    const creakBp = new Biquad('bandpass', 700, 5)
    for (let i = 0; i < Math.round(0.35 * SR); i++) {
      const t = i / SR
      buf[i] =
        creakBp.process(creak.pulse(glide(t, 140, 90, 0.35))) * Math.sin((Math.PI * t) / 0.35) * 0.6
    }
    const scale = [72, 74, 76, 79, 81, 84, 86, 88]
    for (let t = 0.1; t < 2.75;) {
      const note = scale[Math.floor(rng() * scale.length)] ?? 76
      mixInto(buf, bell(midi(note), 0.12, 0.4), t, 0.5)
      const p = t / 3
      t += 0.06 + p * p * 0.35
    }
    for (const note of [72, 76, 79, 84]) mixInto(buf, bell(midi(note), 0.7), 2.95, 0.4)
    addReverb(buf, 1.2, 0.35)
    return buf
  },
  crate_depart: (rng) => {
    const buf = buffer(3)
    const n = new Noise(rng)
    const whoosh = new Biquad('bandpass', 300, 1.2)
    const a = new Osc()
    const b = new Osc()
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR
      const k = Math.min(t / 2.2, 1)
      if (i % 32 === 0) whoosh.set(300 + Math.sin(Math.PI * k) * 1500, 1.2)
      const air = whoosh.process(n.white()) * Math.sin(Math.PI * k) * 0.9
      // Two bell-ish tones sagging apart: the crate going somewhere else.
      const f = glide(t, midi(79), midi(67), 2)
      const tones = (a.sine(f) + b.sine(f * 1.06)) * env(t, 0.02, 0.9) * 0.4
      buf[i] = t < 2.2 ? air + tones : tones
    }
    mixInto(buf, thump(90, 45, 0.08), 0, 0.8)
    addReverb(buf, 1.4, 0.4)
    return buf
  },
  player_hurt: (rng) => {
    const buf = buffer(0.9)
    mixInto(buf, thump(85, 40, 0.12), 0)
    mixInto(buf, noiseBurst(rng, 'lowpass', 400, 0.002, 0.08), 0, 0.9)
    const ring = new Osc()
    for (let i = 0; i < buf.length; i++) buf[i]! += ring.sine(3400) * env(i / SR, 0.05, 0.35) * 0.06
    return buf
  },
  heartbeat: () => {
    const buf = buffer(0.7)
    mixInto(buf, thump(62, 40, 0.07), 0)
    mixInto(buf, thump(58, 38, 0.06), 0.27, 0.7)
    return buf
  },
  footstep_1: (rng) => {
    const buf = buffer(0.2)
    mixInto(buf, noiseBurst(rng, 'lowpass', 1100, 0.002, 0.02), 0)
    mixInto(buf, noiseBurst(rng, 'bandpass', 240, 0.002, 0.03, 2), 0, 0.8)
    mixInto(buf, crackle(rng, 600, 0.03, 3000, 0.08), 0.01, 0.3)
    return buf
  },
  footstep_2: (rng) => {
    const buf = buffer(0.2)
    mixInto(buf, noiseBurst(rng, 'lowpass', 950, 0.003, 0.022), 0)
    mixInto(buf, noiseBurst(rng, 'bandpass', 210, 0.002, 0.03, 2), 0, 0.8)
    mixInto(buf, crackle(rng, 600, 0.03, 3000, 0.08), 0.015, 0.3)
    return buf
  },
  land: (rng) => {
    const buf = buffer(0.35)
    mixInto(buf, noiseBurst(rng, 'lowpass', 800, 0.002, 0.04), 0)
    mixInto(buf, thump(110, 50, 0.05), 0, 0.9)
    mixInto(buf, crackle(rng, 800, 0.05, 2500, 0.12), 0.005, 0.3)
    return buf
  },
  round_start: () => {
    // A low drone under a slow, crawling half-step figure.
    const buf = buffer(5)
    mixInto(buf, pad(midi(38), 3.8, 0.8, 420), 0, 0.9)
    mixInto(buf, pad(midi(45), 3.4, 1, 380), 0.2, 0.6)
    const figure: [number, number][] = [
      [57, 0.3],
      [58, 0.8],
      [57, 1.3],
      [50, 2],
    ]
    for (const [note, at] of figure) {
      mixInto(buf, bell(midi(note), 0.6), at, 0.7)
      mixInto(buf, pad(midi(note), 0.9, 0.05, 900), at, 0.3)
    }
    addReverb(buf, 2.2, 0.5)
    return buf
  },
  round_end: () => {
    // Rising figure that lifts the tension: the wave is over.
    const buf = buffer(4)
    mixInto(buf, pad(midi(50), 2.8, 0.4, 500), 0, 0.6)
    const figure: [number, number][] = [
      [62, 0],
      [65, 0.28],
      [69, 0.56],
      [74, 0.9],
    ]
    for (const [note, at] of figure) mixInto(buf, bell(midi(note), 0.7), at, 0.7)
    addReverb(buf, 2, 0.5)
    return buf
  },
  game_over: () => {
    const buf = buffer(6)
    mixInto(buf, pad(midi(33), 5, 1.2, 350), 0, 1)
    const figure: [number, number][] = [
      [57, 0.2],
      [55, 0.9],
      [53, 1.6],
      [50, 2.4],
      [45, 3.4],
    ]
    for (const [note, at] of figure) {
      mixInto(buf, bell(midi(note), 0.9), at, 0.6)
      mixInto(buf, pad(midi(note), 1.2, 0.1, 700), at, 0.35)
    }
    addReverb(buf, 2.5, 0.5)
    return buf
  },
}

function seedFor(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Renders one sound: normalised, click-free mono samples at `SAMPLE_RATE`. */
export function renderSound(id: SoundId): Float32Array {
  return finish(recipes[id](createRng(seedFor(id))))
}
