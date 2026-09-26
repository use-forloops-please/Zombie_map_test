import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadBrushTextures, noBrushTextures } from '../maps/brushes'
import { textureIds } from '../maps/textures'
import { EditorDocument, newMapDraft, type MapDraft } from './document'
import { Editor } from './Editor'
import { EditorUi } from './EditorUi'
import { editorStore } from './store'
import './editor.css'

/**
 * Starts the map editor on the page's canvas (`?editor`). With `mapId`, opens
 * `public/maps/<mapId>/map.json` as written (defaults are not filled in, so an export
 * stays as close to the original file as possible).
 */
export async function bootEditor(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  mapId: string | null,
): Promise<void> {
  document.title = 'Project Holdout — Map Editor'
  let draft: MapDraft = newMapDraft()
  let problem: string | null = null
  if (mapId) {
    const url = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}/map.json`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      draft = (await res.json()) as MapDraft
    } catch (err) {
      problem = `Couldn't open map "${mapId}" (${String(err)}); started a new map instead.`
    }
  }

  // Every texture, so any can be picked. Without them brushes show the greybox grid.
  const textures = await loadBrushTextures(textureIds).catch((err: unknown) => {
    problem = `Textures didn't load (${String(err)}); showing greybox materials.`
    return noBrushTextures
  })
  const editor = new Editor(canvas, new EditorDocument(draft), textures)
  editor.start()
  createRoot(uiRoot).render(
    <StrictMode>
      <EditorUi />
    </StrictMode>,
  )
  if (import.meta.env.DEV) {
    // For automated checks, like window.__holdout in the game.
    ;(window as unknown as { __editor?: Editor }).__editor = editor
  }
  if (problem) editorStore.setState({ toast: { id: 0, text: problem } })
  import.meta.hot?.dispose(() => editor.dispose())
}
