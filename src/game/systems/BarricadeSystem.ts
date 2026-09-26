import * as THREE from 'three'
import type { BarricadeTuning } from '../config/balance'
import type { SpawnWindow } from '../entities/SpawnWindow'
import type { GameEventBus } from '../events'
import type { Interactable } from './InteractSystem'

/**
 * Owns window boards: zombies tear them off through `tear`, the player rebuilds them by
 * holding interact at the window. Every change is announced as an event.
 */
export class BarricadeSystem {
  readonly windows: readonly SpawnWindow[]
  private readonly events: GameEventBus
  private readonly t: BarricadeTuning

  constructor(windows: readonly SpawnWindow[], events: GameEventBus, tuning: BarricadeTuning) {
    this.windows = windows
    this.events = events
    this.t = tuning
  }

  tear(w: SpawnWindow): boolean {
    if (!w.removeBoard()) return false
    this.events.emit('boardTorn', { windowId: w.id, boards: w.boards })
    return true
  }

  repair(w: SpawnWindow): boolean {
    if (!w.addBoard()) return false
    this.events.emit('boardRepaired', { windowId: w.id, boards: w.boards })
    return true
  }

  /** One "hold to rebuild" interactable per window, standing on the inside. */
  createInteractables(): Interactable[] {
    return this.windows.map((w) => {
      const position = new THREE.Vector3().copy(w.center).addScaledVector(w.outward, -0.4)
      let progress = 0
      return {
        position,
        range: this.t.interactRange,
        prompt: () => (w.boards < w.maxBoards ? 'Hold F to rebuild barrier' : null),
        hold: (dt: number) => {
          progress += dt
          if (progress < this.t.repairInterval) return
          progress -= this.t.repairInterval
          this.repair(w)
        },
        release: () => {
          progress = 0
        },
      }
    })
  }
}
