import * as THREE from 'three'
import type { Input } from '../../engine/Input'
import { viewDirection, type Player } from '../entities/Player'

/** Something the player can use by holding the interact key near it. */
export interface Interactable {
  /** World position the player must be near (compared horizontally). */
  readonly position: THREE.Vector3
  readonly range: number
  /** Prompt text when usable right now, or null to hide it (e.g. a fully boarded window). */
  prompt(): string | null
  /** Called every step while the interact key is held and this is the focused interactable. */
  hold(dt: number): void
  /** Called when the player stops holding (or looks away / walks off) mid-use. */
  release(): void
}

/**
 * Hold/release handlers that run `action` once per press of the interact key: for purchases,
 * where holding F must not buy again every frame.
 */
export function oncePerPress(action: () => void): Pick<Interactable, 'hold' | 'release'> {
  let used = false
  return {
    hold: () => {
      if (used) return
      used = true
      action()
    },
    release: () => {
      used = false
    },
  }
}

/** Only interactables roughly in front of the player can be focused (cosine of the half-angle). */
const MIN_FACING = 0.2

/**
 * "Hold F to …" prompts: each step, focuses the nearest usable interactable the player is
 * facing and forwards held input to it. Windows use it now; doors, wall-buys and the crate
 * register later.
 */
export class InteractSystem {
  private readonly player: Player
  private readonly input: Pick<Input, 'isDown'>
  private readonly items: Interactable[] = []
  private focused: Interactable | null = null
  private holding = false
  private readonly look = new THREE.Vector3()

  constructor(player: Player, input: Pick<Input, 'isDown'>) {
    this.player = player
    this.input = input
  }

  add(item: Interactable): void {
    this.items.push(item)
  }

  /** Prompt for the focused interactable, or null. */
  get prompt(): string | null {
    return this.focused?.prompt() ?? null
  }

  update(dt: number): void {
    const next = this.pickFocus()
    if (next !== this.focused && this.holding) {
      this.focused?.release()
      this.holding = false
    }
    this.focused = next

    const held = next !== null && this.input.isDown('interact')
    if (held) next.hold(dt)
    else if (this.holding) this.focused?.release()
    this.holding = held
  }

  private pickFocus(): Interactable | null {
    const p = this.player.position
    viewDirection(this.player, this.look)
    const lookLen = Math.hypot(this.look.x, this.look.z) || 1
    let best: Interactable | null = null
    let bestDist = Infinity
    for (const item of this.items) {
      const dx = item.position.x - p.x
      const dz = item.position.z - p.z
      const d = Math.hypot(dx, dz)
      if (d > item.range || d >= bestDist) continue
      const facing = d < 1e-3 ? 1 : (dx * this.look.x + dz * this.look.z) / (d * lookLen)
      if (facing < MIN_FACING || item.prompt() === null) continue
      best = item
      bestDist = d
    }
    return best
  }
}
