export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'sprint'
  | 'fire'
  | 'reload'
  | 'slot1'
  | 'slot2'
  | 'nextWeapon'
  | 'prevWeapon'
  | 'toggleStats'
  | 'interact'
  | 'melee'

/**
 * Action → input codes. Keys use KeyboardEvent.code, which is layout-independent (WASD stays
 * put on AZERTY). Mouse buttons are `Mouse<button>` (Mouse0 = left). Wheel notches are
 * `WheelUp` / `WheelDown`; they are press-only, never held.
 */
export type Bindings = Record<Action, readonly string[]>

export const defaultBindings: Bindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0'],
  reload: ['KeyR'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  nextWeapon: ['WheelDown'],
  prevWeapon: ['WheelUp'],
  toggleStats: ['Backquote'],
  interact: ['KeyF'],
  melee: ['KeyV'],
}

/**
 * Pointer lock plus keyboard/mouse state. Input is only recorded while the pointer is locked,
 * so typing in menus or clicking the UI never moves the player.
 */
export class Input {
  /** Called when pointer lock is gained or lost. */
  onLockChange: ((locked: boolean) => void) | null = null

  private readonly element: HTMLElement
  private bindings: Bindings
  private readonly down = new Set<string>()
  /** Codes pressed since the last `consumePressed` for their action. */
  private readonly pressed = new Set<string>()
  private mouseX = 0
  private mouseY = 0
  private locked = false

  constructor(element: HTMLElement, bindings: Bindings = defaultBindings) {
    this.element = element
    this.bindings = { ...bindings }
    element.addEventListener('click', this.onClick)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('wheel', this.onWheel, { passive: true })
    window.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('blur', this.clear)
  }

  get isLocked(): boolean {
    return this.locked
  }

  isDown(action: Action): boolean {
    for (const code of this.bindings[action]) if (this.down.has(code)) return true
    return false
  }

  /** True once per key press (not repeat), then false until the key is pressed again. */
  consumePressed(action: Action): boolean {
    let hit = false
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) hit = true
    }
    return hit
  }

  /** Writes the mouse movement (pixels) since the last call into `out`, then resets it. */
  consumeMouseDelta(out: { x: number; y: number }): void {
    out.x = this.mouseX
    out.y = this.mouseY
    this.mouseX = 0
    this.mouseY = 0
  }

  rebind(action: Action, codes: readonly string[]): void {
    this.bindings = { ...this.bindings, [action]: [...codes] }
  }

  /** Frees the mouse (e.g. for a menu). */
  releaseLock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock()
  }

  requestLock(): void {
    if (this.locked) return
    // Chrome rejects re-locking within ~1 s of the user pressing Esc; the next click will work.
    Promise.resolve(this.element.requestPointerLock()).catch(() => {})
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('blur', this.clear)
    if (document.pointerLockElement === this.element) document.exitPointerLock()
  }

  private readonly onClick = (): void => this.requestLock()

  private readonly onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element
    if (!this.locked) this.clear()
    this.onLockChange?.(this.locked)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.locked) return
    if (!e.repeat) this.pressed.add(e.code)
    this.down.add(e.code)
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code)
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    this.mouseX += e.movementX
    this.mouseY += e.movementY
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return
    const code = `Mouse${e.button}`
    this.pressed.add(code)
    this.down.add(code)
  }

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`)
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.locked || e.deltaY === 0) return
    this.pressed.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp')
  }

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.locked) e.preventDefault()
  }

  private readonly clear = (): void => {
    this.down.clear()
    this.pressed.clear()
    this.mouseX = 0
    this.mouseY = 0
  }
}
