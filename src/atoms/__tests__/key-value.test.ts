import { createStore } from 'jotai'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as Y from 'yjs'
import { YKeyValue } from 'y-utility/y-keyvalue'
import { z } from 'zod'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { docAtom, keyValueAtom, liveAtom, select, typedAtom } from '../../index.js'
import { keyReader, live, readKey, UnsupportedValueError, writeKey } from '../../core/index.js'
import { observerCount, syncDocs, watch } from './helpers.js'

const Tone = z.number().min(-1).max(1)
const XY = z.object({ x: z.number(), y: z.number() })

function setup() {
  const doc = new Y.Doc()
  const store = createStore()
  store.set(docAtom, doc)
  const array = doc.getArray<{ key: string; val: unknown }>('master')
  const master = select.keyValue('master')
  return { doc, store, array, master }
}

const entries = (array: Y.Array<any>) => array.toArray()

describe('selectors', () => {
  it('reads the rightmost entry per key', () => {
    const { doc, array, master } = setup()
    array.push([
      { key: 'tone', val: 1 },
      { key: 'gain', val: 2 },
      { key: 'tone', val: 3 },
    ])
    expect(live(doc, master.get('tone')).get()).toBe(3)
    expect(live(doc, master.get('nope', 0)).get()).toBe(0)
    expect(live(doc, master.get('tone', 'x')).get()).toBe('x')
    expect(live(doc, master.keys()).get()).toEqual(['gain', 'tone'])
    expect(live(doc, master.toJSON()).get()).toEqual({ tone: 3, gain: 2 })
  })

  it('skips items that are not entries', () => {
    const { doc, array, master } = setup()
    ;(array as Y.Array<unknown>).push([null, 'x', { val: 1 }, { key: 'tone', val: 0.5 }])
    expect(live(doc, master.toJSON()).get()).toEqual({ tone: 0.5 })
  })

  it('reads a nested key-value array through child', () => {
    const doc = new Y.Doc()
    const board = doc.getMap('board')
    const kv = new Y.Array()
    board.set('master', kv)
    kv.push([{ key: 'tone', val: 0.2 }])
    expect(live(doc, select.map('board').child('master', 'keyValue').get('tone')).get()).toBe(0.2)
  })

  it('get notifies only for its own key', () => {
    const { store, array, master } = setup()
    const tone = liveAtom(master.get('tone', 0))
    const seen = watch(store, tone)
    array.push([{ key: 'gain', val: 1 }])
    expect(seen.seen).toEqual([])
    array.push([{ key: 'tone', val: 0.4 }])
    expect(seen.seen).toEqual([0.4])
    seen()
  })
})

describe('typedAtom over a key', () => {
  it('reads undefined, { value } and { issues }', () => {
    const { store, array, master } = setup()
    const tone = typedAtom(master.key('tone'), Tone)
    expectTypeOf(store.get(tone)).toEqualTypeOf<StandardSchemaV1.Result<number> | undefined>()
    expect(store.get(tone)).toBeUndefined()
    store.set(tone, -0.6)
    expect(store.get(tone)).toEqual({ value: -0.6 })
    array.push([{ key: 'tone', val: 5 }])
    const fresh = typedAtom(master.key('tone'), Tone)
    // The rightmost entry is invalid: issues, not the older valid value.
    expect(store.get(fresh)?.issues).toBeDefined()
  })

  it('writes like YKeyValue#set: appends and deletes older entries', () => {
    const { store, array, master } = setup()
    array.push([
      { key: 'tone', val: 0.1 },
      { key: 'gain', val: 1 },
      { key: 'tone', val: 0.2 },
    ])
    const tone = typedAtom(master.key('tone'), Tone)
    expect(store.set(tone, 0.3)).toEqual({ value: 0.3 })
    expect(entries(array)).toEqual([
      { key: 'gain', val: 1 },
      { key: 'tone', val: 0.3 },
    ])
  })

  it('an invalid value changes nothing', () => {
    const { doc, store, master } = setup()
    const tone = typedAtom(master.key('tone'), Tone)
    store.set(tone, 0)
    const before = Y.encodeStateAsUpdate(doc)
    expect(store.set(tone, 2).issues).toBeDefined()
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('an equal value changes nothing', () => {
    const { doc, store, master } = setup()
    const point = typedAtom(master.key('filter'), XY)
    store.set(point, { x: 1, y: 2 })
    const before = Y.encodeStateAsUpdate(doc)
    store.set(point, { x: 1, y: 2 })
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('a function gets the valid value at write time', () => {
    const { store, array, master } = setup()
    const tone = typedAtom(master.key('tone'), Tone)
    expect(store.set(tone, (prev) => (prev ?? 0) + 0.5)).toEqual({ value: 0.5 })
    array.push([{ key: 'tone', val: 'bad' }])
    expect(store.set(tone, (prev) => (prev === undefined ? -1 : 1))).toEqual({ value: -1 })
  })

  it('stores a copy, so mutating the written value changes nothing', () => {
    const { store, array, master } = setup()
    const point = typedAtom(master.key('filter'), XY)
    const value = { x: 1, y: 2 }
    store.set(point, value)
    value.x = 9
    expect(entries(array)).toEqual([{ key: 'filter', val: { x: 1, y: 2 } }])
  })

  it('throws UnsupportedValueError for a value Yjs cannot store', () => {
    const { store, array, master } = setup()
    const anything = typedAtom(master.key('at'), z.any())
    expect(() => store.set(anything, new Date())).toThrow(UnsupportedValueError)
    expect(entries(array)).toEqual([])
  })

  it('re-renders only when its own key changes, not on cleanup of stale entries', () => {
    const { doc, store, array, master } = setup()
    const tone = typedAtom(master.key('tone'), Tone)
    const seen = watch(store, tone)
    store.set(typedAtom(master.key('gain'), z.number()), 1)
    expect(seen.seen).toEqual([])
    store.set(tone, 0.5)
    expect(seen.seen).toEqual([{ value: 0.5 }])
    // A stale duplicate pushed left of the current one, then cleaned up.
    doc.transact(() => array.insert(0, [{ key: 'tone', val: 0.1 }]))
    array.delete(0, 1)
    expect(seen.seen).toEqual([{ value: 0.5 }])
    seen()
    expect(observerCount(doc)).toBe(0)
  })

  it('reports a missing nested array as an issue', () => {
    const { store } = setup()
    const tone = typedAtom(select.map('board').child('master', 'keyValue').key('tone'), Tone)
    expect(store.set(tone, 0).issues?.[0]?.message).toMatch(/missing/)
  })
})

describe('keyValueAtom', () => {
  it('reads each named key through its schema', () => {
    const { store, array, master } = setup()
    const atom = keyValueAtom(master, { tone: Tone, filter: XY })
    array.push([
      { key: 'tone', val: 0.5 },
      { key: 'other', val: 1 },
      { key: 'filter', val: { x: 'bad' } },
    ])
    const read = store.get(atom)
    expect(read.tone).toEqual({ value: 0.5 })
    expect(read.filter?.issues).toBeDefined()
    expect(Object.keys(read)).toEqual(['tone', 'filter'])
  })

  it('writes nothing when any key is invalid', () => {
    const { store, array, master } = setup()
    const atom = keyValueAtom(master, { tone: Tone, filter: XY })
    const result = store.set(atom, { tone: 0.2, filter: { x: 1 } as never })
    expect(result.issues?.[0]?.path?.[0]).toBe('filter')
    expect(entries(array)).toEqual([])
    expect(store.set(atom, { tone: 0.2, filter: { x: 1, y: 2 } })).toEqual({
      value: { tone: 0.2, filter: { x: 1, y: 2 } },
    })
    expect(store.get(atom)).toEqual({ tone: { value: 0.2 }, filter: { value: { x: 1, y: 2 } } })
  })

  it('ignores keys it does not name', () => {
    const { store, array, master } = setup()
    const atom = keyValueAtom(master, { tone: Tone })
    const seen = watch(store, atom)
    array.push([{ key: 'gain', val: 1 }])
    expect(seen.seen).toEqual([])
    seen()
  })
})

describe('schema layer', () => {
  it('readKey reports a shared type as an issue', () => {
    const { array } = setup()
    ;(array as Y.Array<unknown>).push([{ key: 'tone', val: new Y.Map() }])
    expect(readKey(Tone, array, 'tone')?.issues?.[0]?.message).toMatch(/plain value/)
  })

  it('writeKey and keyReader work without Jotai', () => {
    const { doc, array, master } = setup()
    const tone = live(doc, master.project(keyReader(Tone, 'tone')))
    expect(writeKey(Tone, array, 'tone', 0.25)).toEqual({ value: 0.25 })
    expect(tone.get()).toEqual({ value: 0.25 })
  })
})

describe('compatibility with y-utility YKeyValue', () => {
  it('reads what YKeyValue writes', () => {
    const { store, array, master } = setup()
    const kv = new YKeyValue(array)
    kv.set('tone', 0.1)
    kv.set('gain', 1)
    kv.set('tone', 0.7)
    expect(store.get(typedAtom(master.key('tone'), Tone))).toEqual({ value: 0.7 })
  })

  it('YKeyValue reads what duratom writes, in the same doc and a synced one', () => {
    const { doc, store, array, master } = setup()
    const kv = new YKeyValue(array)
    const tone = typedAtom(master.key('tone'), Tone)
    store.set(tone, 0.1)
    store.set(tone, -0.4)
    expect(kv.get('tone')).toBe(-0.4)
    expect(array.length).toBe(1)

    const other = new Y.Doc()
    const otherKv = new YKeyValue(other.getArray<{ key: string; val: unknown }>('master'))
    syncDocs(doc, other)
    expect(otherKv.get('tone')).toBe(-0.4)
    otherKv.set('tone', 0.9)
    syncDocs(doc, other)
    expect(store.get(typedAtom(master.key('tone'), Tone))).toEqual({ value: 0.9 })
    expect(kv.get('tone')).toBe(0.9)
  })

  it('concurrent writes converge on the same value for duratom and YKeyValue', () => {
    const a = setup()
    const b = setup()
    const kvB = new YKeyValue(b.array)
    a.store.set(typedAtom(a.master.key('tone'), Tone), 0.1)
    kvB.set('tone', 0.2)
    syncDocs(a.doc, b.doc)
    const readA = a.store.get(typedAtom(a.master.key('tone'), Tone))
    expect(readA).toEqual({ value: kvB.get('tone') })
  })
})
