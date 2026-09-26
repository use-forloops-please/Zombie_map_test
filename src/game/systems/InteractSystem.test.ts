import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createPlayer } from '../entities/Player'
import { InteractSystem, oncePerPress, type Interactable } from './InteractSystem'

const DT = 1 / 60

function item(name: string, pos: [number, number, number], used: string[]): Interactable {
  return {
    position: new THREE.Vector3(...pos),
    range: 1.5,
    prompt: () => `Use ${name}`,
    ...oncePerPress(() => used.push(name)),
  }
}

describe('InteractSystem', () => {
  // A door over a door, as on a two-storey map; the player faces +X (yaw -π/2).
  function stacked(feetY: number) {
    const used: string[] = []
    const player = createPlayer({ x: 5.2, y: feetY, z: 0 }, -Math.PI / 2)
    const interact = new InteractSystem(player, { isDown: (a) => a === 'interact' })
    interact.add(item('ground door', [6.15, 1.25, 0], used))
    interact.add(item('upper door', [6.15, 4.375, 0], used))
    for (let i = 0; i < 30; i++) interact.update(DT)
    return { used, prompt: interact.prompt }
  }

  it('only offers what is within reach of the floor the player stands on', () => {
    expect(stacked(0)).toEqual({ used: ['ground door'], prompt: 'Use ground door' })
    expect(stacked(3.125)).toEqual({ used: ['upper door'], prompt: 'Use upper door' })
  })

  it('offers nothing from a floor too far below or above', () => {
    expect(stacked(-3).used).toEqual([])
    expect(stacked(7).used).toEqual([])
  })
})
