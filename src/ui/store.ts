import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { HitZone } from '../game/entities/hitboxes'
import type { RoundPhase } from '../game/systems/RoundSystem'
import type { WeaponHudState } from '../game/systems/WeaponSystem'

export type GameStatus = 'loading' | 'running' | 'gameOver' | 'error'

export interface HitFeedEntry {
  id: number
  zone: HitZone
  damage: number
  killed: boolean
  healthLeft: number
}

/** The crosshair hit marker: a new id flashes it again. */
export interface HitMarker {
  id: number
  kind: 'hit' | 'head' | 'kill'
}

export interface PointPopup {
  id: number
  delta: number
}

export interface GameOverSummary {
  round: number
  kills: number
  headshots: number
  points: number
}

/** Snapshot of game state for the UI. The game writes it (throttled); React only reads it. */
export interface UiSnapshot {
  status: GameStatus
  error: string | null
  mapName: string | null
  pointerLocked: boolean
  /** Stats line (fps, draw calls, zombies, position). Toggled with backtick. */
  statsVisible: boolean
  fps: number
  /** Milliseconds of CPU per frame spent in simulation + rendering calls (averaged). */
  frameMs: number
  drawCalls: number
  zombiesAlive: number
  /** Player feet position, rounded to 0.1 m. Shown in the stats line to help map authors. */
  playerPos: readonly [number, number, number]
  weapon: WeaponHudState | null
  /** 0–1. */
  health: number
  /** Increments on every hit the player takes; the HUD keys its damage flash on it. */
  damageCount: number
  points: number
  /** Recent "+N" popups; each fades out by itself. */
  pointPopups: readonly PointPopup[]
  /** "Hold F to …" text for whatever the player is looking at, or null. */
  interactPrompt: string | null
  /** Current round (0 before round 1). */
  round: number
  roundPhase: RoundPhase
  /** Whole seconds until the next round, during the intro and intermissions. */
  roundCountdown: number
  zombiesRemaining: number
  /** Round number to announce; changes when a round starts, the banner keys on it. */
  roundBanner: number
  gameOver: GameOverSummary | null
  hitMarker: HitMarker | null
  /** Most recent target hits, newest first. */
  hitFeed: readonly HitFeedEntry[]
  /** Set by the app shell; starts a fresh game. */
  restart: (() => void) | null
}

export function initialUiState(): UiSnapshot {
  return {
    status: 'loading',
    error: null,
    mapName: null,
    pointerLocked: false,
    statsVisible: import.meta.env.DEV,
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    zombiesAlive: 0,
    playerPos: [0, 0, 0],
    weapon: null,
    health: 1,
    damageCount: 0,
    points: 0,
    pointPopups: [],
    interactPrompt: null,
    round: 0,
    roundPhase: 'intro',
    roundCountdown: 0,
    zombiesRemaining: 0,
    roundBanner: 0,
    gameOver: null,
    hitMarker: null,
    hitFeed: [],
    restart: null,
  }
}

export const uiStore = createStore<UiSnapshot>(initialUiState)

export function useUi<T>(selector: (s: UiSnapshot) => T): T {
  return useStore(uiStore, selector)
}
