import { atom, createStore } from 'jotai'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { array, at, docAtom, select, typedAtom } from '../../index.js'
import { UnsupportedValueError } from '../../core/index.js'
import { observerCount, syncDocs, watch } from './helpers.js'

const Card = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  labels: z.array(z.string()),
  due: z.string().nullable().optional(),
})
type Card = z.output<typeof Card>
const cardShape = { title: 'text', labels: array() } as const

const card: Card = { title: 'Ship it', priority: 'low', labels: ['a'] }

function setup(id = 'c1') {
  const doc = new Y.Doc()
  const store = createStore()
  store.set(docAtom, doc)
  const cards = doc.getMap<unknown>('cards')
  const cardAtom = typedAtom(select.map('cards').child(id), Card, cardShape)
  return { doc, store, cards, cardAtom }
}

/** The doc's state, to check that a set changed nothing. */
const stateOf = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc)

describe('reading', () => {
  it('reads undefined while the node is missing, then { value }', () => {
    const { store, cardAtom } = setup()
    expect(store.get(cardAtom)).toBeUndefined()
    store.set(cardAtom, card)
    expect(store.get(cardAtom)).toEqual({ value: card })
  })

  it('reads { issues } when a peer stores a value the schema rejects', () => {
    const { store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    const stop = watch(store, cardAtom)
    ;(cards.get('c1') as Y.Map<unknown>).set('priority', 'urgent')
    expect(store.get(cardAtom)?.issues?.[0]?.path).toEqual(['priority'])
    expect(stop.seen).toHaveLength(1)
    stop()
  })

  it('notifies only when the result changes, and stops observing on unmount', () => {
    const { doc, store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    const stop = watch(store, cardAtom)
    doc.getMap('other').set('x', 1)
    store.set(cardAtom, { priority: 'low' })
    expect(stop.seen).toEqual([])
    ;(cards.get('c1') as Y.Map<unknown>).set('priority', 'high')
    expect(stop.seen).toEqual([{ value: { ...card, priority: 'high' } }])
    stop()
    expect(observerCount(doc)).toBe(0)
  })

  it('takes a Locator as well as a select path', () => {
    const { store } = setup()
    const byLocator = typedAtom(at.map('cards').child('c1'), Card, cardShape)
    store.set(byLocator, card)
    expect(store.get(byLocator)).toEqual({ value: card })
  })

  it('types its value as the schema result', () => {
    const { cardAtom, store } = setup()
    expectTypeOf(store.get(cardAtom)).toEqualTypeOf<StandardSchemaV1.Result<Card> | undefined>()
    expectTypeOf(store.set(cardAtom, {})).toEqualTypeOf<StandardSchemaV1.Result<Card>>()
    store.set(cardAtom, (prev) => {
      expectTypeOf(prev).toEqualTypeOf<Card | undefined>()
      return { title: prev?.title ?? '' }
    })
    // @ts-expect-error not a field of Card
    store.set(cardAtom, { color: 'red' })
  })
})

describe('setting a patch', () => {
  it('changes only the patched field and returns the schema result', () => {
    const { doc, store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    const updates = vi.fn()
    doc.on('update', updates)
    const result = store.set(cardAtom, { priority: 'high' })
    expect(result).toEqual({ value: { ...card, priority: 'high' } })
    expect(updates).toHaveBeenCalledTimes(1)
    const node = cards.get('c1') as Y.Map<unknown>
    expect(node.get('title')).toBeInstanceOf(Y.Text)
    expect(node.toJSON()).toEqual({ ...card, priority: 'high' })
  })

  it('merges into the doc as it is at write time: a peer’s edit just synced survives', () => {
    const { doc, store, cardAtom } = setup()
    store.set(cardAtom, card)
    const peer = new Y.Doc()
    syncDocs(doc, peer)
    const peerTitle = (peer.getMap('cards').get('c1') as Y.Map<Y.Text>).get('title')!
    peerTitle.insert(peerTitle.length, ' today')
    // Applied without the atom mounted, so no snapshot of it was taken here.
    syncDocs(peer, doc)
    expect(store.set(cardAtom, { priority: 'high' })).toEqual({
      value: { ...card, title: 'Ship it today', priority: 'high' },
    })
  })

  it('keeps a concurrent edit to another field once both peers sync', () => {
    const { doc, store, cardAtom } = setup()
    store.set(cardAtom, card)
    const peer = new Y.Doc()
    syncDocs(doc, peer)
    const stop = watch(store, cardAtom)
    // Both edit before either sees the other's change.
    const peerTitle = (peer.getMap('cards').get('c1') as Y.Map<Y.Text>).get('title')!
    peerTitle.insert(0, 'Renamed: ')
    store.set(cardAtom, { priority: 'high' })
    syncDocs(doc, peer)
    const merged = { ...card, title: 'Renamed: Ship it', priority: 'high' }
    expect(store.get(cardAtom)).toEqual({ value: merged })
    expect(peer.getMap('cards').toJSON()).toEqual({ c1: merged })
    stop()
  })

  it('keeps two peers typing in the text field when one sets a patch', () => {
    const { doc, store, cardAtom } = setup()
    store.set(cardAtom, card)
    const peer = new Y.Doc()
    syncDocs(doc, peer)
    const peerTitle = (peer.getMap('cards').get('c1') as Y.Map<Y.Text>).get('title')!
    peerTitle.insert(peerTitle.length, '!')
    store.set(cardAtom, { title: 'Now ship it' })
    syncDocs(doc, peer)
    expect(peer.getMap('cards').toJSON().c1.title).toBe('Now ship it!')
  })

  it('keeps keys the schema doesn’t know, such as a newer peer’s field', () => {
    const { store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    const node = cards.get('c1') as Y.Map<unknown>
    node.set('color', { hue: 3 })
    store.set(cardAtom, { priority: 'medium' })
    expect(node.get('color')).toEqual({ hue: 3 })
  })

  it('keeps fields the patch leaves out, and sets one it gives as undefined', () => {
    const { store, cards, cardAtom } = setup()
    store.set(cardAtom, { ...card, due: '2026-12-01' })
    store.set(cardAtom, { labels: ['b'] })
    const node = cards.get('c1') as Y.Map<unknown>
    expect(node.get('due')).toBe('2026-12-01')
    expect(store.set(cardAtom, { due: undefined })).toEqual({
      value: { ...card, labels: ['b'], due: undefined },
    })
    expect(node.get('due')).toBeUndefined()
  })

  it('gives a function patch the value in the doc at write time', () => {
    const { store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    ;(cards.get('c1') as Y.Map<unknown>).set('labels', Y.Array.from(['a', 'peer']))
    const result = store.set(cardAtom, (prev) => ({ labels: [...prev!.labels, 'mine'] }))
    expect(result).toEqual({ value: { ...card, labels: ['a', 'peer', 'mine'] } })
  })

  it('makes one transaction, so observers see one change', () => {
    const { doc, store, cardAtom } = setup()
    store.set(cardAtom, card)
    const transactions = vi.fn()
    doc.on('afterTransaction', transactions)
    store.set(cardAtom, { title: 'x', priority: 'high', labels: [] })
    expect(transactions).toHaveBeenCalledTimes(1)
  })
})

describe('an invalid set', () => {
  it('changes nothing and returns the issues when a patch makes the value invalid', () => {
    const { doc, store, cardAtom } = setup()
    store.set(cardAtom, card)
    const before = stateOf(doc)
    const result = store.set(cardAtom, { priority: 'urgent' as never })
    expect(result.issues?.[0]?.path).toEqual(['priority'])
    expect(stateOf(doc)).toEqual(before)
    expect(store.get(cardAtom)).toEqual({ value: card })
  })

  it('changes nothing when a partial patch meets a node that is already invalid', () => {
    const { doc, store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    ;(cards.get('c1') as Y.Map<unknown>).set('priority', 'urgent')
    const before = stateOf(doc)
    const patch = vi.fn((_prev: Card | undefined) => ({ labels: ['b'] }))
    expect(store.set(cardAtom, patch).issues?.length).toBeGreaterThan(0)
    expect(patch).toHaveBeenCalledWith(undefined)
    expect(stateOf(doc)).toEqual(before)
  })

  it('reports a shared type of another kind at the node as issues, changing nothing', () => {
    const { doc, store, cards, cardAtom } = setup()
    cards.set('c1', new Y.Text('not a map'))
    const before = stateOf(doc)
    expect(store.set(cardAtom, card).issues).toHaveLength(1)
    expect(stateOf(doc)).toEqual(before)
  })

  it('throws for a value a Y.Map can’t store, before writing anything', () => {
    const { doc, store } = setup()
    const loose = typedAtom(select.map('cards').child('c1'), z.object({ when: z.any() }), {})
    store.set(loose, { when: 1 })
    const before = stateOf(doc)
    expect(() => store.set(loose, { when: new Date() })).toThrow(UnsupportedValueError)
    expect(stateOf(doc)).toEqual(before)
  })
})

describe('a node with no valid value', () => {
  it('is repaired by a whole valid value, keeping keys neither the shape nor the value names', () => {
    const { store, cards, cardAtom } = setup()
    store.set(cardAtom, card)
    const node = cards.get('c1') as Y.Map<unknown>
    const title = node.get('title')
    node.set('priority', 'urgent')
    node.set('labels', 'not an array')
    node.set('color', 'red')
    expect(store.set(cardAtom, { ...card, labels: ['fixed'] })).toEqual({
      value: { ...card, labels: ['fixed'] },
    })
    expect(store.get(cardAtom)).toEqual({ value: { ...card, labels: ['fixed'] } })
    expect(node.get('color')).toBe('red')
    // The text field was valid, so it is kept as it is rather than replaced.
    expect(node.get('title')).toBe(title)
  })

  it('reads issues from an empty root map, and takes its first whole value', () => {
    const Meta = z.object({ name: z.string() })
    const { doc, store } = setup()
    const meta = typedAtom(select.map('meta'), Meta, {})
    expect(store.get(meta)?.issues).toBeDefined()
    expect(store.set(meta, { name: 'Board' })).toEqual({ value: { name: 'Board' } })
    expect(doc.getMap('meta').toJSON()).toEqual({ name: 'Board' })
  })
})

describe('the first write', () => {
  it('creates a missing node from a whole valid value', () => {
    const { store, cards, cardAtom } = setup()
    const stop = watch(store, cardAtom)
    expect(store.set(cardAtom, card)).toEqual({ value: card })
    const node = cards.get('c1')
    expect(node).toBeInstanceOf(Y.Map)
    expect((node as Y.Map<unknown>).get('title')).toBeInstanceOf(Y.Text)
    expect(stop.seen).toEqual([{ value: card }])
    stop()
  })

  it('creates the node even when every field is empty', () => {
    const Empty = z.object({ title: z.string() })
    const { store, cards } = setup()
    const a = typedAtom(select.map('cards').child('e'), Empty, { title: 'text' })
    expect(store.set(a, { title: '' })).toEqual({ value: { title: '' } })
    expect(cards.get('e')).toBeInstanceOf(Y.Map)
    expect(store.get(a)).toEqual({ value: { title: '' } })
  })

  it('creates nothing for a partial patch or an invalid value', () => {
    const { doc, store, cards, cardAtom } = setup()
    const before = stateOf(doc)
    expect(store.set(cardAtom, { priority: 'high' }).issues?.length).toBeGreaterThan(0)
    expect(store.set(cardAtom, { ...card, priority: 'urgent' as never }).issues).toBeDefined()
    expect(cards.has('c1')).toBe(false)
    expect(stateOf(doc)).toEqual(before)
  })

  it('gives a function patch undefined as prev', () => {
    const { store, cardAtom } = setup()
    const patch = vi.fn((prev: Card | undefined) => (prev ? {} : card))
    expect(store.set(cardAtom, patch)).toEqual({ value: card })
    expect(patch).toHaveBeenCalledWith(undefined)
  })

  it('creates nothing for a value a Y.Map can’t store', () => {
    const { doc, store, cards } = setup()
    const before = stateOf(doc)
    const loose = typedAtom(select.map('cards').child('c1'), z.object({ when: z.any() }), {})
    expect(() => store.set(loose, { when: new Date() })).toThrow(UnsupportedValueError)
    expect(cards.has('c1')).toBe(false)
    expect(stateOf(doc)).toEqual(before)
  })

  it('replaces a plain value stored where the node belongs', () => {
    const { store, cards, cardAtom } = setup()
    cards.set('c1', 'legacy')
    expect(store.get(cardAtom)).toBeUndefined()
    store.set(cardAtom, card)
    expect(store.get(cardAtom)).toEqual({ value: card })
  })

  it('returns an issue and creates nothing when the parent map is missing too', () => {
    const { doc, store } = setup()
    const nested = typedAtom(select.map('boards').child('b1').child('c1'), Card, cardShape)
    const before = stateOf(doc)
    const result = store.set(nested, card)
    expect(result.issues).toEqual([
      { message: 'The node is missing, and so is the Y.Map it would be created in' },
    ])
    expect(stateOf(doc)).toEqual(before)
  })

  it('creates a node in a nested map that exists', () => {
    const { doc, store } = setup()
    doc.getMap('boards').set('b1', new Y.Map())
    const nested = typedAtom(select.map('boards').child('b1').child('c1'), Card, cardShape)
    expect(store.set(nested, card)).toEqual({ value: card })
    expect(store.get(nested)).toEqual({ value: card })
  })
})

describe('reading while unmounted', () => {
  it('sees its own writes', () => {
    const { store, cardAtom } = setup()
    expect(store.get(cardAtom)).toBeUndefined()
    store.set(cardAtom, card)
    expect(store.get(cardAtom)).toEqual({ value: card })
    store.set(cardAtom, { priority: 'high' })
    expect(store.get(cardAtom)).toEqual({ value: { ...card, priority: 'high' } })
  })
})

describe('the doc it writes', () => {
  it('writes the doc in its own doc atom', () => {
    const { store, doc } = setup()
    const other = new Y.Doc()
    const otherDocAtom = atom<Y.Doc | null>(null)
    store.set(otherDocAtom, other)
    const a = typedAtom(select.map('cards').child('c1'), Card, cardShape, {
      docAtom: otherDocAtom,
    })
    store.set(a, card)
    expect(other.getMap('cards').has('c1')).toBe(true)
    expect(doc.getMap('cards').has('c1')).toBe(false)
  })

  it('throws naming docAtom when no doc is set', () => {
    const a = typedAtom(select.map('cards').child('c1'), Card, cardShape)
    expect(() => createStore().set(a, card)).toThrow('docAtom has not been set on this store')
  })
})
