import type { z } from 'zod'
import { weaponIds } from '../game/weapons/definitions'
import { checkMap, type MapDef, type MapIssue, type mapSchema } from '../maps/schema'
import { formatJson } from './formatJson'

/*
 * The map being edited, as plain map.json data, plus everything the editor does to it:
 * adding, moving, resizing, turning, deleting, undo/redo, validation and export. No three.js
 * or DOM here, so it is unit-tested directly. The 3D view and the panels only read it and
 * call these methods.
 */

/** map.json as written (before schema defaults are filled in). */
export type MapDraft = z.input<typeof mapSchema>
type Vec3 = [number, number, number]

export const itemKinds = [
  'brush',
  'spawn',
  'zone',
  'window',
  'door',
  'wallBuy',
  'crateSpot',
  'dummy',
  'lamp',
] as const
export type ItemKind = (typeof itemKinds)[number]

/** Points at one thing in the map. `outside` is a window's zombie-spawn point. */
export interface ItemRef {
  kind: ItemKind
  index: number
  handle?: 'outside'
}

export const itemLabels: Record<ItemKind, string> = {
  brush: 'Brush',
  spawn: 'Player spawn',
  zone: 'Zone',
  window: 'Window',
  door: 'Door',
  wallBuy: 'Wall-buy',
  crateSpot: 'Crate spot',
  dummy: 'Target dummy',
  lamp: 'Lamp',
}

/** Which map.json list each kind lives in. */
const LIST_KEY = {
  brush: 'brushes',
  spawn: 'playerSpawns',
  zone: 'zones',
  window: 'windows',
  door: 'doors',
  wallBuy: 'wallBuys',
  crateSpot: 'crateSpots',
  dummy: 'targetDummies',
} as const satisfies Record<Exclude<ItemKind, 'lamp'>, string>

/** Kinds that are boxes (resizable, never rotated). */
export const boxKinds: readonly ItemKind[] = ['brush', 'zone', 'door']
/** Kinds with a facing (yaw). */
export const facingKinds: readonly ItemKind[] = ['spawn', 'window', 'wallBuy', 'crateSpot', 'dummy']

const MIN_SIZE = 0.05
const HISTORY_LIMIT = 200

/** Rounds to 1 mm so exported numbers stay tidy. */
const tidy = (n: number): number => Math.round(n * 1000) / 1000 + 0
const tidyVec = (v: readonly number[]): Vec3 => [tidy(v[0] ?? 0), tidy(v[1] ?? 0), tidy(v[2] ?? 0)]

export function newMapDraft(id = 'new-map'): MapDraft {
  return {
    id,
    name: 'New Map',
    version: 1,
    brushes: [
      {
        type: 'box',
        pos: [0, -0.25, 0],
        size: [24, 0.5, 24],
        material: 'concrete',
        walkable: true,
      },
    ],
    playerSpawns: [{ pos: [0, 0, 0], yaw: 0 }],
    zones: [{ id: 'start', bounds: { min: [-12, 0, -12], max: [12, 3, 12] }, activeAtStart: true }],
    lighting: { preset: 'night-dim' },
  }
}

export type ValidationResult = { ok: true; map: MapDef } | { ok: false; issues: MapIssue[] }

export class EditorDocument {
  private _draft: MapDraft
  private readonly past: string[] = []
  private readonly future: string[] = []
  /** Snapshot taken by `begin()`, for grouping a drag into one undo step. */
  private pending: string | null = null
  private version = 0

  constructor(draft: MapDraft = newMapDraft()) {
    this._draft = clone(draft)
  }

  get draft(): Readonly<MapDraft> {
    return this._draft
  }

  /** Increments on every change (including mid-drag), so views know when to redraw. */
  get revision(): number {
    return this.version
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Replaces the whole map (an import). Undoable. */
  load(draft: MapDraft): void {
    this.record()
    this._draft = clone(draft)
    this.touch()
  }

  // ─── Items ──────────────────────────────────────────────────────────────────────────

  /** The item's data (a live object; change it through the methods below). */
  get(ref: ItemRef): Record<string, unknown> | undefined {
    return this.list(ref.kind)[ref.index] as Record<string, unknown> | undefined
  }

  count(kind: ItemKind): number {
    return this.list(kind).length
  }

  /** Every item of every kind, for drawing. */
  refs(): ItemRef[] {
    return itemKinds.flatMap((kind) => this.list(kind).map((_, index) => ({ kind, index })))
  }

  /** A short name for lists and messages: the id if it has one. */
  label(ref: ItemRef): string {
    const item = this.get(ref)
    const id = typeof item?.id === 'string' ? item.id : null
    const weapon = typeof item?.weapon === 'string' ? item.weapon : null
    return `${itemLabels[ref.kind]} ${id ?? weapon ?? ref.index + 1}`
  }

  /** Adds a new item of `kind` standing on `ground` and returns it. */
  add(kind: ItemKind, ground: readonly number[]): ItemRef {
    this.record()
    const [x, y, z] = tidyVec(ground)
    const zones = this.list('zone') as { id: string }[]
    const zone = zones[0]?.id ?? 'start'
    const item: Record<string, unknown> = (() => {
      switch (kind) {
        case 'brush':
          return { type: 'box', pos: [x, y + 0.5, z], size: [2, 1, 2], material: 'concrete' }
        case 'spawn':
          return { pos: [x, y, z], yaw: 0 }
        case 'zone':
          return {
            id: this.uniqueId('zone', 'zone'),
            bounds: { min: [x - 3, y, z - 3], max: [x + 3, y + 3, z + 3] },
            ...(zones.length === 0 ? { activeAtStart: true } : {}),
          }
        case 'window':
          return {
            id: this.uniqueId('window', 'w'),
            zone,
            pos: [x, y + 1.5, z],
            yaw: 0,
            outsideSpawn: [x, y, z - 3],
          }
        case 'door':
          return {
            id: this.uniqueId('door', 'd'),
            cost: 1000,
            pos: [x, y + 1.5, z],
            size: [2, 3, 0.3],
            connects: [zone, zones[1]?.id ?? zone],
          }
        case 'wallBuy':
          return { weapon: weaponIds[1], pos: [x, y + 1.5, z], yaw: 0 }
        case 'crateSpot':
          return { id: this.uniqueId('crateSpot', 'crate'), pos: [x, y, z], yaw: 0 }
        case 'dummy':
          return { pos: [x, y, z], yaw: 0 }
        case 'lamp':
          return { pos: [x, y + 2.6, z] }
      }
    })()
    const list = this.list(kind, true)
    list.push(item)
    this.touch()
    return { kind, index: list.length - 1 }
  }

  /** Copies an item a little to the side; ids get a fresh number. */
  duplicate(ref: ItemRef): ItemRef | null {
    const item = this.get(ref)
    if (!item) return null
    this.record()
    const copy = clone(item)
    if (typeof copy.id === 'string') copy.id = this.uniqueId(ref.kind, copy.id.replace(/\d+$/, ''))
    const list = this.list(ref.kind, true)
    list.push(copy)
    const next = { kind: ref.kind, index: list.length - 1 }
    const pos = this.position(next)
    this.setPosition(next, [pos[0] + 1, pos[1], pos[2] + 1], false)
    this.touch()
    return next
  }

  remove(ref: ItemRef): void {
    if (!this.get(ref)) return
    this.record()
    this.list(ref.kind).splice(ref.index, 1)
    this.touch()
  }

  /** Sets plain fields (id, material, cost, …). `undefined` removes a field. */
  update(ref: ItemRef, patch: Record<string, unknown>, record = true): void {
    const item = this.get(ref)
    if (!item) return
    if (record) this.record()
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete item[key]
      else item[key] = value
    }
    this.touch()
  }

  /**
   * Renames an item's id. Renaming a zone also updates every window, door and crate spot
   * that names it, so the map stays valid.
   */
  rename(ref: ItemRef, id: string): void {
    const item = this.get(ref)
    if (!item || typeof item.id !== 'string' || item.id === id) return
    this.record()
    const old = item.id
    item.id = id
    if (ref.kind === 'zone') {
      for (const w of this.list('window')) if (w.zone === old) w.zone = id
      for (const c of this.list('crateSpot')) if (c.zone === old) c.zone = id
      for (const d of this.list('door')) {
        if (Array.isArray(d.connects)) d.connects = d.connects.map((z) => (z === old ? id : z))
      }
    }
    this.touch()
  }

  /** Sets top-level map fields (id, name, lighting). */
  updateMap(patch: Partial<MapDraft>): void {
    this.record()
    Object.assign(this._draft, clone(patch))
    this.touch()
  }

  // ─── Placement (what the gizmos move) ───────────────────────────────────────────────

  /** Where the item's gizmo sits: its `pos`, a zone's centre, or a window's spawn point. */
  position(ref: ItemRef): Vec3 {
    const item = this.get(ref)
    if (!item) return [0, 0, 0]
    if (ref.handle === 'outside') return tidyVec(item.outsideSpawn as number[])
    if (ref.kind === 'zone') {
      const { min, max } = item.bounds as { min: Vec3; max: Vec3 }
      return tidyVec([0, 1, 2].map((k) => (min[k]! + max[k]!) / 2))
    }
    return tidyVec(item.pos as number[])
  }

  setPosition(ref: ItemRef, p: readonly number[], record = true): void {
    const item = this.get(ref)
    if (!item) return
    if (record) this.record()
    if (ref.handle === 'outside') {
      item.outsideSpawn = tidyVec(p)
    } else if (ref.kind === 'zone') {
      const half = this.size(ref).map((s) => s / 2)
      item.bounds = {
        min: tidyVec([0, 1, 2].map((k) => p[k]! - half[k]!)),
        max: tidyVec([0, 1, 2].map((k) => p[k]! + half[k]!)),
      }
    } else {
      item.pos = tidyVec(p)
    }
    this.touch()
  }

  /** Full size of a box item (brush, zone, door); zeros for other kinds. */
  size(ref: ItemRef): Vec3 {
    const item = this.get(ref)
    if (!item || !boxKinds.includes(ref.kind) || ref.handle) return [0, 0, 0]
    if (ref.kind === 'zone') {
      const { min, max } = item.bounds as { min: Vec3; max: Vec3 }
      return tidyVec([0, 1, 2].map((k) => max[k]! - min[k]!))
    }
    return tidyVec(item.size as number[])
  }

  /** Resizes a box item about its centre. Sizes are clamped to at least 5 cm. */
  setSize(ref: ItemRef, size: readonly number[], record = true): void {
    const item = this.get(ref)
    if (!item || !boxKinds.includes(ref.kind) || ref.handle) return
    if (record) this.record()
    const s = tidyVec(size.map((n) => Math.max(Math.abs(n), MIN_SIZE)))
    if (ref.kind === 'zone') {
      const c = this.position(ref)
      item.bounds = {
        min: tidyVec([0, 1, 2].map((k) => c[k]! - s[k]! / 2)),
        max: tidyVec([0, 1, 2].map((k) => c[k]! + s[k]! / 2)),
      }
    } else {
      item.size = s
    }
    this.touch()
  }

  yaw(ref: ItemRef): number {
    const yaw = this.get(ref)?.yaw
    return typeof yaw === 'number' ? yaw : 0
  }

  /** Sets the facing, normalised to (-180, 180]. */
  setYaw(ref: ItemRef, degrees: number, record = true): void {
    if (!facingKinds.includes(ref.kind) || ref.handle || !this.get(ref)) return
    let yaw = tidy(((((degrees + 180) % 360) + 360) % 360) - 180)
    if (yaw === -180) yaw = 180
    this.update(ref, { yaw }, record)
  }

  // ─── History ────────────────────────────────────────────────────────────────────────

  /** Starts a change made of many small steps (a gizmo drag): one undo step for all of it. */
  begin(): void {
    this.pending ??= JSON.stringify(this._draft)
  }

  /** Ends a `begin()` group. Records nothing if the map didn't actually change. */
  commit(): void {
    if (this.pending === null) return
    if (this.pending !== JSON.stringify(this._draft)) this.pushPast(this.pending)
    this.pending = null
  }

  undo(): boolean {
    const previous = this.past.pop()
    if (previous === undefined) return false
    this.future.push(JSON.stringify(this._draft))
    this._draft = JSON.parse(previous) as MapDraft
    this.touch()
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (next === undefined) return false
    this.past.push(JSON.stringify(this._draft))
    this._draft = JSON.parse(next) as MapDraft
    this.touch()
    return true
  }

  // ─── Output ─────────────────────────────────────────────────────────────────────────

  validate(): ValidationResult {
    return checkMap(this.exportDraft())
  }

  /** Which item (if any) a validation issue is about, from its path like `windows[2].zone`. */
  refForIssue(issue: MapIssue): ItemRef | null {
    const [key, index, field] = issue.path
    if (key === 'lighting' && index === 'lamps' && typeof field === 'number') {
      return { kind: 'lamp', index: field }
    }
    const kind = (Object.keys(LIST_KEY) as (keyof typeof LIST_KEY)[]).find(
      (k) => LIST_KEY[k] === key,
    )
    if (!kind || typeof index !== 'number') return null
    return {
      kind,
      index,
      ...(kind === 'window' && field === 'outsideSpawn' ? { handle: 'outside' as const } : {}),
    }
  }

  /** The map as map.json text, tidy and without empty optional lists. */
  toJson(): string {
    return formatJson(this.exportDraft())
  }

  private exportDraft(): MapDraft {
    const out = clone(this._draft) as Record<string, unknown>
    for (const key of Object.values(LIST_KEY)) {
      if (key === 'playerSpawns') continue
      if (Array.isArray(out[key]) && out[key].length === 0) delete out[key]
    }
    const lighting = out.lighting as Record<string, unknown> | undefined
    if (lighting && Array.isArray(lighting.lamps) && lighting.lamps.length === 0) {
      delete lighting.lamps
    }
    return out as MapDraft
  }

  // ─── Internals ──────────────────────────────────────────────────────────────────────

  private list(kind: ItemKind, create = false): Record<string, unknown>[] {
    const draft = this._draft as Record<string, unknown>
    if (kind === 'lamp') {
      if (!draft.lighting) {
        if (!create) return []
        draft.lighting = { preset: 'night-dim' }
      }
      const lighting = draft.lighting as Record<string, unknown>
      if (!Array.isArray(lighting.lamps)) {
        if (!create) return []
        lighting.lamps = []
      }
      return lighting.lamps as Record<string, unknown>[]
    }
    const key = LIST_KEY[kind]
    if (!Array.isArray(draft[key])) {
      if (!create) return []
      draft[key] = []
    }
    return draft[key] as Record<string, unknown>[]
  }

  /** `prefix1`, `prefix2`, … : the first not already used by this kind. */
  private uniqueId(kind: ItemKind, prefix: string): string {
    const used = new Set(this.list(kind).map((i) => i.id))
    for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`
  }

  /** Saves the current state for undo (unless a `begin()` group is open). */
  private record(): void {
    if (this.pending !== null) return
    this.pushPast(JSON.stringify(this._draft))
  }

  private pushPast(snapshot: string): void {
    this.past.push(snapshot)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future.length = 0
  }

  private touch(): void {
    this.version++
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
