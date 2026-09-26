import { useRef, useState, type ReactNode } from 'react'
import { weaponDefs, weaponIds } from '../game/weapons/definitions'
import { lightingPresetIds, type LightingPresetId } from '../maps/lighting'
import { brushMaterials } from '../maps/schema'
import {
  boxKinds,
  facingKinds,
  itemKinds,
  itemLabels,
  newMapDraft,
  type ItemKind,
  type ItemRef,
  type MapDraft,
} from './document'
import type { Editor } from './Editor'
import { editorStore, useEditorUi } from './store'
import { kindColors } from './visuals'

type Vec3 = [number, number, number]

/** The editor's panels. Everything they change goes through the Editor and its document. */
export function EditorUi() {
  const editor = useEditorUi((s) => s.editor)
  useEditorUi((s) => s.revision)
  if (!editor) return null
  return (
    <div className="editor">
      <TopBar editor={editor} />
      <aside className="editor-panel editor-left">
        <AddPanel editor={editor} />
        <Outline editor={editor} />
      </aside>
      <aside className="editor-panel editor-right">
        <Properties editor={editor} />
      </aside>
      <Problems editor={editor} />
      <Toast />
    </div>
  )
}

// ─── Top bar ──────────────────────────────────────────────────────────────────────────────

function TopBar({ editor }: { editor: Editor }) {
  const canUndo = useEditorUi((s) => s.canUndo)
  const canRedo = useEditorUi((s) => s.canRedo)
  const mode = useEditorUi((s) => s.mode)
  const snap = useEditorUi((s) => s.snap)
  const selection = useEditorUi((s) => s.selection)
  const showNavmesh = useEditorUi((s) => s.showNavmesh)
  const navStatus = useEditorUi((s) => s.navCheck.status)
  const valid = useEditorUi((s) => s.issues.length === 0)
  const fileInput = useRef<HTMLInputElement>(null)

  const canTurn = !!selection && !selection.handle && facingKinds.includes(selection.kind)
  const canSize = !!selection && !selection.handle && boxKinds.includes(selection.kind)

  const openFile = async (file: File | undefined) => {
    if (!file) return
    try {
      editor.load(JSON.parse(await file.text()) as MapDraft)
      toast(`Opened ${file.name}`)
    } catch (err) {
      toast(`Couldn't open ${file.name}: ${String(err)}`)
    }
  }

  return (
    <header className="editor-panel editor-top">
      <span className="editor-brand">MAP EDITOR</span>
      <Group>
        <button onClick={() => editor.load(newMapDraft())}>New</button>
        <button onClick={() => fileInput.current?.click()}>Open…</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void openFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button onClick={() => download(editor)} title="Save map.json to your computer">
          Download map.json
        </button>
        <button onClick={() => void copy(editor)}>Copy JSON</button>
      </Group>
      <Group>
        <button disabled={!canUndo} onClick={() => editor.undo()} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button disabled={!canRedo} onClick={() => editor.redo()} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </button>
      </Group>
      <Group>
        <Toggle on={mode === 'translate'} onClick={() => editor.setMode('translate')} title="W">
          Move
        </Toggle>
        <Toggle
          on={mode === 'rotate'}
          disabled={!canTurn}
          onClick={() => editor.setMode('rotate')}
          title="E: turn items that face a direction"
        >
          Turn
        </Toggle>
        <Toggle
          on={mode === 'scale'}
          disabled={!canSize}
          onClick={() => editor.setMode('scale')}
          title="R: resize brushes, zones and doors"
        >
          Size
        </Toggle>
        <Toggle on={snap} onClick={() => editor.setSnap(!snap)} title="G: 0.25 m / 15° steps">
          Snap
        </Toggle>
      </Group>
      <Group>
        <button
          onClick={() => void editor.checkNavmesh()}
          disabled={navStatus === 'running'}
          title="Run the game's own navmesh and window checks"
        >
          Check navmesh
        </button>
        <label className="editor-check">
          <input
            type="checkbox"
            checked={showNavmesh}
            onChange={(e) => editor.showNav(e.target.checked)}
          />
          Show navmesh
        </label>
        <button
          className="editor-primary"
          disabled={!valid}
          onClick={() => {
            if (!editor.playtest()) toast('Could not start the play test')
          }}
          title={valid ? 'Play this map in a new tab' : 'Fix the problems listed first'}
        >
          Play test ▶
        </button>
      </Group>
    </header>
  )
}

// ─── Left: add items, and a list of everything ───────────────────────────────────────────

function AddPanel({ editor }: { editor: Editor }) {
  return (
    <section>
      <h3>Add</h3>
      <div className="editor-add">
        {itemKinds.map((kind) => (
          <button key={kind} onClick={() => editor.add(kind)} title={`Add a ${itemLabels[kind]}`}>
            <Swatch kind={kind} />
            {itemLabels[kind]}
          </button>
        ))}
      </div>
    </section>
  )
}

function Outline({ editor }: { editor: Editor }) {
  const selection = useEditorUi((s) => s.selection)
  const refs = editor.doc.refs()
  return (
    <section className="editor-outline">
      <h3>Map ({refs.length})</h3>
      <ul>
        {refs.map((ref) => (
          <li key={`${ref.kind}:${ref.index}`}>
            <button
              className={
                selection && selection.kind === ref.kind && selection.index === ref.index
                  ? 'selected'
                  : undefined
              }
              onClick={() => editor.select(ref)}
            >
              <Swatch kind={ref.kind} />
              {editor.doc.label(ref)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Right: properties ───────────────────────────────────────────────────────────────────

function Properties({ editor }: { editor: Editor }) {
  const selection = useEditorUi((s) => s.selection)
  const item = selection ? editor.doc.get(selection) : undefined
  if (!selection || !item) return <MapSettings editor={editor} />

  const { doc } = editor
  const ref: ItemRef = { kind: selection.kind, index: selection.index }
  const set = (patch: Record<string, unknown>) => {
    doc.update(ref, patch)
    editor.changed()
  }
  const zones = (doc.draft.zones ?? []).map((z) => z.id)
  const str = (key: string) => (typeof item[key] === 'string' ? (item[key] as string) : '')
  const num = (key: string, fallback: number) =>
    typeof item[key] === 'number' ? (item[key] as number) : fallback

  return (
    <section key={`${ref.kind}:${ref.index}`}>
      <h3>
        <Swatch kind={ref.kind} />
        {doc.label(ref)}
      </h3>

      {typeof item.id === 'string' && (
        <TextField
          label="Id"
          value={item.id}
          onCommit={(id) => {
            doc.rename(ref, id)
            editor.changed()
          }}
        />
      )}

      <Vec3Field
        label={ref.kind === 'zone' ? 'Centre' : 'Position'}
        value={doc.position(ref)}
        onCommit={(p) => {
          doc.setPosition(ref, p)
          editor.changed()
        }}
      />
      {boxKinds.includes(ref.kind) && (
        <Vec3Field
          label="Size"
          value={doc.size(ref)}
          onCommit={(s) => {
            doc.setSize(ref, s)
            editor.changed()
          }}
        />
      )}
      {facingKinds.includes(ref.kind) && (
        <NumberField
          label="Facing (yaw°)"
          value={doc.yaw(ref)}
          onCommit={(yaw) => {
            doc.setYaw(ref, yaw)
            editor.changed()
          }}
        />
      )}

      {ref.kind === 'brush' && (
        <>
          <SelectField
            label="Material"
            value={str('material') || 'concrete'}
            options={brushMaterials}
            onCommit={(material) => set({ material })}
          />
          <CheckField
            label="Walkable top"
            value={item.walkable === true}
            onCommit={(walkable) => set({ walkable: walkable || undefined })}
          />
        </>
      )}

      {ref.kind === 'zone' && (
        <CheckField
          label="Active at start"
          value={item.activeAtStart === true}
          onCommit={(on) => set({ activeAtStart: on || undefined })}
        />
      )}

      {ref.kind === 'window' && (
        <>
          <SelectField
            label="Zone"
            value={str('zone')}
            options={zones}
            onCommit={(zone) => set({ zone })}
          />
          <NumberField
            label="Boards"
            value={num('boards', 6)}
            onCommit={(boards) => set({ boards: Math.round(boards) })}
          />
          <NumberField
            label="Opening width"
            value={num('width', 1.2)}
            onCommit={(width) => set({ width })}
          />
          <NumberField
            label="Opening height"
            value={num('height', 1.2)}
            onCommit={(height) => set({ height })}
          />
          <Vec3Field
            label="Zombie spawn"
            value={doc.position({ ...ref, handle: 'outside' })}
            onCommit={(p) => {
              doc.setPosition({ ...ref, handle: 'outside' }, p)
              editor.changed()
            }}
          />
          <button
            className="editor-link"
            onClick={() => editor.select({ ...ref, handle: 'outside' })}
          >
            Select the spawn point to drag it
          </button>
        </>
      )}

      {ref.kind === 'door' && (
        <>
          <NumberField
            label="Cost"
            value={num('cost', 1000)}
            onCommit={(cost) => set({ cost: Math.round(cost) })}
          />
          {[0, 1].map((side) => (
            <SelectField
              key={side}
              label={side === 0 ? 'Connects' : 'and'}
              value={(item.connects as string[] | undefined)?.[side] ?? ''}
              options={zones}
              onCommit={(zone) => {
                const connects = [...((item.connects as string[] | undefined) ?? ['', ''])]
                connects[side] = zone
                set({ connects })
              }}
            />
          ))}
        </>
      )}

      {ref.kind === 'wallBuy' && (
        <>
          <SelectField
            label="Weapon"
            value={str('weapon')}
            options={weaponIds}
            labels={weaponIds.map((id) => weaponDefs[id].name)}
            onCommit={(weapon) => set({ weapon })}
          />
          <OptionalNumberField
            label="Cost"
            value={item.cost as number | undefined}
            placeholder={String(
              weaponDefs[str('weapon') as keyof typeof weaponDefs]?.wallBuyCost ?? '',
            )}
            onCommit={(cost) => set({ cost })}
          />
          <OptionalNumberField
            label="Ammo cost"
            value={item.ammoCost as number | undefined}
            placeholder={String(
              weaponDefs[str('weapon') as keyof typeof weaponDefs]?.ammoCost ?? '',
            )}
            onCommit={(ammoCost) => set({ ammoCost })}
          />
        </>
      )}

      {ref.kind === 'crateSpot' && (
        <>
          <SelectField
            label="Zone"
            value={str('zone')}
            options={['', ...zones]}
            labels={['(any)', ...zones]}
            onCommit={(zone) => set({ zone: zone || undefined })}
          />
          <CheckField
            label="Crate starts here"
            value={item.startsHere === true}
            onCommit={(on) => set({ startsHere: on || undefined })}
          />
        </>
      )}

      {ref.kind === 'lamp' && (
        <>
          <ColorField
            label="Colour"
            value={str('color') || '#ffc98a'}
            onCommit={(color) => set({ color })}
          />
          <NumberField
            label="Intensity"
            value={num('intensity', 6)}
            onCommit={(intensity) => set({ intensity })}
          />
          <NumberField
            label="Range (m)"
            value={num('range', 8)}
            onCommit={(range) => set({ range })}
          />
        </>
      )}

      <div className="editor-actions">
        <button onClick={() => editor.duplicateSelected()} title="Ctrl/Cmd+D">
          Duplicate
        </button>
        <button onClick={() => editor.focus()} title="F">
          Focus
        </button>
        <button className="editor-danger" onClick={() => editor.removeSelected()} title="Delete">
          Delete
        </button>
      </div>
    </section>
  )
}

function MapSettings({ editor }: { editor: Editor }) {
  const { draft } = editor.doc
  const update = (patch: Partial<MapDraft>) => {
    editor.doc.updateMap(patch)
    editor.changed()
  }
  const lighting = draft.lighting ?? { preset: 'night-dim' as const }
  const fog = lighting.fog
  return (
    <section>
      <h3>Map</h3>
      <TextField label="Id" value={draft.id} onCommit={(id) => update({ id })} />
      <TextField label="Name" value={draft.name} onCommit={(name) => update({ name })} />
      <SelectField
        label="Lighting"
        value={lighting.preset}
        options={lightingPresetIds}
        onCommit={(preset) =>
          update({ lighting: { ...lighting, preset: preset as LightingPresetId } })
        }
      />
      <CheckField
        label="Custom fog"
        value={!!fog}
        onCommit={(on) =>
          update({
            lighting: { ...lighting, fog: on ? { color: '#0b0d10', near: 8, far: 45 } : undefined },
          })
        }
      />
      {fog && (
        <>
          <ColorField
            label="Fog colour"
            value={fog.color}
            onCommit={(color) => update({ lighting: { ...lighting, fog: { ...fog, color } } })}
          />
          <NumberField
            label="Fog near"
            value={fog.near}
            onCommit={(near) => update({ lighting: { ...lighting, fog: { ...fog, near } } })}
          />
          <NumberField
            label="Fog far"
            value={fog.far}
            onCommit={(far) => update({ lighting: { ...lighting, fog: { ...fog, far } } })}
          />
        </>
      )}
      {draft.art && (
        <p className="editor-note">
          This map also uses <code>{draft.art}</code>. The editor edits map.json only; the art and
          its placeholders aren&apos;t shown here, but play tests include them.
        </p>
      )}
      <p className="editor-note">
        Click an item to select it. Drag with the left mouse to orbit, the right to pan, and scroll
        to zoom. W / E / R: move, turn, size. G: snap. F: focus. Delete. Ctrl/Cmd+Z, Shift+Z: undo,
        redo. Ctrl/Cmd+D: duplicate.
      </p>
    </section>
  )
}

// ─── Bottom: problems ────────────────────────────────────────────────────────────────────

function Problems({ editor }: { editor: Editor }) {
  const issues = useEditorUi((s) => s.issues)
  const nav = useEditorUi((s) => s.navCheck)
  return (
    <section className="editor-panel editor-problems">
      {issues.length === 0 ? (
        <div className="editor-ok">✓ map.json is valid</div>
      ) : (
        <ul>
          {issues.map((issue, i) => (
            <li key={i}>
              <button onClick={() => issue.ref && editor.select(issue.ref)} disabled={!issue.ref}>
                <span className="editor-path">{formatPath(issue.path)}</span> {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nav.status !== 'idle' && (
        <div className={`editor-nav editor-nav-${nav.status}`}>{nav.message}</div>
      )}
    </section>
  )
}

/** A short confirmation; fades out by itself (CSS), and a new one restarts it. */
function Toast() {
  const toastState = useEditorUi((s) => s.toast)
  if (!toastState) return null
  return (
    <div key={toastState.id} className="editor-toast">
      {toastState.text}
    </div>
  )
}

// ─── Fields ──────────────────────────────────────────────────────────────────────────────

function Group({ children }: { children: ReactNode }) {
  return <div className="editor-group">{children}</div>
}

function Toggle(props: {
  on: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      className={props.on ? 'editor-toggle on' : 'editor-toggle'}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
    >
      {props.children}
    </button>
  )
}

function Swatch({ kind }: { kind: ItemKind }) {
  return <span className="editor-swatch" style={{ background: kindColors[kind] }} />
}

/** A text input that commits on Enter or when it loses focus (one undo step per edit). */
function useDraftValue(value: string, onCommit: (text: string) => void) {
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)
  const shown = editing ? text : value
  return {
    value: shown,
    onFocus: () => {
      setText(value)
      setEditing(true)
    },
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => {
      setEditing(false)
      if (text !== value) onCommit(text)
    },
    onKeyDown: (e: { key: string; currentTarget: HTMLInputElement }) => {
      if (e.key === 'Enter') e.currentTarget.blur()
      if (e.key === 'Escape') {
        setText(value)
        setEditing(false)
      }
    },
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function TextField(props: { label: string; value: string; onCommit: (v: string) => void }) {
  const input = useDraftValue(props.value, (t) => {
    if (t.trim()) props.onCommit(t.trim())
  })
  return (
    <Field label={props.label}>
      <input {...input} />
    </Field>
  )
}

function NumberField(props: { label: string; value: number; onCommit: (v: number) => void }) {
  const input = useDraftValue(String(props.value), (t) => {
    const n = Number(t)
    if (t.trim() !== '' && Number.isFinite(n)) props.onCommit(n)
  })
  return (
    <Field label={props.label}>
      <input {...input} inputMode="decimal" />
    </Field>
  )
}

/** Blank means "use the default" (shown as the placeholder). */
function OptionalNumberField(props: {
  label: string
  value: number | undefined
  placeholder: string
  onCommit: (v: number | undefined) => void
}) {
  const input = useDraftValue(props.value === undefined ? '' : String(props.value), (t) => {
    if (t.trim() === '') props.onCommit(undefined)
    else if (Number.isFinite(Number(t))) props.onCommit(Math.round(Number(t)))
  })
  return (
    <Field label={props.label}>
      <input {...input} placeholder={props.placeholder} inputMode="numeric" />
    </Field>
  )
}

function Vec3Field(props: { label: string; value: Vec3; onCommit: (v: Vec3) => void }) {
  return (
    <div className="editor-field editor-vec3">
      <span>{props.label}</span>
      <div>
        {(['x', 'y', 'z'] as const).map((axis, k) => (
          <AxisInput
            key={axis}
            axis={axis}
            value={props.value[k] ?? 0}
            onCommit={(n) => {
              const next: Vec3 = [...props.value]
              next[k] = n
              props.onCommit(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function AxisInput(props: { axis: string; value: number; onCommit: (n: number) => void }) {
  const input = useDraftValue(String(props.value), (t) => {
    const n = Number(t)
    if (t.trim() !== '' && Number.isFinite(n)) props.onCommit(n)
  })
  return <input {...input} aria-label={props.axis} title={props.axis} inputMode="decimal" />
}

function SelectField(props: {
  label: string
  value: string
  options: readonly string[]
  labels?: readonly string[]
  onCommit: (v: string) => void
}) {
  const options = props.options.includes(props.value)
    ? props.options
    : [props.value, ...props.options]
  return (
    <Field label={props.label}>
      <select value={props.value} onChange={(e) => props.onCommit(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {props.labels?.[props.options.indexOf(o)] ?? (o || '—')}
          </option>
        ))}
      </select>
    </Field>
  )
}

function CheckField(props: { label: string; value: boolean; onCommit: (v: boolean) => void }) {
  return (
    <label className="editor-field editor-checkfield">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onCommit(e.target.checked)}
      />
    </label>
  )
}

function ColorField(props: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <Field label={props.label}>
      <input type="color" value={props.value} onChange={(e) => props.onCommit(e.target.value)} />
    </Field>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i > 0 ? '.' : ''}${String(p)}`))
    .join('')
}

let toastId = 0
function toast(text: string): void {
  editorStore.setState({ toast: { id: ++toastId, text } })
}

function download(editor: Editor): void {
  const blob = new Blob([editor.doc.toJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'map.json'
  a.click()
  URL.revokeObjectURL(url)
  toast(`Downloaded map.json. Put it in public/maps/${editor.doc.draft.id}/`)
}

async function copy(editor: Editor): Promise<void> {
  try {
    await navigator.clipboard.writeText(editor.doc.toJson())
    toast('Copied map.json to the clipboard')
  } catch {
    toast('The browser blocked clipboard access; use Download instead')
  }
}
