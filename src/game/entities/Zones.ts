import type { ZoneDef } from '../../maps/schema'

/** Which of the map's zones are open to play. Opening doors activates zones. */
export class ZoneState {
  private readonly active = new Set<string>()
  private readonly all: readonly ZoneDef[]

  constructor(zones: readonly ZoneDef[]) {
    this.all = zones
    for (const z of zones) if (z.activeAtStart) this.active.add(z.id)
  }

  isActive(zoneId: string): boolean {
    // A map without zones has everything active.
    return this.all.length === 0 || this.active.has(zoneId)
  }

  /** Activates a zone. Returns true if it wasn't active before. */
  activate(zoneId: string): boolean {
    if (this.active.has(zoneId)) return false
    this.active.add(zoneId)
    return true
  }

  get activeIds(): string[] {
    return [...this.active]
  }
}
