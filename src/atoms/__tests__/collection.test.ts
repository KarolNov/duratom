import type { StandardSchemaV1 } from '@standard-schema/spec'
import { atom, createStore } from 'jotai'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import { at, collection, docAtom, select, type CreateResult } from '../../index.js'
import { observerCount, syncDocs, watch } from './helpers.js'

const Todo = z.object({ title: z.string(), done: z.boolean() })
type Todo = z.output<typeof Todo>
const todoShape = { title: 'text' } as const

const milk: Todo = { title: 'Buy milk', done: false }
const bread: Todo = { title: 'Bake bread', done: false }

function setup() {
  const doc = new Y.Doc()
  const store = createStore()
  store.set(docAtom, doc)
  const todos = collection(select.map('todos'), Todo, todoShape)
  return { doc, store, todos, map: doc.getMap<unknown>('todos') }
}

/** The id of a create that must succeed. */
const created = (result: CreateResult<Todo>) => {
  if (result.issues) throw new Error(`create failed: ${result.issues[0]?.message}`)
  return result.id
}

describe('ids', () => {
  it('lists every item, sorted, and [] while the map is empty', () => {
    const { store, todos } = setup()
    expect(store.get(todos.ids)).toEqual([])
    store.set(todos.create, milk, 'b')
    store.set(todos.create, bread, 'a')
    expect(store.get(todos.ids)).toEqual(['a', 'b'])
  })

  it("doesn't notify when an item's field changes; only that item's atom does", () => {
    const { doc, store, todos, map } = setup()
    store.set(todos.create, milk, 'a')
    store.set(todos.create, bread, 'b')
    const ids = watch(store, todos.ids)
    const a = watch(store, todos.item('a'))
    const b = watch(store, todos.item('b'))

    store.set(todos.item('a'), { done: true })
    ;((map.get('a') as Y.Map<unknown>).get('title') as Y.Text).insert(0, 'Go ')
    // A peer's edit to a field counts no more than a local one.
    const peer = new Y.Doc()
    syncDocs(doc, peer)
    peer.getMap<Y.Map<unknown>>('todos').get('a')!.set('done', false)
    syncDocs(peer, doc)

    expect(ids.seen).toEqual([])
    expect(a.seen).toEqual([
      { value: { title: 'Buy milk', done: true } },
      { value: { title: 'Go Buy milk', done: true } },
      { value: { title: 'Go Buy milk', done: false } },
    ])
    expect(b.seen).toEqual([])
    ids()
    a()
    b()
    expect(observerCount(doc)).toBe(0)
  })

  it('notifies when an item is added or removed, by this client or a peer', () => {
    const { doc, store, todos } = setup()
    const ids = watch(store, todos.ids)
    store.set(todos.create, milk, 'a')
    const peer = new Y.Doc()
    syncDocs(doc, peer)
    const peerTodos = collection(select.map('todos'), Todo, todoShape)
    const peerStore = createStore()
    peerStore.set(docAtom, peer)
    peerStore.set(peerTodos.create, bread, 'b')
    syncDocs(peer, doc)
    store.set(todos.remove, 'a')
    expect(ids.seen).toEqual([['a'], ['a', 'b'], ['b']])
    ids()
  })

  it("doesn't notify when an item is replaced under the same id", () => {
    const { store, todos, map } = setup()
    store.set(todos.create, milk, 'a')
    const ids = watch(store, todos.ids)
    const replaced = new Y.Map<unknown>()
    map.set('a', replaced)
    expect(ids.seen).toEqual([])
    ids()
  })
})

describe('create', () => {
  it('adds a valid value under the given id and returns it with the id', () => {
    const { store, todos, map } = setup()
    expect(store.set(todos.create, milk, 'a')).toEqual({ value: milk, id: 'a' })
    expect((map.get('a') as Y.Map<unknown>).toJSON()).toEqual(milk)
    expect(store.get(todos.item('a'))).toEqual({ value: milk })
  })

  it('generates an id when none is given', () => {
    const { store, todos } = setup()
    const id = created(store.set(todos.create, milk))
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.get(todos.ids)).toEqual([id])
    expect(created(store.set(todos.create, bread))).not.toBe(id)
  })

  it('adds nothing for an invalid value and returns its issues', () => {
    const { doc, store, todos } = setup()
    const ids = watch(store, todos.ids)
    const before = Y.encodeStateAsUpdate(doc)
    const result = store.set(todos.create, { title: 'No done' } as Todo, 'a')
    expect(result.issues?.[0]?.path).toEqual(['done'])
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(store.get(todos.ids)).toEqual([])
    expect(ids.seen).toEqual([])
    ids()
  })

  it("doesn't replace an item already under the id", () => {
    const { doc, store, todos } = setup()
    store.set(todos.create, milk, 'a')
    const before = Y.encodeStateAsUpdate(doc)
    const result = store.set(todos.create, bread, 'a')
    expect(result.issues?.[0]?.message).toMatch(/"a" already exists/)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(store.get(todos.item('a'))).toEqual({ value: milk })
  })

  it('returns issues and creates nothing while a nested collection map is missing', () => {
    const doc = new Y.Doc()
    const store = createStore()
    store.set(docAtom, doc)
    const cards = collection(select.map('boards').child('b1').child('cards'), Todo, todoShape)
    expect(store.get(cards.ids)).toEqual([])
    const result = store.set(cards.create, milk, 'a')
    expect(result.issues?.[0]?.message).toMatch(/collection's Y.Map is missing/)
    expect(doc.getMap('boards').size).toBe(0)
  })
})

describe('item', () => {
  it('returns the same atom for the same id', () => {
    const { todos } = setup()
    expect(todos.item('a')).toBe(todos.item('a'))
    expect(todos.item('a')).not.toBe(todos.item('b'))
  })

  it('merges a patch, keeping a peer edit to another field', () => {
    const { doc, store, todos } = setup()
    store.set(todos.create, milk, 'a')
    const peer = new Y.Doc()
    syncDocs(doc, peer)
    const title = peer.getMap<Y.Map<unknown>>('todos').get('a')!.get('title') as Y.Text
    title.insert(title.length, ' and eggs')
    syncDocs(peer, doc)
    expect(store.set(todos.item('a'), { done: true })).toEqual({
      value: { title: 'Buy milk and eggs', done: true },
    })
  })

  it('reads an entry a peer stored as another shared type as issues, and lists it in ids', () => {
    const { store, todos, map } = setup()
    map.set('broken', new Y.Array())
    expect(store.get(todos.ids)).toEqual(['broken'])
    expect(store.get(todos.item('broken'))?.issues).toHaveLength(1)
  })
})

describe('remove', () => {
  it('deletes the item and reports whether there was one', () => {
    const { store, todos, map } = setup()
    store.set(todos.create, milk, 'a')
    expect(store.set(todos.remove, 'a')).toBe(true)
    expect(map.has('a')).toBe(false)
    expect(store.set(todos.remove, 'a')).toBe(false)
    expect(store.get(todos.item('a'))).toBeUndefined()
  })

  it('refreshes unmounted reads of ids and the item', () => {
    const { store, todos } = setup()
    store.set(todos.create, milk, 'a')
    expect(store.get(todos.ids)).toEqual(['a'])
    expect(store.get(todos.item('a'))).toEqual({ value: milk })
    store.set(todos.remove, 'a')
    expect(store.get(todos.ids)).toEqual([])
    expect(store.get(todos.item('a'))).toBeUndefined()
  })

  it("doesn't add an item atom for an id it was never asked for", () => {
    const { store, todos, map } = setup()
    map.set('a', new Y.Map())
    store.set(todos.remove, 'a')
    expect([...todos.item.getParams()]).toEqual([])
  })
})

describe('options', () => {
  it('takes a Locator as well as a select path', () => {
    const { store } = setup()
    const byLocator = collection(at.map('todos'), Todo, todoShape)
    store.set(byLocator.create, milk, 'a')
    expect(store.get(byLocator.ids)).toEqual(['a'])
  })

  it('reads and writes the doc in its own doc atom', () => {
    const { doc: defaultDoc, store } = setup()
    const other = new Y.Doc()
    const otherDocAtom = atom<Y.Doc | null>(other)
    const todos = collection(select.map('todos'), Todo, todoShape, { docAtom: otherDocAtom })
    store.set(todos.create, milk, 'a')
    expect(other.getMap('todos').has('a')).toBe(true)
    expect(defaultDoc.getMap('todos').has('a')).toBe(false)
    expect(store.get(todos.item('a'))).toEqual({ value: milk })
  })

  it('types its atoms from the schema', () => {
    const { store, todos } = setup()
    expectTypeOf(store.get(todos.ids)).toEqualTypeOf<string[]>()
    expectTypeOf(store.get(todos.item('a'))).toEqualTypeOf<
      StandardSchemaV1.Result<Todo> | undefined
    >()
    expectTypeOf(store.set(todos.create, milk)).toEqualTypeOf<CreateResult<Todo>>()
    expectTypeOf(store.set(todos.remove, 'a')).toEqualTypeOf<boolean>()
    // @ts-expect-error not a Todo
    store.set(todos.create, { title: 1 })
    // @ts-expect-error not a field of Todo
    collection(select.map('todos'), Todo, { name: 'text' })
  })
})
