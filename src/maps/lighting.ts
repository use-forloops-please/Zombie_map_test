/**
 * Lighting presets a map picks with `lighting.preset`. Each sets the sky/ground fill, one
 * shadow-casting key light (moon, sun or work light), and default fog, which the map can
 * override with `lighting.fog`. Add lamps with `lighting.lamps` for local light.
 */
export interface LightingPreset {
  /** Hemisphere fill: sky colour, ground colour, intensity. */
  hemi: { sky: string; ground: string; intensity: number }
  /** Shadow-casting directional key light, pointing along -`dir`. */
  key: { color: string; intensity: number; dir: readonly [number, number, number] }
  fog: { color: string; near: number; far: number }
}

export const lightingPresetIds = ['night-dim', 'bunker-amber', 'overcast-dusk', 'blackout'] as const
export type LightingPresetId = (typeof lightingPresetIds)[number]

export const lightingPresets: Record<LightingPresetId, LightingPreset> = {
  /** Cold moonlight over the yard; the default. */
  'night-dim': {
    hemi: { sky: '#7d8ca3', ground: '#1c1814', intensity: 0.9 },
    key: { color: '#c4d2ff', intensity: 1.1, dir: [-0.4, 1, 0.3] },
    fog: { color: '#0b0d10', near: 8, far: 45 },
  },
  /** Low, warm and smoky: sodium work lights through haze. Pairs well with lamps. */
  'bunker-amber': {
    hemi: { sky: '#8a7560', ground: '#1a120c', intensity: 0.55 },
    key: { color: '#ffb070', intensity: 0.55, dir: [0.3, 1, -0.2] },
    fog: { color: '#140d08', near: 5, far: 30 },
  },
  /** Flat grey evening light; the easiest preset to read a layout in. */
  'overcast-dusk': {
    hemi: { sky: '#9aa6b8', ground: '#2a2a2e', intensity: 1.3 },
    key: { color: '#d8dde6', intensity: 0.7, dir: [0.5, 1, 0.4] },
    fog: { color: '#3a4048', near: 10, far: 60 },
  },
  /** Almost no ambient light and heavy black fog: lamps and muzzle flashes do the work. */
  blackout: {
    hemi: { sky: '#3a4250', ground: '#0a0808', intensity: 0.22 },
    key: { color: '#8090b0', intensity: 0.25, dir: [-0.3, 1, 0.5] },
    fog: { color: '#030304', near: 3, far: 22 },
  },
}
