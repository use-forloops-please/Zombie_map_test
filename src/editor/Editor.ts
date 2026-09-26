import { NavMeshHelper } from '@recast-navigation/three'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { Physics } from '../engine/Physics'
import type { BrushTextures } from '../maps/brushes'
import { buildMapWorld, MapLoadError, type MapWorld } from '../maps/MapLoader'
import { initNavigation } from '../maps/navmesh'
import {
  boxKinds,
  facingKinds,
  type EditorDocument,
  type ItemKind,
  type ItemRef,
  type MapDraft,
} from './document'
import { PLAYTEST_KEY } from './playtest'
import { editorStore, type GizmoMode } from './store'
import { refKey, Visuals } from './visuals'

/** Grid steps used while snapping is on. */
const MOVE_SNAP = 0.25
const TURN_SNAP = 15
const SIZE_SNAP = 0.25
/** A click that moves the mouse further than this (pixels) is a camera drag, not a pick. */
const CLICK_SLOP = 5

const sameRef = (a: ItemRef | null, b: ItemRef | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.index === b.index && a.handle === b.handle

/**
 * The in-browser map editor's 3D side: an orbit camera over the map, click-to-select,
 * and a transform gizmo that moves, turns and resizes the selected item. All edits go
 * through the EditorDocument (so they undo); the React panels drive it through the
 * public methods here and read state from `editorStore`.
 */
export class Editor {
  readonly doc: EditorDocument
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  private readonly orbit: OrbitControls
  private readonly gizmo: TransformControls
  /** Invisible object the gizmo moves; its transform is copied into the document. */
  private readonly handle = new THREE.Object3D()
  private readonly visuals: Visuals
  private readonly items = new THREE.Group()
  private readonly objects = new Map<string, THREE.Object3D>()
  private readonly highlight = new THREE.Box3Helper(new THREE.Box3(), '#ffe14d')
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly down = new THREE.Vector2()
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private navHelper: NavMeshHelper | null = null
  private navWorld: MapWorld | null = null
  private drawnRevision = -1
  private dragging = false
  private rafId = 0

  constructor(canvas: HTMLCanvasElement, doc: EditorDocument, textures: BrushTextures) {
    this.canvas = canvas
    this.doc = doc
    this.visuals = new Visuals(textures)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.background = new THREE.Color('#1c2027')

    const hemi = new THREE.HemisphereLight('#c9d4e6', '#3a342c', 1.6)
    const sun = new THREE.DirectionalLight('#ffffff', 1.4)
    sun.position.set(8, 20, 12)
    const grid = new THREE.GridHelper(100, 100, '#4a5160', '#2c313a')
    grid.position.y = 0.002
    this.scene.add(hemi, sun, grid, this.items, this.handle, this.highlight)
    this.highlight.visible = false
    // Yaw-first order, so a turn past 90° reads back as a yaw (not a flipped pitch and roll).
    this.handle.rotation.order = 'YXZ'

    this.orbit = new OrbitControls(this.camera, canvas)
    this.orbit.enableDamping = true
    this.orbit.screenSpacePanning = false
    this.gizmo = new TransformControls(this.camera, canvas)
    this.scene.add(this.gizmo.getHelper())
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.dragging = e.value === true
      this.orbit.enabled = !this.dragging
      if (this.dragging) {
        this.doc.begin()
      } else {
        this.doc.commit()
        this.publish()
      }
    })
    this.gizmo.addEventListener('objectChange', () => this.applyHandle())
    this.setSnap(true)

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('resize', this.resize)
    this.resize()
    this.frameMap()
    editorStore.setState({ editor: this })
    this.publish()
  }

  start(): void {
    const frame = () => {
      this.rafId = requestAnimationFrame(frame)
      if (this.doc.revision !== this.drawnRevision && !this.dragging) this.rebuild()
      this.orbit.update()
      this.renderer.render(this.scene, this.camera)
    }
    frame()
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('resize', this.resize)
    this.clearNav()
    for (const obj of this.objects.values()) this.visuals.release(obj)
    this.visuals.dispose()
    this.gizmo.dispose()
    this.orbit.dispose()
    this.renderer.dispose()
  }

  // ─── Commands (called by the panels and shortcuts) ──────────────────────────────────

  select(ref: ItemRef | null): void {
    if (ref && !this.doc.get(ref)) ref = null
    editorStore.setState({ selection: ref })
    if (!ref) {
      this.gizmo.detach()
      this.highlight.visible = false
      return
    }
    const { mode } = editorStore.getState()
    if (!this.modeAllowed(mode, ref)) editorStore.setState({ mode: 'translate' })
    this.placeHandle()
    this.gizmo.attach(this.handle)
    this.applyMode()
    this.updateHighlight()
  }

  /** Adds an item where the camera is looking (on the floor under the screen centre). */
  add(kind: ItemKind): void {
    const ref = this.doc.add(kind, this.groundAtScreen(0, 0))
    this.rebuild()
    this.select(ref)
    this.publish()
  }

  removeSelected(): void {
    const ref = editorStore.getState().selection
    if (!ref) return
    this.select(null)
    this.doc.remove({ kind: ref.kind, index: ref.index })
    this.publish()
  }

  duplicateSelected(): void {
    const ref = editorStore.getState().selection
    if (!ref) return
    const copy = this.doc.duplicate({ kind: ref.kind, index: ref.index })
    this.rebuild()
    this.select(copy)
    this.publish()
  }

  undo(): void {
    if (this.doc.undo()) this.afterHistory()
  }

  redo(): void {
    if (this.doc.redo()) this.afterHistory()
  }

  setMode(mode: GizmoMode): void {
    const ref = editorStore.getState().selection
    if (ref && !this.modeAllowed(mode, ref)) return
    editorStore.setState({ mode })
    this.applyMode()
  }

  setSnap(on: boolean): void {
    editorStore.setState({ snap: on })
    this.gizmo.setTranslationSnap(on ? MOVE_SNAP : null)
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(TURN_SNAP) : null)
    this.gizmo.setScaleSnap(on ? SIZE_SNAP : null)
  }

  /** Points the camera at the selection (or the whole map). */
  focus(): void {
    const ref = editorStore.getState().selection
    if (!ref) {
      this.frameMap()
      return
    }
    const target = new THREE.Vector3(...this.doc.position(ref))
    const offset = this.camera.position.clone().sub(this.orbit.target)
    offset.setLength(Math.min(Math.max(offset.length(), 6), 14))
    this.orbit.target.copy(target)
    this.camera.position.copy(target).add(offset)
  }

  /** Called after the panels change something in the document. */
  changed(): void {
    this.publish()
    if (!this.dragging) this.placeHandle()
  }

  /** Replaces the map (New / Open) and frames it. */
  load(draft: MapDraft): void {
    this.select(null)
    this.clearNav()
    this.doc.load(draft)
    this.rebuild()
    this.frameMap()
    this.publish()
  }

  /**
   * Runs the game's own map checks: builds colliders and the navmesh and resolves every
   * window, with doors shut and open. Shows the navmesh if that overlay is on.
   */
  async checkNavmesh(): Promise<void> {
    const result = this.doc.validate()
    if (!result.ok) {
      editorStore.setState({
        navCheck: { status: 'failed', message: 'Fix the problems listed first.' },
      })
      return
    }
    editorStore.setState({ navCheck: { status: 'running', message: 'Building navmesh…' } })
    this.clearNav()
    try {
      const [physics] = await Promise.all([Physics.create(), initNavigation()])
      this.navWorld = buildMapWorld({ def: result.map, art: null }, physics)
      const windows = result.map.windows.length
      const note = result.map.art ? ' (art from level.glb is not included here)' : ''
      editorStore.setState({
        navCheck: {
          status: 'ok',
          message:
            windows > 0
              ? `Navmesh OK: all ${windows} windows reachable, and zombies can only get in by climbing through${note}.`
              : `Navmesh OK${note}.`,
        },
      })
      this.showNav(editorStore.getState().showNavmesh)
    } catch (err) {
      const message =
        err instanceof MapLoadError ? err.message : `Navmesh check failed: ${String(err)}`
      editorStore.setState({ navCheck: { status: 'failed', message } })
    }
  }

  showNav(on: boolean): void {
    editorStore.setState({ showNavmesh: on })
    this.removeNavHelper()
    if (!on || !this.navWorld) return
    this.navHelper = new NavMeshHelper(this.navWorld.nav.navMesh, {
      navMeshMaterial: new THREE.MeshBasicMaterial({
        color: '#3fa7ff',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    })
    this.navHelper.position.y = 0.03
    this.scene.add(this.navHelper)
  }

  /** Saves the map where the game can find it and opens it in a new tab. */
  playtest(): boolean {
    if (!this.doc.validate().ok) return false
    try {
      localStorage.setItem(PLAYTEST_KEY, this.doc.toJson())
    } catch {
      return false
    }
    window.open(`${window.location.pathname}?playtest`, '_blank')
    return true
  }

  // ─── Drawing ────────────────────────────────────────────────────────────────────────

  private rebuild(): void {
    for (const obj of this.objects.values()) {
      this.items.remove(obj)
      this.visuals.release(obj)
    }
    this.objects.clear()
    for (const ref of this.doc.refs()) {
      this.addObject(ref, this.visuals.build(this.doc, ref))
      if (ref.kind === 'window') {
        this.addObject({ ...ref, handle: 'outside' }, this.visuals.buildOutside(this.doc, ref))
      }
    }
    this.drawnRevision = this.doc.revision
    const selection = editorStore.getState().selection
    if (selection && !this.doc.get(selection)) this.select(null)
    else if (selection) {
      this.placeHandle()
      this.updateHighlight()
    }
  }

  /** Redraws just the selected item (and its window pair) while a gizmo drag is live. */
  private rebuildSelected(ref: ItemRef): void {
    const refs: ItemRef[] = [{ kind: ref.kind, index: ref.index }]
    if (ref.kind === 'window') refs.push({ kind: 'window', index: ref.index, handle: 'outside' })
    for (const r of refs) {
      const old = this.objects.get(refKey(r))
      if (old) {
        this.items.remove(old)
        this.visuals.release(old)
      }
      const base = { kind: r.kind, index: r.index }
      this.addObject(
        r,
        r.handle ? this.visuals.buildOutside(this.doc, base) : this.visuals.build(this.doc, base),
      )
    }
    this.drawnRevision = this.doc.revision
    this.updateHighlight()
  }

  private addObject(ref: ItemRef, obj: THREE.Object3D): void {
    this.objects.set(refKey(ref), obj)
    this.items.add(obj)
  }

  private updateHighlight(): void {
    const ref = editorStore.getState().selection
    const obj = ref ? this.objects.get(refKey(ref)) : undefined
    this.highlight.visible = !!obj
    if (obj) this.highlight.box.setFromObject(obj)
  }

  // ─── Gizmo ──────────────────────────────────────────────────────────────────────────

  private modeAllowed(mode: GizmoMode, ref: ItemRef): boolean {
    if (mode === 'rotate') return !ref.handle && facingKinds.includes(ref.kind)
    if (mode === 'scale') return !ref.handle && boxKinds.includes(ref.kind)
    return true
  }

  private applyMode(): void {
    const { mode } = editorStore.getState()
    this.gizmo.setMode(mode)
    // Everything turns only about the vertical axis (yaw).
    const turning = mode === 'rotate'
    this.gizmo.showX = !turning
    this.gizmo.showZ = !turning
    this.gizmo.showY = true
    this.gizmo.setSpace(turning ? 'local' : 'world')
  }

  /** Puts the invisible gizmo handle on the selected item. */
  private placeHandle(): void {
    const ref = editorStore.getState().selection
    if (!ref) return
    this.handle.position.set(...this.doc.position(ref))
    this.handle.rotation.set(0, THREE.MathUtils.degToRad(this.doc.yaw(ref)), 0)
    const size = boxKinds.includes(ref.kind) && !ref.handle ? this.doc.size(ref) : [1, 1, 1]
    this.handle.scale.set(...(size as [number, number, number]))
    this.handle.updateMatrixWorld()
  }

  /** Copies the gizmo handle's new transform into the document (live, during a drag). */
  private applyHandle(): void {
    const ref = editorStore.getState().selection
    if (!ref) return
    const { mode } = editorStore.getState()
    const h = this.handle
    if (mode === 'translate')
      this.doc.setPosition(ref, [h.position.x, h.position.y, h.position.z], false)
    if (mode === 'rotate') this.doc.setYaw(ref, THREE.MathUtils.radToDeg(h.rotation.y), false)
    if (mode === 'scale') this.doc.setSize(ref, [h.scale.x, h.scale.y, h.scale.z], false)
    this.rebuildSelected(ref)
    editorStore.setState({ revision: this.doc.revision })
  }

  // ─── Input ──────────────────────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.down.set(e.clientX, e.clientY)
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || this.dragging || this.gizmo.axis !== null) return
    if (this.down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > CLICK_SLOP) return
    this.setPointer(e.clientX, e.clientY)
    const hits = this.raycaster.intersectObjects(this.items.children, true)
    // Prefer anything over a zone (zones enclose everything else).
    const hit = hits.find((h) => h.object.userData.ref?.kind !== 'zone') ?? hits[0]
    const ref = (hit?.object.userData.ref as ItemRef | undefined) ?? null
    if (!sameRef(ref, editorStore.getState().selection)) this.select(ref)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
    } else if (mod && key === 'y') {
      e.preventDefault()
      this.redo()
    } else if (mod && key === 'd') {
      e.preventDefault()
      this.duplicateSelected()
    } else if (mod) {
      return
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault()
      this.removeSelected()
    } else if (key === 'w') this.setMode('translate')
    else if (key === 'e') this.setMode('rotate')
    else if (key === 'r') this.setMode('scale')
    else if (key === 'g') this.setSnap(!editorStore.getState().snap)
    else if (key === 'f') this.focus()
    else if (key === 'escape') this.select(null)
  }

  private setPointer(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  /** The floor point under a screen position (NDC): the top of a brush, else y = 0. */
  private groundAtScreen(x: number, y: number): [number, number, number] {
    this.pointer.set(x, y)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const brushes = [...this.objects.entries()]
      .filter(([key]) => key.startsWith('brush:'))
      .map(([, obj]) => obj)
    const hit = this.raycaster.intersectObjects(brushes, true).find((h) => (h.normal?.y ?? 0) > 0.7)
    const point = hit?.point ?? this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3())
    const p = point ?? this.orbit.target
    const snap = editorStore.getState().snap ? MOVE_SNAP : 0.01
    const round = (n: number) => Math.round(n / snap) * snap
    return [round(p.x), Math.round(p.y * 1000) / 1000, round(p.z)]
  }

  private afterHistory(): void {
    this.rebuild()
    this.publish()
  }

  private publish(): void {
    const result = this.doc.validate()
    const { navCheck } = editorStore.getState()
    if (this.navWorld || navCheck.status !== 'idle') {
      // Any edit makes the last navmesh check out of date.
      this.clearNav()
      editorStore.setState({ navCheck: { status: 'idle', message: '' } })
    }
    editorStore.setState({
      revision: this.doc.revision,
      canUndo: this.doc.canUndo,
      canRedo: this.doc.canRedo,
      issues: result.ok ? [] : result.issues.map((i) => ({ ...i, ref: this.doc.refForIssue(i) })),
    })
  }

  /** Forgets the last navmesh check (the map has changed since). */
  private clearNav(): void {
    this.removeNavHelper()
    this.navWorld?.dispose()
    this.navWorld = null
  }

  private removeNavHelper(): void {
    if (!this.navHelper) return
    this.scene.remove(this.navHelper)
    this.navHelper.navMeshGeometry.dispose()
    this.navHelper.navMeshMaterial.dispose()
    this.navHelper = null
  }

  private frameMap(): void {
    const box = new THREE.Box3()
    for (const ref of this.doc.refs()) {
      if (ref.kind !== 'brush') continue
      const p = this.doc.position(ref)
      const s = this.doc.size(ref)
      box.union(
        new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...p), new THREE.Vector3(...s)),
      )
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(20, 1, 20))
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 5)
    this.orbit.target.copy(centre)
    this.camera.position.copy(centre).add(new THREE.Vector3(0.6, 1, 0.9).setLength(radius * 1.6))
  }

  private readonly resize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
}
