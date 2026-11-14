import * as Y from 'yjs'
import { createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { deepEqual, docAtom, liveAtom, select, shallowEqual } from '../index.js'
import { observerCount, setup, syncDocs, watch } from './helpers.js'

type Item = Y.Map<unknown> | undefined
const itemAtom = (id: string, key: string, options: { keys?: string[] } = {}) =>
  liveAtom({
    locate: (at) => at.map('items').child(id),
    project: (node: Item) => node?.get(key),
    ...options,
  })

describe('nodes that appear and disappear', () => {
  it('tracks an item from before it exists through deletion and re-creation', () => {
    const { store, items, addItem } = setup()
    const exists = liveAtom({
      locate: (at) => at.map('items').child('x'),
      project: (node: Item) => node !== undefined,
    })
    const stop = watch(store, exists)
    expect(store.get(exists)).toBe(false)
    addItem('x')
    expect(store.get(exists)).toBe(true)
    items.delete('x')
    expect(store.get(exists)).toBe(false)
    addItem('x')
    expect(stop.seen).toEqual([true, false, true])
    stop()
  })

  it('follows a property across the item being created later', () => {
    const { store, addItem, setProp } = setup()
    const title = itemAtom('x', 'title')
    const stop = watch(store, title)
    expect(store.get(title)).toBeUndefined()
    addItem('x', { title: 'hello' })
    setProp('x', 'title', 'again')
    expect(stop.seen).toEqual(['hello', 'again'])
    stop()
  })

  it('works over a root array', () => {
    const { store, doc } = setup()
    const length = liveAtom({
      locate: (at) => at.array('list'),
      project: (node: Y.Array<unknown> | undefined) => node?.length ?? 0,
    })
    const stop = watch(store, length)
    doc.getArray('list').push([1, 2])
    expect(stop.seen).toEqual([2])
    stop()
  })
})

describe('selectors', () => {
  it('takes a selector as its spec and removes its observers on unsubscribe', () => {
    const { store, doc, addItem, setProp } = setup()
    const title = liveAtom(select.map('items').child('x').get('title', ''))
    const stop = watch(store, title)
    expect(store.get(title)).toBe('')
    addItem('x', { title: 'hello' })
    setProp('x', 'other', 1)
    setProp('x', 'title', 'again')
    expect(stop.seen).toEqual(['hello', 'again'])
    stop()
    expect(observerCount(doc)).toBe(0)
  })
})

describe('notifications', () => {
  it('ignores other keys when `keys` is set, without re-running project', () => {
    const { store, addItem, setProp } = setup()
    addItem('a', { priority: 'low' })
    const project = vi.fn()
    const probe = liveAtom({
      locate: (at) => at.map('items').child('a'),
      keys: ['priority'],
      project: (node: Item) => (project(), node?.get('priority')),
    })
    const stop = watch(store, probe)
    project.mockClear()
    setProp('a', 'title', 'other key')
    expect(project).not.toHaveBeenCalled()
    setProp('a', 'priority', 'low')
    expect(stop.seen).toEqual([])
    setProp('a', 'priority', 'high')
    expect(stop.seen).toEqual(['high'])
    stop()
  })

  it('keeps the same reference for an equal projection (shallow by default)', () => {
    const { store, addItem, setProp } = setup()
    addItem('a', { tags: ['x', 'y'] })
    const tags = liveAtom({
      locate: (at) => at.map('items').child('a'),
      project: (node: Item) => [...((node?.get('tags') as string[]) ?? [])],
    })
    const stop = watch(store, tags)
    const first = store.get(tags)
    setProp('a', 'tags', ['x', 'y'])
    expect(store.get(tags)).toBe(first)
    expect(stop.seen).toEqual([])
    setProp('a', 'tags', ['x'])
    expect(stop.seen).toEqual([['x']])
    stop()
  })

  it('uses a custom equals', () => {
    const { store, addItem, setProp } = setup()
    addItem('a', { title: 'Hello' })
    const title = liveAtom({
      locate: (at) => at.map('items').child('a'),
      project: (node: Item) => String(node?.get('title') ?? ''),
      equals: (x, y) => x.toLowerCase() === y.toLowerCase(),
    })
    const stop = watch(store, title)
    setProp('a', 'title', 'HELLO')
    expect(stop.seen).toEqual([])
    setProp('a', 'title', 'bye')
    expect(stop.seen).toEqual(['bye'])
    stop()
  })

  it('can ignore transactions by origin', () => {
    const { store, doc, addItem, setProp } = setup()
    addItem('a', { title: 'start' })
    const remoteOnly = liveAtom({
      locate: (at) => at.map('items').child('a'),
      origin: (origin) => origin === 'remote',
      project: (node: Item) => String(node?.get('title') ?? ''),
    })
    const stop = watch(store, remoteOnly)
    setProp('a', 'title', 'local edit')
    expect(stop.seen).toEqual([])
    doc.transact(() => setProp('a', 'title', 'remote edit'), 'remote')
    expect(stop.seen).toEqual(['remote edit'])
    stop()
  })

  it('sees changes arriving from another doc', () => {
    const one = setup()
    const two = setup()
    one.addItem('a', { title: 'one' })
    const title = itemAtom('a', 'title')
    const stop = watch(two.store, title)
    syncDocs(one.doc, two.doc)
    expect(stop.seen).toEqual(['one'])
    stop()
  })
})

describe('deep observation', () => {
  it('counts nested changes only in deep mode', () => {
    const { store, items, addItem } = setup()
    addItem('a')
    items.get('a')!.set('nested', new Y.Map())
    const count = (deep: boolean) =>
      liveAtom({
        locate: (at) => at.map('items').child('a'),
        deep,
        project: (node: Item) => JSON.stringify(node?.toJSON()),
      })
    const shallow = count(false)
    const deepAtom = count(true)
    const stopShallow = watch(store, shallow)
    const stopDeep = watch(store, deepAtom)
    ;(items.get('a')!.get('nested') as Y.Map<unknown>).set('k', 1)
    expect(stopShallow.seen).toEqual([])
    expect(stopDeep.seen).toEqual(['{"nested":{"k":1}}'])
    stopShallow()
    stopDeep()
  })
})

describe('subscriptions', () => {
  it('observes only the located node and removes every observer on unsubscribe', () => {
    const { store, doc, addItem } = setup()
    addItem('a')
    addItem('b')
    expect(observerCount(doc)).toBe(0)
    const stop = watch(store, itemAtom('a', 'title'))
    // the items map (to notice 'a' being replaced) plus item a itself
    expect(observerCount(doc)).toBe(2)
    stop()
    expect(observerCount(doc)).toBe(0)
  })

  it('reads the current doc while unmounted, without observing', () => {
    const { store, doc, addItem } = setup()
    addItem('a', { title: 'x' })
    const title = itemAtom('a', 'title')
    expect(store.get(title)).toBe('x')
    expect(observerCount(doc)).toBe(0)
  })

  it('shares nothing across stores', () => {
    const one = setup()
    const two = setup()
    one.addItem('a', { title: 'one' })
    two.addItem('a', { title: 'two' })
    const title = itemAtom('a', 'title')
    const stop = watch(one.store, title)
    expect(observerCount(two.doc)).toBe(0)
    expect(two.store.get(title)).toBe('two')
    stop()
  })

  it('throws a clear error if the doc was never set', () => {
    expect(() => createStore().get(itemAtom('a', 'title'))).toThrow(/docAtom/)
    expect(docAtom.init).toBeNull()
  })
})

describe('equality helpers', () => {
  it('shallowEqual compares one level, deepEqual all of them', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqual({ a: [1] }, { a: [1] })).toBe(false)
    expect(deepEqual({ a: [1] }, { a: [1] })).toBe(true)
    expect(deepEqual([1, 2], [1, 3])).toBe(false)
  })
})
