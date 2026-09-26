import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { Input } from '../../engine/Input'
import { CollisionGroup, interactionGroups, type Physics } from '../../engine/Physics'
import type { PlayerTuning } from '../config/balance'
import { stepVelocity, wishDirection, type Player } from '../entities/Player'

/** Collision skin kept between the capsule and the world. */
const CONTROLLER_OFFSET = 0.01

/** The player is solid against the world and character blockers; hitboxes and shots pass through. */
const PLAYER_GROUPS = interactionGroups(
  CollisionGroup.PLAYER,
  CollisionGroup.WORLD | CollisionGroup.CHARACTER_BLOCKER,
)

/** Moves the player with a Rapier kinematic character controller: walk, sprint, jump, step-up, slopes. */
export class PlayerControllerSystem {
  private readonly player: Player
  private readonly input: Input
  private readonly physics: Physics
  private readonly tuning: PlayerTuning
  private readonly spawn: THREE.Vector3
  private readonly spawnYaw: number

  private readonly body: RAPIER.RigidBody
  private readonly collider: RAPIER.Collider
  private readonly controller: RAPIER.KinematicCharacterController
  /** Feet → capsule centre. */
  private readonly centerOffset: number

  // Scratch objects, reused every step to avoid allocation.
  private readonly wish = new THREE.Vector3()
  private readonly desired = { x: 0, y: 0, z: 0 }
  private readonly moved = new RAPIER.Vector3(0, 0, 0)
  private readonly nextCenter = { x: 0, y: 0, z: 0 }

  constructor(player: Player, input: Input, physics: Physics, tuning: PlayerTuning) {
    this.player = player
    this.input = input
    this.physics = physics
    this.tuning = tuning
    this.spawn = player.position.clone()
    this.spawnYaw = player.yaw

    const halfHeight = tuning.height / 2 - tuning.radius
    this.centerOffset = tuning.height / 2
    const p = player.position
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        p.x,
        p.y + this.centerOffset,
        p.z,
      ),
    )
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, tuning.radius).setCollisionGroups(PLAYER_GROUPS),
      this.body,
    )

    this.controller = physics.world.createCharacterController(CONTROLLER_OFFSET)
    this.controller.setUp({ x: 0, y: 1, z: 0 })
    this.controller.enableAutostep(tuning.stepHeight, tuning.radius * 0.5, false)
    this.controller.enableSnapToGround(tuning.stepHeight)
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(tuning.maxSlopeDeg))
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(tuning.maxSlopeDeg))
  }

  update(dt: number): void {
    const { player, input, tuning } = this

    const forward = Number(input.isDown('moveForward')) - Number(input.isDown('moveBack'))
    const strafe = Number(input.isDown('moveRight')) - Number(input.isDown('moveLeft'))
    wishDirection(forward, strafe, player.yaw, this.wish)
    stepVelocity(
      player.velocity,
      {
        wish: this.wish,
        sprint: forward > 0 && input.isDown('sprint'),
        jump: input.consumePressed('jump'),
      },
      player.grounded,
      dt,
      tuning,
    )

    this.desired.x = player.velocity.x * dt
    this.desired.y = player.velocity.y * dt
    this.desired.z = player.velocity.z * dt
    this.controller.computeColliderMovement(this.collider, this.desired, undefined, PLAYER_GROUPS)
    const moved = this.controller.computedMovement(this.moved)
    player.grounded = this.controller.computedGrounded()

    if (player.grounded && player.velocity.y < 0) player.velocity.y = 0
    // Bumped a ceiling: stop rising.
    if (this.desired.y > 0 && moved.y < this.desired.y * 0.5) player.velocity.y = 0

    player.prevPosition.copy(player.position)
    player.position.x += moved.x
    player.position.y += moved.y
    player.position.z += moved.z

    if (player.position.y < tuning.killPlaneY) {
      this.respawn()
      return
    }

    this.nextCenter.x = player.position.x
    this.nextCenter.y = player.position.y + this.centerOffset
    this.nextCenter.z = player.position.z
    this.body.setNextKinematicTranslation(this.nextCenter)
  }

  respawn(): void {
    this.teleport(this.spawn, this.spawnYaw)
  }

  /** Moves the player's feet to `feet`, facing `yaw`, with no velocity. */
  teleport(feet: THREE.Vector3Like, yaw: number): void {
    const { player } = this
    player.position.copy(feet)
    player.prevPosition.copy(feet)
    player.velocity.set(0, 0, 0)
    player.yaw = yaw
    player.pitch = 0
    player.grounded = false
    this.body.setTranslation({ x: feet.x, y: feet.y + this.centerOffset, z: feet.z }, true)
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller)
    this.physics.world.removeRigidBody(this.body)
  }
}
