import { format } from 'prettier'
import { describe, expect, it } from 'vitest'
import bunker01Art from '../../public/maps/bunker-01-art/map.json?raw'
import bunker01 from '../../public/maps/bunker-01/map.json'
import bunker01Text from '../../public/maps/bunker-01/map.json?raw'
import testRangeText from '../../public/maps/test-range/map.json?raw'
import { parseMap } from '../maps/schema'
import { EditorDocument, itemKinds, newMapDraft, type MapDraft } from './document'
import { formatJson } from './formatJson'

describe('EditorDocument', () => {
  it('starts from a map that is already valid and playable', () => {
    const doc = new EditorDocument()
    expect(doc.validate().ok).toBe(true)
  })

  it('round-trips an existing map: import then export changes nothing', () => {
    const doc = new EditorDocument(bunker01 as MapDraft)
    const out = JSON.parse(doc.toJson()) as unknown
    expect(out).toEqual(bunker01)
    const a = parseMap(bunker01)
    const b = parseMap(out)
    expect(a.ok && b.ok && b.map).toEqual(a.ok && a.map)
  })

  it('opening a map and exporting it untouched gives back the same file, byte for byte', () => {
    for (const text of [bunker01Text, bunker01Art, testRangeText]) {
      expect(new EditorDocument(JSON.parse(text) as MapDraft).toJson()).toBe(text)
    }
  })

  it('writes JSON exactly as Prettier would format it', async () => {
    const doc = new EditorDocument(bunker01 as MapDraft)
    const json = doc.toJson()
    expect(await format(json, { parser: 'json', printWidth: 100 })).toBe(json)
    expect(formatJson({ a: [1, 2], b: {} })).toBe('{ "a": [1, 2], "b": {} }\n')
  })

  it('adds every kind of item with sensible defaults, and the map stays valid', () => {
    const doc = new EditorDocument()
    for (const kind of itemKinds) doc.add(kind, [2, 0, 3])
    // Only the door (which needs two different zones) complains, until a second zone exists.
    const zoneCount = doc.count('zone')
    expect(zoneCount).toBe(2)
    const result = doc.validate()
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'))
    expect(result.map.windows[0]).toMatchObject({
      id: 'w1',
      zone: 'start',
      outsideSpawn: [2, 0, 0],
    })
    expect(result.map.lighting.lamps).toHaveLength(1)
  })

  it('gives new and duplicated items unique ids', () => {
    const doc = new EditorDocument()
    const a = doc.add('window', [0, 0, 0])
    const b = doc.add('window', [1, 0, 0])
    const c = doc.duplicate(a)!
    expect([a, b, c].map((r) => doc.get(r)!.id)).toEqual(['w1', 'w2', 'w3'])
    expect(doc.position(c)).toEqual([1, 1.5, 1])
  })

  it('moves, resizes and turns items the way the gizmos do', () => {
    const doc = new EditorDocument()
    const zone = { kind: 'zone' as const, index: 0 }
    doc.setPosition(zone, [1, 1.5, 2])
    expect(doc.get(zone)!.bounds).toEqual({ min: [-11, 0, -10], max: [13, 3, 14] })
    doc.setSize(zone, [4, 3, -2]) // a gizmo can drag through zero; sizes stay positive
    expect(doc.get(zone)!.bounds).toEqual({ min: [-1, 0, 1], max: [3, 3, 3] })

    const spawn = { kind: 'spawn' as const, index: 0 }
    doc.setYaw(spawn, 270)
    expect(doc.yaw(spawn)).toBe(-90)
    doc.setYaw(spawn, -180)
    expect(doc.yaw(spawn)).toBe(180)
    doc.setPosition(spawn, [0.30000000000000004, 0, 1 / 3])
    expect(doc.get(spawn)!.pos).toEqual([0.3, 0, 0.333])

    const w = doc.add('window', [0, 0, 0])
    doc.setPosition({ ...w, handle: 'outside' }, [5, 0, 5])
    expect(doc.get(w)!.outsideSpawn).toEqual([5, 0, 5])
    expect(doc.get(w)!.pos).toEqual([0, 1.5, 0])
  })

  it('undoes and redoes, and a whole drag is a single undo step', () => {
    const doc = new EditorDocument()
    const spawn = { kind: 'spawn' as const, index: 0 }
    doc.begin()
    for (let i = 1; i <= 30; i++) doc.setPosition(spawn, [i / 10, 0, 0], false)
    doc.commit()
    const b = doc.add('brush', [5, 0, 5])
    doc.update(b, { material: 'wood' })
    expect(doc.get(b)!.material).toBe('wood')

    expect(doc.undo()).toBe(true) // material
    expect(doc.get(b)!.material).toBe('concrete')
    expect(doc.undo()).toBe(true) // brush added
    expect(doc.count('brush')).toBe(1)
    expect(doc.undo()).toBe(true) // the whole drag
    expect(doc.get(spawn)!.pos).toEqual([0, 0, 0])
    expect(doc.canUndo).toBe(false)

    expect(doc.redo()).toBe(true)
    expect(doc.get(spawn)!.pos).toEqual([3, 0, 0])
    // A new change after undo drops the redo history.
    doc.remove(spawn)
    expect(doc.canRedo).toBe(false)
  })

  it('a drag that ends where it started records nothing', () => {
    const doc = new EditorDocument()
    const spawn = { kind: 'spawn' as const, index: 0 }
    doc.begin()
    doc.setPosition(spawn, [4, 0, 0], false)
    doc.setPosition(spawn, [0, 0, 0], false)
    doc.commit()
    expect(doc.canUndo).toBe(false)
  })

  it('points each validation problem at the item it is about', () => {
    const doc = new EditorDocument()
    const w = doc.add('window', [0, 0, 0])
    doc.update(w, { zone: 'nowhere' })
    doc.remove({ kind: 'spawn', index: 0 })
    const result = doc.validate()
    expect(result.ok).toBe(false)
    if (result.ok) return
    const refs = result.issues.map((i) => ({ ref: doc.refForIssue(i), message: i.message }))
    expect(refs).toContainEqual({
      ref: { kind: 'window', index: 0 },
      message: 'unknown zone "nowhere"',
    })
    expect(refs.some((r) => r.ref === null && /playerSpawns|>=1|at least/i.test(r.message))).toBe(
      true,
    )
  })

  it('renaming a zone carries its windows, doors and crate spots along', () => {
    const doc = new EditorDocument()
    doc.add('zone', [10, 0, 0])
    const w = doc.add('window', [0, 0, 0])
    const d = doc.add('door', [0, 0, 0])
    const c = doc.add('crateSpot', [0, 0, 0])
    doc.update(c, { zone: 'start' })
    doc.rename({ kind: 'zone', index: 0 }, 'bunker')
    expect(doc.get(w)!.zone).toBe('bunker')
    expect(doc.get(d)!.connects).toEqual(['bunker', 'zone1'])
    expect(doc.get(c)!.zone).toBe('bunker')
    expect(doc.validate().ok).toBe(true)
    doc.undo()
    expect(doc.get(w)!.zone).toBe('start')
  })

  it('leaves empty optional lists out of the export', () => {
    const doc = new EditorDocument(newMapDraft('bare'))
    const d = doc.add('door', [0, 0, 0])
    doc.remove(d)
    const out = JSON.parse(doc.toJson()) as Record<string, unknown>
    expect(out).not.toHaveProperty('doors')
    expect(out.playerSpawns).toBeDefined()
  })
})
