import * as THREE from 'three'

/** Voices for sounds heard "in the head" (player's own gun, UI, stings). */
const FLAT_VOICES = 12
/** Voices for sounds placed in the world (zombies, impacts, doors, the crate). */
const POSITIONAL_VOICES = 24

interface Voice<T extends THREE.Audio<GainNode | PannerNode>> {
  readonly audio: T
  startedAt: number
}

/**
 * The game's audio output: one AudioListener on the camera, a bank of decoded buffers
 * keyed by id, and fixed pools of flat and positional voices for one-shots. When every
 * voice in a pool is busy the oldest is cut off, so a firefight never allocates voices.
 */
export class AudioEngine {
  readonly listener = new THREE.AudioListener()
  /** Holds the positional voices; add it to the scene so they get world transforms. */
  readonly group = new THREE.Group()

  private readonly camera: THREE.Camera
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly flat: Voice<THREE.Audio>[] = []
  private readonly positional: Voice<THREE.PositionalAudio>[] = []
  private disposed = false

  constructor(camera: THREE.Camera) {
    this.camera = camera
    camera.add(this.listener)
    for (let i = 0; i < FLAT_VOICES; i++) {
      this.flat.push({ audio: new THREE.Audio(this.listener), startedAt: 0 })
    }
    for (let i = 0; i < POSITIONAL_VOICES; i++) {
      const audio = new THREE.PositionalAudio(this.listener)
      audio.setRefDistance(2.5)
      audio.setRolloffFactor(1.3)
      audio.setMaxDistance(60)
      audio.setDistanceModel('inverse')
      this.group.add(audio)
      this.positional.push({ audio, startedAt: 0 })
    }
  }

  get context(): AudioContext {
    return this.listener.context
  }

  /** Browsers start audio suspended until a user gesture; call this from one. */
  unlock(): void {
    if (this.context.state === 'suspended') void this.context.resume()
  }

  setMasterVolume(volume: number): void {
    this.listener.setMasterVolume(volume)
  }

  /** Adds mono `samples` to the bank as `id`. */
  add(id: string, samples: Float32Array, sampleRate: number): void {
    const buf = this.context.createBuffer(1, samples.length, sampleRate)
    buf.getChannelData(0).set(samples)
    this.buffers.set(id, buf)
  }

  has(id: string): boolean {
    return this.buffers.has(id)
  }

  /** For the stats/debug view: sounds loaded, and voices currently sounding. */
  status(): {
    context: AudioContextState
    loaded: number
    flatBusy: number
    positionalBusy: number
  } {
    const busy = (pool: Voice<THREE.Audio<GainNode | PannerNode>>[]) =>
      pool.filter((v) => v.audio.isPlaying).length
    return {
      context: this.context.state,
      loaded: this.buffers.size,
      flatBusy: busy(this.flat),
      positionalBusy: busy(this.positional),
    }
  }

  /**
   * Renders and adds sounds one at a time, yielding to the browser between them, so a
   * large procedural bank never blocks a frame for long. Sounds become playable as they
   * finish; playing one that isn't ready yet is silently skipped.
   */
  async loadProgressively(
    ids: readonly string[],
    render: (id: string) => Float32Array,
    sampleRate: number,
  ): Promise<void> {
    for (const id of ids) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (this.disposed) return
      this.add(id, render(id), sampleRate)
    }
  }

  /** Plays `id` without position (in the player's head). `rate` > 1 plays faster and higher. */
  play(id: string, volume = 1, rate = 1): void {
    const buffer = this.buffers.get(id)
    if (!buffer || this.context.state !== 'running') return
    const voice = this.pick(this.flat)
    this.start(voice, buffer, volume, rate)
  }

  /** Plays `id` from a point in the world. */
  playAt(id: string, position: THREE.Vector3Like, volume = 1, rate = 1): void {
    const buffer = this.buffers.get(id)
    if (!buffer || this.context.state !== 'running') return
    const voice = this.pick(this.positional)
    const { audio } = voice
    audio.position.set(position.x, position.y, position.z)
    audio.updateMatrixWorld()
    // Jump the panner straight there: a reused voice must not glide from its last position.
    const { panner } = audio
    const now = this.context.currentTime
    for (const [param, value] of [
      [panner.positionX, position.x],
      [panner.positionY, position.y],
      [panner.positionZ, position.z],
    ] as const) {
      param.cancelScheduledValues(now)
      param.setValueAtTime(value, now)
    }
    this.start(voice, buffer, volume, rate)
  }

  dispose(): void {
    this.disposed = true
    for (const v of [...this.flat, ...this.positional]) {
      if (v.audio.isPlaying) v.audio.stop()
      v.audio.disconnect()
    }
    this.camera.remove(this.listener)
    this.buffers.clear()
  }

  private pick<T extends THREE.Audio<GainNode | PannerNode>>(pool: Voice<T>[]): Voice<T> {
    let oldest = pool[0]!
    for (const v of pool) {
      if (!v.audio.isPlaying) return v
      if (v.startedAt < oldest.startedAt) oldest = v
    }
    return oldest
  }

  private start<T extends THREE.Audio<GainNode | PannerNode>>(
    voice: Voice<T>,
    buffer: AudioBuffer,
    volume: number,
    rate: number,
  ): void {
    const { audio } = voice
    if (audio.isPlaying) audio.stop()
    audio.setBuffer(buffer)
    audio.setVolume(volume)
    audio.setPlaybackRate(rate)
    audio.play()
    voice.startedAt = this.context.currentTime
  }
}
