import * as THREE from 'three'
import type { Rng } from '../../engine/rng'
import { soundVolume, type SoundId } from '../audio/sounds'
import type { AudioTuning, ZombieTuning } from '../config/balance'
import type { Crate } from '../entities/Crate'
import type { Door } from '../entities/Door'
import type { Player } from '../entities/Player'
import type { SpawnWindow } from '../entities/SpawnWindow'
import type { Zombie, ZombieState } from '../entities/Zombie'
import type { GameEventBus } from '../events'
import { weaponDefs } from '../weapons/definitions'

/** Where sounds go: the AudioEngine in the game, a recorder in tests. */
export interface SoundOutput {
  play(id: SoundId, volume: number, rate: number): void
  playAt(id: SoundId, position: THREE.Vector3Like, volume: number, rate: number): void
}

const GROANS: readonly SoundId[] = ['zombie_groan_1', 'zombie_groan_2', 'zombie_groan_3']

/**
 * Turns what happens in the game into sound: listens to events (shots, hits, purchases,
 * rounds) and watches the player and zombies for things that have no event (footsteps,
 * landings, groans, a zombie starting a swing or dying). Owns no audio itself.
 */
export class SoundSystem {
  private readonly out: SoundOutput
  private readonly player: Player
  private readonly zombies: readonly Zombie[]
  private readonly rng: Rng
  private readonly t: AudioTuning
  private readonly zombieTuning: ZombieTuning
  private readonly unsubscribers: (() => void)[] = []

  private readonly lastState: ZombieState[]
  private readonly groanTimers: number[]
  private groanCooldown = 0
  private hitSoundsThisStep = 0
  private tickThisStep: 'hit' | 'kill' | null = null
  private stride = 0
  private footIndex = 0
  private fallSpeed = 0
  private wasGrounded = true
  private health = 1
  private heartbeatTimer = 0
  private readonly headPos = new THREE.Vector3()

  constructor(
    events: GameEventBus,
    out: SoundOutput,
    player: Player,
    zombies: readonly Zombie[],
    windows: readonly SpawnWindow[],
    doors: readonly Door[],
    crate: Crate | null,
    rng: Rng,
    tuning: AudioTuning,
    zombieTuning: ZombieTuning,
  ) {
    this.out = out
    this.player = player
    this.zombies = zombies
    this.rng = rng
    this.t = tuning
    this.zombieTuning = zombieTuning
    this.lastState = zombies.map((z) => z.state)
    this.groanTimers = zombies.map(() => this.nextGroanDelay())

    const windowAt = new Map(windows.map((w) => [w.id, w.center]))
    const doorAt = new Map(doors.map((d) => [d.id, d.center]))
    const at = (p: readonly [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] })

    this.unsubscribers.push(
      events.on('weaponFired', (e) => this.play(weaponDefs[e.weaponId].fireSound, 1, 0.04)),
      events.on('dryFire', () => this.play('dry_fire')),
      events.on('reloadStarted', () => this.play('reload_start')),
      events.on('reloadFinished', () => this.play('reload_end')),
      events.on('weaponSwitched', () => this.play('weapon_raise')),
      events.on('meleeSwung', () => this.play('melee_swing', 1, 0.08)),
      events.on('targetHit', (e) => {
        // One tick per step however many pellets connected; a kill outranks a hit.
        if (e.killed) this.tickThisStep = 'kill'
        else this.tickThisStep ??= 'hit'
      }),
      events.on('targetStruck', (e) => {
        if (e.cause === 'splash' || this.hitSoundsThisStep >= this.t.hitSoundsPerStep) return
        this.hitSoundsThisStep++
        const id: SoundId =
          e.cause === 'melee' ? 'melee_hit' : e.zone === 'head' ? 'headshot' : 'flesh_hit'
        this.playAt(id, at(e.point), e.targetKind === 'dummy' ? 0.6 : 1, 0.12)
      }),
      events.on('shotImpact', (e) => {
        if (this.hitSoundsThisStep >= this.t.hitSoundsPerStep) return
        this.hitSoundsThisStep++
        this.playAt('impact_concrete', at(e.point), 0.8 + this.rng() * 0.2, 0.15)
      }),
      events.on('explosion', (e) => this.playAt('explosion', at(e.point), 1, 0.05)),
      events.on('playerHit', () => this.play('player_hurt', 1, 0.05)),
      events.on('playerHealthChanged', (e) => {
        this.health = e.max > 0 ? e.health / e.max : 0
      }),
      events.on('boardTorn', (e) => {
        const p = windowAt.get(e.windowId)
        if (p) this.playAt('board_tear', p, 1, 0.1)
      }),
      events.on('boardRepaired', (e) => {
        const p = windowAt.get(e.windowId)
        if (p) this.playAt('board_repair', p, 1, 0.08)
      }),
      events.on('pointsChanged', (e) => {
        if (e.delta < 0) this.play('purchase')
      }),
      events.on('purchaseDenied', () => this.play('denied')),
      events.on('doorOpened', (e) => {
        const p = doorAt.get(e.doorId)
        if (p) this.playAt('door_open', p, 1, 0)
      }),
      events.on('crateSpun', () => {
        if (crate) this.playAt('crate_cycle', crate.position, 1, 0)
      }),
      events.on('crateRelocating', () => {
        if (crate) this.playAt('crate_depart', crate.position, 1, 0)
      }),
      events.on('roundStarted', () => this.play('round_start')),
      events.on('roundEnded', () => this.play('round_end')),
      events.on('gameOver', () => this.play('game_over')),
    )
  }

  /** Call once per step, after every other system has run (so this step's hits are in). */
  update(dt: number): void {
    this.flushTick()
    this.hitSoundsThisStep = 0
    this.updateFootsteps(dt)
    this.updateHeartbeat(dt)
    this.updateZombies(dt)
  }

  dispose(): void {
    for (const off of this.unsubscribers) off()
  }

  /** Plays the one hit/kill tick collected over this step. */
  private flushTick(): void {
    if (this.tickThisStep === 'kill') this.play('kill_tick')
    else if (this.tickThisStep === 'hit') this.play('hit_tick', 1, 0.05)
    this.tickThisStep = null
  }

  private updateFootsteps(dt: number): void {
    const p = this.player
    const speed = Math.hypot(p.velocity.x, p.velocity.z)
    if (!p.grounded) {
      this.fallSpeed = Math.max(this.fallSpeed, -p.velocity.y)
    } else if (!this.wasGrounded) {
      if (this.fallSpeed >= this.t.landSpeed) this.play('land', 1, 0.05)
      this.fallSpeed = 0
      this.stride = 0
    }
    this.wasGrounded = p.grounded
    if (!p.grounded || speed < this.t.footstepMinSpeed) return

    this.stride += speed * dt
    // Faster movement takes longer strides, but not proportionally: sprinting steps quicken.
    const strideLength = this.t.strideLength * (0.75 + speed / 16)
    if (this.stride < strideLength) return
    this.stride -= strideLength
    this.footIndex = 1 - this.footIndex
    this.play(this.footIndex === 0 ? 'footstep_1' : 'footstep_2', 1, 0.08)
  }

  private updateHeartbeat(dt: number): void {
    if (this.health <= 0 || this.health >= this.t.heartbeatBelow) {
      this.heartbeatTimer = 0
      return
    }
    this.heartbeatTimer -= dt
    if (this.heartbeatTimer > 0) return
    this.heartbeatTimer = this.t.heartbeatInterval
    this.play('heartbeat', 0.5 + (1 - this.health / this.t.heartbeatBelow) * 0.5, 0)
  }

  private updateZombies(dt: number): void {
    this.groanCooldown -= dt
    for (const z of this.zombies) {
      const i = z.index
      const previous = this.lastState[i]
      if (z.state !== previous) {
        this.lastState[i] = z.state
        this.onZombieState(z)
      }
      if (!z.alive || z.state === 'spawning') continue

      this.groanTimers[i] = (this.groanTimers[i] ?? 0) - dt
      if ((this.groanTimers[i] ?? 0) > 0 || this.groanCooldown > 0) continue
      this.groanTimers[i] = this.nextGroanDelay()
      this.groanCooldown = this.t.groanSpacing
      const groan = GROANS[Math.floor(this.rng() * GROANS.length)] ?? 'zombie_groan_1'
      // Runners sound younger and more frantic.
      const rate = z.speed > this.zombieTuning.walkSpeed ? 1.15 : 0.95
      this.playAt(groan, this.head(z), 1, 0.1, rate)
    }
  }

  private onZombieState(z: Zombie): void {
    switch (z.state) {
      case 'spawning':
        this.groanTimers[z.index] = this.nextGroanDelay() * 0.5
        this.playAt('zombie_spawn', z.position, 1, 0.1)
        break
      case 'attacking':
        this.playAt('zombie_attack', this.head(z), 1, 0.1)
        break
      case 'dead':
        this.playAt('zombie_death', this.head(z), 1, 0.12)
        break
    }
  }

  private head(z: Zombie): THREE.Vector3 {
    return this.headPos.copy(z.position).setY(z.position.y + 1.6)
  }

  private nextGroanDelay(): number {
    const { groanIntervalMin: min, groanIntervalMax: max } = this.t
    return min + this.rng() * (max - min)
  }

  /** `jitter` randomises pitch by up to ± that fraction, so repeats don't sound identical. */
  private play(id: SoundId, volume = 1, jitter = 0): void {
    this.out.play(id, soundVolume[id] * volume, this.jittered(1, jitter))
  }

  private playAt(id: SoundId, position: THREE.Vector3Like, volume = 1, jitter = 0, rate = 1): void {
    this.out.playAt(id, position, soundVolume[id] * volume, this.jittered(rate, jitter))
  }

  private jittered(rate: number, jitter: number): number {
    return jitter > 0 ? rate * (1 + (this.rng() * 2 - 1) * jitter) : rate
  }
}
