import * as THREE from 'three'
import type { WallBuyDef } from '../../maps/schema'
import { weaponDefs, type WeaponId } from '../weapons/definitions'

/** A weapon for sale on a wall. Prices come from the map, else from the weapon table. */
export interface WallBuy {
  readonly def: WallBuyDef
  readonly weapon: WeaponId
  readonly cost: number
  readonly ammoCost: number
  /** Centre of the sign. */
  readonly position: THREE.Vector3
  /** Unit vector the sign faces (out from the wall, toward the player). */
  readonly facing: THREE.Vector3
}

export function createWallBuy(def: WallBuyDef): WallBuy {
  const weapon = weaponDefs[def.weapon]
  const yaw = THREE.MathUtils.degToRad(def.yaw)
  return {
    def,
    weapon: def.weapon,
    cost: def.cost ?? weapon.wallBuyCost,
    ammoCost: def.ammoCost ?? weapon.ammoCost,
    position: new THREE.Vector3(...def.pos),
    facing: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)),
  }
}
