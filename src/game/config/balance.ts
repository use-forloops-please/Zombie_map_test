import type { WeaponId } from '../weapons/definitions'

/** All tunable gameplay numbers live here. Units: metres, seconds, radians unless noted. */
export const balance = {
  player: {
    /** Capsule total height (feet to top of head). */
    height: 1.8,
    radius: 0.35,
    /** Camera height above the feet. */
    eyeHeight: 1.65,

    walkSpeed: 4.5,
    sprintSpeed: 7,
    /** How quickly horizontal velocity reaches its target on the ground (m/s²). Also acts as friction. */
    groundAccel: 50,
    /** Horizontal control while airborne (m/s²). */
    airAccel: 8,

    /** Initial upward speed of a jump. Jump height = jumpVelocity² / (2 · gravity) ≈ 1 m. */
    jumpVelocity: 6,
    gravity: 18,
    maxFallSpeed: 30,

    /** Tallest ledge the controller climbs without jumping. */
    stepHeight: 0.35,
    maxSlopeDeg: 45,

    /** Radians of view rotation per pixel of mouse movement. */
    mouseSensitivity: 0.0022,
    /** Falling below this height respawns the player. */
    killPlaneY: -20,

    maxHealth: 100,
    /** Seconds without taking damage before health starts regenerating. */
    regenDelay: 3,
    /** Health regained per second once regenerating. */
    regenRate: 50,
  },

  combat: {
    /**
     * Damage multipliers by hit zone. The head multiplier is per weapon
     * (`headshotMultiplier` in weapons/definitions.ts); these cover the rest.
     */
    neckMultiplier: 1.5,
    torsoMultiplier: 1,
    limbMultiplier: 0.8,
    /** Seconds to lower one weapon and raise the next. */
    switchTime: 0.35,
    /** Weapons the player spawns with, by slot. Anything else comes from wall-buys. */
    startingWeapons: ['pistol_service'] satisfies readonly WeaponId[],
    maxWeaponSlots: 2,

    /** Flat melee damage (ignores hit zone). One hit kills in rounds 1–2. */
    meleeDamage: 150,
    meleeRange: 1.6,
    /** Seconds per swing; no shooting or reloading until it ends. */
    meleeCooldown: 0.6,
  },

  zombie: {
    /** Pool size and the most zombies alive at once. */
    maxAlive: 24,
    /** Collision radius (for blocking the player and separation). */
    radius: 0.3,

    walkSpeed: 1.5,
    runSpeed: 3.4,
    /** Radians per second the body turns toward its heading. */
    turnRate: 8,

    /** Minimum seconds between path recomputations per zombie (staggered across zombies). */
    repathInterval: 0.25,
    /** Corner is "reached" within this horizontal distance. */
    cornerReachDist: 0.25,
    /** Zombies closer than this push apart. */
    separationRadius: 0.75,
    /**
     * Push per overlapping neighbour, relative to the zombie's own speed. At 2.5 two zombies
     * settle about radius × (1 − 1/2.5) ≈ 0.45 m apart.
     */
    separationStrength: 2.5,

    /** Starts an attack when the player is within this horizontal distance. */
    attackRange: 1,
    /** The swing connects if the player is still within this distance when it lands. */
    attackReach: 1.5,
    /** Starts a swing through a window at a player within this distance (the wall is in between). */
    windowAttackRange: 1.25,
    /** Seconds from starting a swing to the hit landing. */
    attackWindup: 0.45,
    /** Seconds after a swing before the zombie can move or swing again. */
    attackRecovery: 0.75,
    /** Two quick hits down a full-health player. */
    attackDamage: 60,

    /** Seconds spent rising out of the ground after spawning. */
    spawnRiseTime: 0.8,
    /** Seconds a corpse stays before returning to the pool. */
    corpseTime: 1.2,
  },

  rounds: {
    /** Seconds from the game starting to round 1. */
    introDelay: 4,
    /** Seconds between a round being cleared and the next starting. */
    intermission: 10,

    /** Zombies in rounds 1, 2, 3 … while the table lasts. */
    zombieCounts: [6, 10, 14, 19, 24],
    /** Extra zombies per round after the table runs out. */
    zombieCountGrowth: 5,

    /** Zombie health in round 1. */
    healthBase: 150,
    /** Added per round up to and including `healthLinearUntil`. */
    healthPerRound: 100,
    healthLinearUntil: 9,
    /** Multiplier per round after `healthLinearUntil`. */
    healthGrowth: 1.1,

    /** Each zombie rolls against this chance to be a runner: 0 before `runnerStartRound`. */
    runnerStartRound: 3,
    runnerChancePerRound: 0.15,
    maxRunnerChance: 0.9,

    /** Seconds between spawns: starts here and shrinks each round down to the minimum. */
    spawnIntervalStart: 2,
    spawnIntervalStep: 0.15,
    spawnIntervalMin: 0.5,
  },

  barricade: {
    /** Seconds a zombie takes to tear off one board. */
    tearInterval: 1.3,
    /** Seconds of holding interact per board repaired. */
    repairInterval: 0.75,
    /** Seconds a zombie takes to climb through an empty window. */
    climbTime: 1.3,
    /** Zombies start tearing within this distance of their standing spot outside. */
    tearRange: 0.9,
    /** Standing spot outside the window, metres out from the opening's centre. */
    outsideStandOffset: 0.55,
    /** Landing spot inside the window, metres in from the opening's centre. */
    insideLandOffset: 0.9,
    /** Player can repair from within this horizontal distance of the opening. */
    interactRange: 1.6,
  },

  purchases: {
    /** Seconds a bought door takes to sink away. */
    doorOpenTime: 1,
    /** How far past a door's edge the player can buy it from. */
    doorInteractMargin: 1.3,
    /** Player can buy from a wall-buy sign within this distance. */
    wallBuyRange: 1.5,
  },

  crate: {
    cost: 950,
    /** Seconds the crate cycles through weapons before revealing the result. */
    cycleTime: 3,
    /** Seconds the revealed weapon stays up for the taking. */
    offerTime: 8,
    /** Seconds the crate takes to leave one spot and appear at the next. */
    relocateTime: 2.5,

    /** Relative chance of each weapon per spin. Weapons the player owns are skipped. */
    pool: {
      smg_compact: 22,
      rifle_carbine: 20,
      shotgun_pump: 18,
      rifle_bolt: 16,
      pulse_caster: 4,
    } satisfies Partial<Record<WeaponId, number>>,

    /**
     * After each spin at a spot, the chance the crate moves on. None for the first
     * `relocateMinSpins - 1` spins, `relocateEarlyChance` until `relocateLateAfter`,
     * then `relocateLateChance`: a move before spin 4 is impossible and after 8 more likely.
     */
    relocateMinSpins: 4,
    relocateEarlyChance: 0.1,
    relocateLateAfter: 8,
    relocateLateChance: 0.35,
  },

  points: {
    starting: 500,
    boardRepaired: 10,
    /** Every bullet hit that doesn't kill. The killing hit pays the kill bonus instead. */
    hit: 10,
    bodyKill: 50,
    neckKill: 60,
    headshotKill: 100,
    meleeKill: 130,
    /** Repair points stop after this many per round, so board farming isn't worth it. */
    repairCapPerRound: 500,
  },

  audio: {
    /** Each living zombie groans at a random interval between these (seconds). */
    groanIntervalMin: 2.5,
    groanIntervalMax: 7,
    /** At most one new groan starts per this many seconds, so a horde doesn't turn to mush. */
    groanSpacing: 0.3,
    /** Metres walked per footstep at walking speed; strides lengthen with speed. */
    strideLength: 1.6,
    /** Footsteps only play above this horizontal speed (m/s). */
    footstepMinSpeed: 1,
    /** A landing thud plays after falling faster than this (m/s). */
    landSpeed: 4,
    /** Heartbeat plays while health is below this fraction of max. */
    heartbeatBelow: 0.5,
    /** Seconds between heartbeats. */
    heartbeatInterval: 0.85,
    /** Flesh and impact sounds per simulation step at most (a shotgun blast is one sound). */
    hitSoundsPerStep: 2,
  },

  effects: {
    /** Blood flies this far past a zombie to mark a wall or floor, metres. */
    bloodReach: 2.5,
    /** Chance that a bullet or melee hit on a zombie marks the surface behind it. */
    bloodSplatChance: 0.6,
    /** Splat size range on walls (metres across). */
    bloodSplatSize: [0.4, 0.8],
    /** Pool size range under a zombie killed by a hit (metres across). */
    bloodPoolSize: [0.9, 1.5],
  },

  navmesh: {
    /** Voxel size on the ground plane, metres. Smaller is more precise but slower to build. */
    cellSize: 0.1,
    /** Voxel height, metres. */
    cellHeight: 0.05,
    agentHeight: 1.8,
    agentRadius: 0.3,
    /** Tallest step an agent walks up. */
    agentMaxClimb: 0.4,
    agentMaxSlopeDeg: 45,
  },

  targetDummy: {
    /** Matches round-1 zombie health, so kill counts on dummies predict round 1. */
    health: 150,
    /** Seconds a "killed" dummy stays down before resetting to full health. */
    resetDelay: 1.5,
  },
} as const

export type PlayerTuning = typeof balance.player
export type CombatTuning = typeof balance.combat
export type ZombieTuning = typeof balance.zombie
export type NavmeshTuning = typeof balance.navmesh
export type BarricadeTuning = typeof balance.barricade
export type PointsTuning = typeof balance.points
export type RoundTuning = typeof balance.rounds
export type PurchaseTuning = typeof balance.purchases
export type CrateTuning = typeof balance.crate
export type AudioTuning = typeof balance.audio
export type EffectsTuning = typeof balance.effects
