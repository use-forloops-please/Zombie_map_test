import type { HitZone } from '../game/entities/hitboxes'
import { useUi } from './store'

/** The performance budget from CLAUDE.md; the stats line turns red past it. */
const BUDGET_FPS = 60
const BUDGET_DRAW_CALLS = 150

const ZONE_LABELS: Record<HitZone, string> = {
  head: 'HEAD',
  neck: 'NECK',
  torso: 'BODY',
  limb: 'LIMB',
}

export function Hud() {
  const status = useUi((s) => s.status)
  const error = useUi((s) => s.error)
  const mapName = useUi((s) => s.mapName)
  const pointerLocked = useUi((s) => s.pointerLocked)

  if (status === 'error') {
    return (
      <div className="overlay overlay-error">
        <h2>Failed to start</h2>
        <pre>{error}</pre>
      </div>
    )
  }

  return (
    <>
      <div className="hud">
        <div className="hud-title">PROJECT HOLDOUT</div>
        <div className="hud-sub">{status === 'loading' ? 'Loading…' : mapName}</div>
        <Stats />
      </div>

      {status === 'running' && (
        <>
          <DamageOverlay />
          <HitFeed />
          <AmmoPanel />
          <RoundPanel />
          <RoundBanner />
          <InteractPrompt />
        </>
      )}

      {status === 'running' && pointerLocked && (
        <>
          <div className="crosshair" />
          <HitMarkerView />
        </>
      )}

      {status === 'running' && !pointerLocked && (
        <div className="overlay overlay-start">
          <div className="start-title">Click to play</div>
          <div className="start-controls">
            WASD move · Shift sprint · Space jump · Mouse look · Esc release
            <br />
            Click fire · R reload · V melee · 1/2 or wheel switch weapon · F interact · ` stats
          </div>
        </div>
      )}

      {status === 'gameOver' && <GameOverScreen />}
    </>
  )
}

function Stats() {
  const visible = useUi((s) => s.statsVisible)
  const fps = useUi((s) => s.fps)
  const frameMs = useUi((s) => s.frameMs)
  const drawCalls = useUi((s) => s.drawCalls)
  const zombiesAlive = useUi((s) => s.zombiesAlive)
  const remaining = useUi((s) => s.zombiesRemaining)
  const playerPos = useUi((s) => s.playerPos)
  if (!visible) return null
  return (
    <div className="hud-stats">
      <span className={fps < BUDGET_FPS - 2 ? 'over-budget' : undefined}>{fps} fps</span> ·{' '}
      {frameMs.toFixed(1)} ms cpu ·{' '}
      <span className={drawCalls > BUDGET_DRAW_CALLS ? 'over-budget' : undefined}>
        {drawCalls} draw calls
      </span>{' '}
      · {zombiesAlive} zombies alive / {remaining} left in round · pos {playerPos.join(' ')}
    </div>
  )
}

/** Four ticks around the crosshair on every hit: brighter on a headshot, red on a kill. */
function HitMarkerView() {
  const marker = useUi((s) => s.hitMarker)
  if (!marker) return null
  return <div key={marker.id} className={`hit-marker hit-marker-${marker.kind}`} />
}

/** Red vignette that deepens as health drops, plus a flash on every hit taken. */
function DamageOverlay() {
  const health = useUi((s) => s.health)
  const damageCount = useUi((s) => s.damageCount)
  return (
    <>
      <div className="damage-vignette" style={{ opacity: Math.min((1 - health) * 1.2, 0.9) }} />
      {damageCount > 0 && <div key={damageCount} className="damage-flash" />}
    </>
  )
}

/** Round number and points, bottom-left. */
function RoundPanel() {
  const round = useUi((s) => s.round)
  const phase = useUi((s) => s.roundPhase)
  const countdown = useUi((s) => s.roundCountdown)
  const points = useUi((s) => s.points)
  const popups = useUi((s) => s.pointPopups)
  return (
    <div className="round-panel">
      {round > 0 && (
        <div className={phase === 'intermission' ? 'round-number round-cleared' : 'round-number'}>
          {round}
        </div>
      )}
      {phase !== 'active' && countdown > 0 && (
        <div className="round-countdown">
          {round === 0 ? 'First wave' : 'Next round'} in {countdown}
        </div>
      )}
      <div className="points">
        {points.toLocaleString()}
        <div className="point-popups">
          {popups.map((p) => (
            <span key={p.id} className={p.delta < 0 ? 'point-popup point-spend' : 'point-popup'}>
              {p.delta > 0 ? '+' : '−'}
              {Math.abs(p.delta)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** "ROUND N" across the screen for a few seconds when a round starts. */
function RoundBanner() {
  const banner = useUi((s) => s.roundBanner)
  if (banner === 0) return null
  return (
    <div key={banner} className="round-banner">
      Round {banner}
    </div>
  )
}

function InteractPrompt() {
  const prompt = useUi((s) => s.interactPrompt)
  const locked = useUi((s) => s.pointerLocked)
  if (!prompt || !locked) return null
  return <div className="interact-prompt">{prompt}</div>
}

function AmmoPanel() {
  const weapon = useUi((s) => s.weapon)
  if (!weapon) return null

  const empty = weapon.mag === 0 && weapon.reserve === 0
  const low = weapon.mag <= Math.ceil(weapon.magSize / 4)
  const prompt = empty
    ? 'NO AMMO'
    : weapon.reloading
      ? 'RELOADING'
      : low && weapon.reserve > 0
        ? 'Press R to reload'
        : null

  return (
    <div className="ammo">
      <div className="ammo-slots">
        {weapon.slotNames.map((name, i) => (
          <span key={i} className={i === weapon.activeSlot ? 'slot slot-active' : 'slot'}>
            {i + 1} {name}
          </span>
        ))}
      </div>
      <div className="ammo-count">
        <span className={low ? 'ammo-mag ammo-low' : 'ammo-mag'}>{weapon.mag}</span>
        <span className="ammo-reserve"> / {weapon.reserve}</span>
      </div>
      {weapon.reloading && (
        <div className="reload-bar">
          <div style={{ width: `${Math.round(weapon.reloadProgress * 100)}%` }} />
        </div>
      )}
      {prompt && <div className="ammo-prompt">{prompt}</div>}
    </div>
  )
}

/** Per-hit readout; a debugging aid, so it shows with the stats line. */
function HitFeed() {
  const visible = useUi((s) => s.statsVisible)
  const hits = useUi((s) => s.hitFeed)
  if (!visible) return null
  return (
    <div className="hit-feed">
      {hits.map((h) => (
        <div key={h.id} className={`hit hit-${h.zone}${h.killed ? ' hit-kill' : ''}`}>
          {h.killed ? 'KILL · ' : ''}
          {ZONE_LABELS[h.zone]} −{Math.round(h.damage)}
          <span className="hit-hp"> ({Math.round(h.healthLeft)} hp)</span>
        </div>
      ))}
    </div>
  )
}

function GameOverScreen() {
  const summary = useUi((s) => s.gameOver)
  const restart = useUi((s) => s.restart)
  if (!summary) return null
  return (
    <div className="overlay game-over">
      <div className="game-over-title">You didn&apos;t make it</div>
      <div className="game-over-sub">You held out until round {summary.round}</div>
      <dl className="game-over-stats">
        <dt>Round reached</dt>
        <dd>{summary.round}</dd>
        <dt>Kills</dt>
        <dd>{summary.kills}</dd>
        <dt>Headshots</dt>
        <dd>{summary.headshots}</dd>
        <dt>Points</dt>
        <dd>{summary.points.toLocaleString()}</dd>
      </dl>
      {restart && (
        <button className="game-over-button" onClick={restart} autoFocus>
          Play again
        </button>
      )}
    </div>
  )
}
