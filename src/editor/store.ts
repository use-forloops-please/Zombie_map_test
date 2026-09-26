import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { MapIssue } from '../maps/schema'
import type { ItemRef } from './document'
import type { Editor } from './Editor'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface EditorIssue extends MapIssue {
  ref: ItemRef | null
}

/** What the editor panels show. The Editor writes it; React reads it and calls the Editor. */
export interface EditorUiState {
  editor: Editor | null
  /** Changes whenever the map changes, so panels re-read it from the Editor's document. */
  revision: number
  selection: ItemRef | null
  mode: GizmoMode
  snap: boolean
  canUndo: boolean
  canRedo: boolean
  /** Schema problems in the current map (checked on every change). */
  issues: readonly EditorIssue[]
  /** Result of the last "Check navmesh" (the loader's own window/navmesh checks). */
  navCheck: { status: 'idle' | 'running' | 'ok' | 'failed'; message: string }
  showNavmesh: boolean
  /** A short confirmation ("Copied map.json") shown briefly. */
  toast: { id: number; text: string } | null
}

export const editorStore = createStore<EditorUiState>(() => ({
  editor: null,
  revision: 0,
  selection: null,
  mode: 'translate',
  snap: true,
  canUndo: false,
  canRedo: false,
  issues: [],
  navCheck: { status: 'idle', message: '' },
  showNavmesh: false,
  toast: null,
}))

export function useEditorUi<T>(selector: (s: EditorUiState) => T): T {
  return useStore(editorStore, selector)
}
