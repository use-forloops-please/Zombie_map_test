import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

createRoot(uiRoot).render(
  <StrictMode>
    <Hud />
  </StrictMode>,
)

// `?map=<id>` loads public/maps/<id>/map.json; handy for testing custom maps.
// `?debug=nav` draws the navmesh. `?lighting=<preset>` previews a lighting preset.
const params = new URLSearchParams(window.location.search)
const mapId = params.get('map') ?? 'bunker-01'
const debug = new Set((params.get('debug') ?? '').split(','))
const lightingParam = params.get('lighting')
const lighting = lightingPresetIds.find((id) => id === lightingParam)

// The game lives outside React; the UI only observes it through the store.
let game: Game | null = null

function boot(): void {
  Game.create(canvas as HTMLCanvasElement, mapId, { showNavmesh: debug.has('nav'), lighting })
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
