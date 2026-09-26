import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PLAYTEST_KEY } from './editor/playtest'
import { Game } from './engine/Game'
import { lightingPresetIds } from './maps/lighting'
import { Hud } from './ui/Hud'
import { initialUiState, uiStore } from './ui/store'
import './ui/hud.css'

const canvas = document.getElementById('game')
const uiRoot = document.getElementById('ui')
if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
  throw new Error('index.html is missing #game canvas or #ui root')
}

// `?map=<id>` loads public/maps/<id>/map.json; handy for testing custom maps.
// `?debug=nav` draws the navmesh. `?lighting=<preset>` previews a lighting preset.
// `?editor` (or `?editor=<id>` to open a map) starts the map editor instead of the game.
// `?playtest` plays the map the editor last sent with "Play test".
const params = new URLSearchParams(window.location.search)

if (params.has('editor')) {
  // Loaded on demand, so the game itself never downloads the editor.
  void import('./editor/boot').then(({ bootEditor }) =>
    bootEditor(canvas, uiRoot, params.get('editor') || null),
  )
} else {
  startGame(canvas, uiRoot)
}

function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  createRoot(uiRoot).render(
    <StrictMode>
      <Hud />
    </StrictMode>,
  )

  const debug = new Set((params.get('debug') ?? '').split(','))
  const lightingParam = params.get('lighting')
  const lighting = lightingPresetIds.find((id) => id === lightingParam)
  const playtest = params.has('playtest')

  // The game lives outside React; the UI only observes it through the store.
  let game: Game | null = null

  function boot(): void {
    let mapId = params.get('map') ?? 'bunker-01'
    let mapJson: unknown
    if (playtest) {
      const text = readPlaytest()
      if (text === null) {
        uiStore.setState({
          status: 'error',
          error: 'No play-test map found. Open the editor (?editor) and press "Play test".',
        })
        return
      }
      mapJson = JSON.parse(text)
      const id = (mapJson as { id?: unknown }).id
      if (typeof id === 'string') mapId = id
    }
    Game.create(canvas, mapId, { showNavmesh: debug.has('nav'), lighting, mapJson })
      .then((g) => {
        game = g
        game.start()
        if (import.meta.env.DEV) {
          ;(window as unknown as { __holdout?: unknown }).__holdout = g.debugApi()
        }
      })
      .catch((err: unknown) => {
        console.error(err)
        uiStore.setState({
          status: 'error',
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        })
      })
  }

  /** Throws away the current game and starts a new one on the same canvas. */
  function restart(): void {
    game?.dispose()
    game = null
    uiStore.setState({ ...initialUiState(), restart })
    boot()
  }

  uiStore.setState({ restart })
  boot()

  import.meta.hot?.dispose(() => {
    game?.dispose()
    game = null
  })
}

function readPlaytest(): string | null {
  try {
    return localStorage.getItem(PLAYTEST_KEY)
  } catch {
    return null
  }
}
