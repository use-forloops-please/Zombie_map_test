import { NavMeshHelper } from '@recast-navigation/three'
import * as THREE from 'three'
import { renderSound, soundIds } from '../game/audio/sounds'
import { balance } from '../game/config/balance'
import type { HitZone } from '../game/entities/hitboxes'
import { HitboxRegistry } from '../game/entities/hitboxes'
import { applyLook, createPlayer, type Player } from '../game/entities/Player'
import { Zombie } from '../game/entities/Zombie'
import { EventBus, type GameEvents } from '../game/events'
import { ZoneState } from '../game/entities/Zones'
import { BarricadeSystem } from '../game/systems/BarricadeSystem'
import { CrateSystem } from '../game/systems/CrateSystem'
import { DoorSystem } from '../game/systems/DoorSystem'
import { GoreSystem } from '../game/systems/GoreSystem'
import { InteractSystem } from '../game/systems/InteractSystem'
import { PlayerControllerSystem } from '../game/systems/PlayerControllerSystem'
import { PlayerHealthSystem } from '../game/systems/PlayerHealthSystem'
import { PointsSystem } from '../game/systems/PointsSystem'
import { ProjectileSystem } from '../game/systems/ProjectileSystem'
import { RoundSystem } from '../game/systems/RoundSystem'
import { SoundSystem } from '../game/systems/SoundSystem'
import { SpawnSystem } from '../game/systems/SpawnSystem'
import { StatsSystem } from '../game/systems/StatsSystem'
import { WeaponSystem, type DamageCause, type WeaponViewState } from '../game/systems/WeaponSystem'
import { ZombieAISystem } from '../game/systems/ZombieAISystem'
import { weaponDefs, type WeaponId } from '../game/weapons/definitions'
import { WallBuySystem } from '../game/systems/WallBuySystem'
import { BarricadeRenderer } from '../game/view/BarricadeRenderer'
import { BloodDecals } from '../game/view/BloodDecals'
import { BloodSpray } from '../game/view/BloodSpray'
import { CrateRenderer } from '../game/view/CrateRenderer'
import { DoorRenderer } from '../game/view/DoorRenderer'
import { ImpactMarkers } from '../game/view/ImpactMarkers'
import { ProjectileRenderer } from '../game/view/ProjectileRenderer'
import { Viewmodel } from '../game/view/Viewmodel'
import { ViewPunch } from '../game/view/ViewPunch'
import { WallBuyRenderer } from '../game/view/WallBuyRenderer'
import { ZombieRenderer } from '../game/view/ZombieRenderer'
import type { LightingPresetId } from '../maps/lighting'
import { buildMap, fetchMap, type LoadedMap, type MapSource } from '../maps/MapLoader'
import { initNavigation } from '../maps/navmesh'
import { uiStore } from '../ui/store'
import { AudioEngine } from './Audio'
import { Input } from './Input'
import { Loop } from './Loop'
import { Physics } from './Physics'
import { createRng } from './rng'
import { SAMPLE_RATE } from './synth'

/** How often (seconds) the game pushes a snapshot to the UI store. ~10 Hz. */
const UI_SNAPSHOT_INTERVAL = 0.1
/** How many recent hits the HUD hit feed keeps. */
const HIT_FEED_LENGTH = 6
/** How many point popups can be on screen at once. */
const POPUP_LIMIT = 8

const round1 = (n: number): number => Math.round(n * 10) / 10

export interface GameOptions {
  /** Draw the navmesh as a translucent overlay (`?debug=nav`). */
  showNavmesh?: boolean
  /** Replaces the map's lighting preset and fog (`?lighting=<preset>`), for comparing presets. */
  lighting?: LightingPresetId
}

/** Owns the renderer, scene, loop and systems. */
export class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly loop: Loop
  private readonly physics: Physics
  private readonly input: Input
  private readonly events = new EventBus<GameEvents>()
  private readonly hitboxes = new HitboxRegistry()
  private readonly map: LoadedMap
  private readonly player: Player
  private readonly zombies: Zombie[] = []
  private readonly playerController: PlayerControllerSystem
  private readonly playerHealth: PlayerHealthSystem
  private readonly weapons: WeaponSystem
  private readonly barricades: BarricadeSystem
  private readonly interact: InteractSystem
  private readonly zones: ZoneState
  private readonly doorSystem: DoorSystem
  private readonly wallBuySystem: WallBuySystem
  private readonly crateSystem: CrateSystem | null
  private readonly projectiles: ProjectileSystem
  private readonly gore: GoreSystem
  private readonly sounds: SoundSystem
  private readonly audio: AudioEngine
  private readonly points: PointsSystem
  private readonly stats: StatsSystem
  private readonly rounds: RoundSystem
  private readonly zombieAI: ZombieAISystem
  private readonly spawner: SpawnSystem
  private readonly viewmodel = new Viewmodel()
  private readonly impacts = new ImpactMarkers()
  private readonly bloodDecals = new BloodDecals()
  private readonly bloodSpray = new BloodSpray()
  private readonly punch = new ViewPunch()
  private readonly zombieRenderer: ZombieRenderer
  private readonly barricadeRenderer: BarricadeRenderer
  private readonly doorRenderer: DoorRenderer
  private readonly wallBuyRenderer: WallBuyRenderer
  private readonly crateRenderer: CrateRenderer | null
  private readonly projectileRenderer: ProjectileRenderer
  private readonly navmeshHelper: NavMeshHelper | null = null
  private readonly unsubscribers: (() => void)[] = []

  private readonly mouseDelta = { x: 0, y: 0 }
  private readonly weaponView: WeaponViewState = {
    weaponId: null,
    reload: 0,
    switching: 0,
    melee: 0,
  }
  private uiTimer = 0
  private uiFrames = 0
  /** CPU milliseconds spent in update + render since the last UI snapshot. */
  private cpuMs = 0
  private eventCounter = 0
  /** Counts trigger pulls and swings; hit markers from the same one share an id. */
  private shotCounter = 0
  /** Set when the player goes down: the simulation freezes, rendering continues. */
  private over = false

  private constructor(
    canvas: HTMLCanvasElement,
    physics: Physics,
    source: MapSource,
    options: GameOptions,
  ) {
    const mapDef = source.def
    this.physics = physics

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Two passes per frame (world, then viewmodel), so clear and count draw calls manually.
    this.renderer.autoClear = false
    this.renderer.info.autoReset = false

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200)
    this.camera.rotation.order = 'YXZ'

    const def = options.lighting
      ? { ...mapDef, lighting: { ...mapDef.lighting, preset: options.lighting, fog: undefined } }
      : mapDef
    this.map = buildMap({ ...source, def }, this.scene, physics, this.hitboxes)
    this.scene.add(
      this.impacts.mesh,
      this.bloodDecals.mesh,
      this.bloodSpray.mesh,
      this.viewmodel.worldLight,
    )
    this.audio = new AudioEngine(this.camera)
    this.scene.add(this.audio.group)
    if (options.showNavmesh) {
      this.navmeshHelper = new NavMeshHelper(this.map.nav.navMesh, {
        navMeshMaterial: new THREE.MeshBasicMaterial({
          color: '#3fa7ff',
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      })
      this.navmeshHelper.position.y = 0.02
      this.scene.add(this.navmeshHelper)
    }

    const spawn = mapDef.playerSpawns[0]
    if (!spawn) throw new Error(`Map "${mapDef.id}" has no player spawn`)
    const [x, y, z] = spawn.pos
    this.player = createPlayer({ x, y, z }, THREE.MathUtils.degToRad(spawn.yaw))

    const seed = Date.now()
    const rng = createRng(seed)
    // Cosmetic randomness (sounds, blood) draws from its own stream, never the simulation's.
    const fxRng = createRng(seed ^ 0x5eed)
    this.input = new Input(canvas)
    this.input.onLockChange = (locked) => {
      if (locked) this.audio.unlock()
      uiStore.setState({ pointerLocked: locked })
    }
    this.playerController = new PlayerControllerSystem(
      this.player,
      this.input,
      physics,
      balance.player,
    )
    this.playerHealth = new PlayerHealthSystem(this.events, balance.player)
    this.weapons = new WeaponSystem(
      this.player,
      this.input,
      physics,
      this.hitboxes,
      this.events,
      rng,
      balance.combat,
      balance.player,
    )

    this.points = new PointsSystem(this.events, balance.points)
    this.stats = new StatsSystem(this.events)
    this.barricades = new BarricadeSystem(this.map.windows, this.events, balance.barricade)
    this.interact = new InteractSystem(this.player, this.input)
    this.zones = new ZoneState(mapDef.zones)
    this.doorSystem = new DoorSystem(
      this.map.doors,
      this.zones,
      this.map.nav,
      this.map.navObstacles,
      physics,
      this.points,
      this.events,
      balance.navmesh,
      balance.purchases,
    )
    this.wallBuySystem = new WallBuySystem(
      this.map.wallBuys,
      this.weapons,
      this.points,
      this.events,
      balance.purchases,
    )
    this.crateSystem = this.map.crate
      ? new CrateSystem(
          this.map.crate,
          mapDef.crateSpots,
          this.zones,
          this.weapons,
          this.points,
          this.events,
          physics,
          rng,
          balance.crate,
          balance.purchases,
        )
      : null
    this.projectiles = new ProjectileSystem(
      physics,
      this.hitboxes,
      this.events,
      (entry, dmg, cause) => this.weapons.dealDamage(entry, dmg, cause),
    )
    for (const item of [
      ...this.barricades.createInteractables(),
      ...this.doorSystem.createInteractables(),
      ...this.wallBuySystem.createInteractables(),
      ...(this.crateSystem?.createInteractables() ?? []),
    ]) {
      this.interact.add(item)
    }

    for (let i = 0; i < balance.zombie.maxAlive; i++) {
      this.zombies.push(new Zombie(i, physics, this.hitboxes, balance.zombie))
    }
    this.zombieAI = new ZombieAISystem(
      this.zombies,
      this.player,
      this.map.nav,
      this.barricades,
      this.events,
      balance.zombie,
      balance.barricade,
    )
    this.spawner = new SpawnSystem(
      this.zombies,
      this.map.windows,
      this.zones,
      this.map.nav,
      rng,
      balance.zombie,
    )
    this.rounds = new RoundSystem(
      this.spawner,
      this.events,
      balance.rounds,
      balance.zombie.maxAlive,
    )
    this.gore = new GoreSystem(physics, this.events, fxRng, balance.effects)
    this.sounds = new SoundSystem(
      this.events,
      this.audio,
      this.player,
      this.zombies,
      this.map.windows,
      this.map.doors,
      this.map.crate,
      fxRng,
      balance.audio,
      balance.zombie,
    )
    this.zombieRenderer = new ZombieRenderer(this.zombies, balance.zombie)
    this.scene.add(this.zombieRenderer.group)
    this.barricadeRenderer = new BarricadeRenderer(this.map.windows)
    this.scene.add(this.barricadeRenderer.mesh)
    this.doorRenderer = new DoorRenderer(this.map.doors, balance.purchases.doorOpenTime)
    this.scene.add(this.doorRenderer.group)
    this.wallBuyRenderer = new WallBuyRenderer(this.map.wallBuys)
    this.scene.add(this.wallBuyRenderer.group)
    this.crateRenderer = this.map.crate ? new CrateRenderer(this.map.crate, balance.crate) : null
    if (this.crateRenderer) this.scene.add(this.crateRenderer.group)
    this.projectileRenderer = new ProjectileRenderer(this.projectiles.projectiles)
    this.scene.add(this.projectileRenderer.group)
    physics.syncQueries()

    this.unsubscribers.push(
      this.events.on('meleeSwung', () => this.shotCounter++),
      this.events.on('weaponFired', (e) => {
        this.shotCounter++
        this.viewmodel.fire(e.weaponId)
        const { recoil } = weaponDefs[e.weaponId]
        this.punch.punch(
          THREE.MathUtils.degToRad(recoil.pitch) * 14,
          THREE.MathUtils.degToRad(recoil.yaw) * (Math.random() * 2 - 1) * 8,
          THREE.MathUtils.degToRad(recoil.yaw) * (Math.random() * 2 - 1) * 10,
        )
      }),
      this.events.on('shotImpact', (e) => this.impacts.spawn(e.point, e.normal)),
      this.events.on('explosion', (e) => {
        this.projectileRenderer.explode(e.point, e.radius, e.color)
        const distance = this.player.position.distanceTo({
          x: e.point[0],
          y: e.point[1],
          z: e.point[2],
        })
        this.punch.addShake(0.05 * Math.max(1 - distance / 15, 0))
      }),
      this.events.on('targetHit', (e) => {
        const entry = { id: this.eventCounter++, ...e }
        const kind = e.killed ? 'kill' : e.zone === 'head' ? 'head' : 'hit'
        uiStore.setState((s) => ({
          hitFeed: [entry, ...s.hitFeed].slice(0, HIT_FEED_LENGTH),
          // Within one shot (pellets), a kill or headshot marker isn't downgraded by a later hit.
          hitMarker:
            s.hitMarker?.id === this.shotCounter && s.hitMarker.kind !== 'hit' && kind === 'hit'
              ? s.hitMarker
              : { id: this.shotCounter, kind },
        }))
      }),
      this.events.on('targetStruck', (e) => {
        if (e.targetKind !== 'zombie') return
        const count = e.zone === 'head' ? 14 : e.killed ? 12 : e.cause === 'splash' ? 10 : 6
        this.bloodSpray.burst(e.point, e.direction, count)
      }),
      this.events.on('bloodSplat', (e) => this.bloodDecals.spawn(e.point, e.normal, e.size)),
      this.events.on('pointsChanged', (e) => {
        if (e.delta === 0) return
        const popup = { id: this.eventCounter++, delta: e.delta }
        uiStore.setState((s) => ({
          points: e.points,
          pointPopups: [...s.pointPopups, popup].slice(-POPUP_LIMIT),
        }))
      }),
      this.events.on('roundStarted', (e) =>
        uiStore.setState({ round: e.round, roundBanner: e.round }),
      ),
      this.events.on('playerHit', () => {
        this.punch.punch(-0.6, (Math.random() * 2 - 1) * 0.8, (Math.random() < 0.5 ? -1 : 1) * 1.2)
        this.punch.addShake(0.015)
        uiStore.setState((s) => ({ damageCount: s.damageCount + 1 }))
      }),
      this.events.on('playerDowned', () => this.endGame()),
      this.events.on('navmeshRebuilt', () => {
        if (!this.navmeshHelper) return
        this.navmeshHelper.navMesh = this.map.nav.navMesh
        this.navmeshHelper.update()
      }),
    )

    this.loop = new Loop({
      update: (dt) => this.update(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    })

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  static async create(
    canvas: HTMLCanvasElement,
    mapId: string,
    options: GameOptions = {},
  ): Promise<Game> {
    const [physics] = await Promise.all([Physics.create(), initNavigation()])
    try {
      const source = await fetchMap(mapId)
      return new Game(canvas, physics, source, options)
    } catch (err) {
      physics.dispose()
      throw err
    }
  }

  start(): void {
    this.loop.start()
    void this.audio.loadProgressively(
      soundIds,
      (id) => renderSound(id as (typeof soundIds)[number]),
      SAMPLE_RATE,
    )
    uiStore.setState({
      status: 'running',
      error: null,
      mapName: this.map.def.name,
      weapon: this.weapons.hudState(),
      points: this.points.points,
    })
  }

  stop(): void {
    this.loop.stop()
  }

  dispose(): void {
    this.stop()
    window.removeEventListener('resize', this.resize)
    for (const off of this.unsubscribers) off()
    this.input.dispose()
    this.playerController.dispose()
    this.playerHealth.dispose()
    this.points.dispose()
    this.stats.dispose()
    this.rounds.dispose()
    this.zombieAI.dispose()
    this.barricadeRenderer.dispose()
    this.doorRenderer.dispose()
    this.wallBuyRenderer.dispose()
    this.crateRenderer?.dispose()
    this.crateSystem?.dispose()
    this.projectileRenderer.dispose()
    this.projectiles.dispose()
    this.gore.dispose()
    this.sounds.dispose()
    this.audio.dispose()
    this.bloodDecals.dispose()
    this.bloodSpray.dispose()
    for (const z of this.zombies) z.dispose(this.physics, this.hitboxes)
    this.zombieRenderer.dispose()
    if (this.navmeshHelper) {
      this.navmeshHelper.navMeshGeometry.dispose()
      this.navmeshHelper.navMeshMaterial.dispose()
    }
    this.map.dispose()
    this.impacts.dispose()
    this.viewmodel.dispose()
    this.renderer.dispose()
    this.physics.dispose()
  }

  private endGame(): void {
    if (this.over) return
    this.over = true
    const summary = {
      round: this.rounds.round,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      points: this.points.points,
    }
    this.events.emit('gameOver', summary)
    this.input.releaseLock()
    uiStore.setState({ status: 'gameOver', gameOver: summary })
  }

  private update(dt: number): void {
    const started = performance.now()
    this.simulate(dt)
    this.cpuMs += performance.now() - started
  }

  private simulate(dt: number): void {
    if (this.input.consumePressed('toggleStats')) {
      uiStore.setState((s) => ({ statsVisible: !s.statsVisible }))
    }
    if (this.over) return
    this.playerController.update(dt)
    this.interact.update(dt)
    this.doorSystem.update(dt)
    this.crateSystem?.update(dt)
    this.weapons.update(dt)
    this.rounds.update(dt)
    this.projectiles.update(dt)
    this.zombieAI.update(dt)
    this.playerHealth.update(dt)
    for (const dummy of this.map.dummies) dummy.update(dt)
    this.physics.step(dt)
    this.sounds.update(dt)
  }

  private render(alpha: number, frameDt: number): void {
    const started = performance.now()
    // Mouse look is applied per rendered frame (not per sim step) so aiming never lags the display.
    this.input.consumeMouseDelta(this.mouseDelta)
    if (!this.over) {
      applyLook(this.player, this.mouseDelta.x, this.mouseDelta.y, balance.player.mouseSensitivity)
    }

    const { player, camera, renderer } = this
    camera.position.lerpVectors(player.prevPosition, player.position, alpha)
    camera.position.y += balance.player.eyeHeight
    camera.rotation.set(player.pitch, player.yaw, 0)
    this.punch.update(frameDt)
    this.punch.apply(camera.rotation)
    this.viewmodel.placeWorldLight(camera)

    this.zombieRenderer.update(alpha)
    this.barricadeRenderer.update(frameDt)
    this.doorRenderer.update()
    this.crateRenderer?.update(frameDt)
    this.projectileRenderer.update(alpha, frameDt)
    this.bloodSpray.update(frameDt)
    const speed = Math.hypot(player.velocity.x, player.velocity.z)
    this.viewmodel.update(frameDt, this.weapons.viewState(this.weaponView), speed, player.grounded)

    renderer.info.reset()
    renderer.clear()
    renderer.render(this.scene, camera)
    if (!this.over) {
      renderer.clearDepth()
      renderer.render(this.viewmodel.scene, this.viewmodel.camera)
    }

    this.cpuMs += performance.now() - started
    this.uiFrames++
    this.uiTimer += frameDt
    if (this.uiTimer >= UI_SNAPSHOT_INTERVAL) {
      uiStore.setState({
        fps: Math.round(this.uiFrames / this.uiTimer),
        frameMs: this.cpuMs / this.uiFrames,
        drawCalls: renderer.info.render.calls,
        zombiesAlive: this.spawner.aliveCount,
        playerPos: [
          round1(player.position.x),
          round1(player.position.y),
          round1(player.position.z),
        ],
        weapon: this.weapons.hudState(),
        health: this.playerHealth.health / balance.player.maxHealth,
        points: this.points.points,
        interactPrompt: this.interact.prompt,
        roundPhase: this.rounds.phase,
        roundCountdown: Math.ceil(this.rounds.countdown),
        zombiesRemaining: this.rounds.remaining,
      })
      this.uiFrames = 0
      this.uiTimer = 0
      this.cpuMs = 0
    }
  }

  /**
   * Hooks for automated playtests, exposed as `window.__holdout` in dev builds only
   * (see main.tsx): a state snapshot, teleport, invulnerability, and hitting a zombie
   * through the same damage path weapons use.
   */
  debugApi() {
    return {
      snapshot: () => ({
        player: {
          pos: this.player.position.toArray(),
          yawDeg: THREE.MathUtils.radToDeg(this.player.yaw),
          health: this.playerHealth.health,
        },
        points: this.points.points,
        kills: this.stats.kills,
        headshots: this.stats.headshots,
        over: this.over,
        round: {
          number: this.rounds.round,
          phase: this.rounds.phase,
          queued: this.rounds.queued,
          remaining: this.rounds.remaining,
          countdown: this.rounds.countdown,
        },
        zombies: this.zombies
          .filter((z) => z.active)
          .map((z) => ({
            id: z.index,
            state: z.state,
            health: z.health,
            speed: z.speed,
            pos: z.position.toArray(),
            window: z.entryWindow?.id ?? null,
          })),
        activeZones: this.zones.activeIds,
        audio: this.audio.status(),
        drawCalls: this.renderer.info.render.calls,
        crate: this.map.crate && {
          spot: this.map.crate.spot.id,
          state: this.map.crate.state,
          spinsAtSpot: this.map.crate.spinsAtSpot,
          offer: this.map.crate.offer,
          usePoint: this.map.crate.usePoint.toArray(),
          front: this.map.crate.front.toArray(),
        },
        doors: this.map.doors.map((d) => ({ id: d.id, open: d.open, cost: d.cost })),
        weapon: this.weapons.hudState(),
        windows: this.map.windows.map((w) => ({
          zone: w.zone,
          id: w.id,
          boards: w.boards,
          max: w.maxBoards,
          center: w.center.toArray(),
          outward: w.outward.toArray(),
        })),
      }),
      teleport: (x: number, y: number, z: number, yawDeg: number) =>
        this.playerController.teleport({ x, y, z }, THREE.MathUtils.degToRad(yawDeg)),
      setInvulnerable: (on: boolean) => {
        this.playerHealth.invulnerable = on
      },
      /** Hits zombie `id` for `damage` in `zone`, exactly as a weapon would. */
      grantPoints: (amount: number) => this.points.grant(amount),
      giveWeapon: (id: WeaponId) => this.weapons.giveWeapon(id),
      /** Spawns up to `count` zombies at once (for checking the performance budget). */
      spawnHorde: (count: number, health = 100_000) => {
        let spawned = 0
        for (let i = 0; i < count; i++) {
          if (this.spawner.spawn(health, 0.5)) spawned++
        }
        return spawned
      },
      hitZombie: (id: number, zone: HitZone, damage: number, cause: DamageCause = 'bullet') => {
        const z = this.zombies[id]
        if (!z?.alive) return false
        this.weapons.dealDamage({ owner: z, zone, partIndex: 0 }, damage, cause)
        return true
      },
    }
  }

  private readonly resize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.viewmodel.setAspect(w / h)
  }
}
