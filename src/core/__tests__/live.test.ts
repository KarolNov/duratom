import * as Y from 'yjs'
import { describe, expect, it, vi } from 'vitest'
import { deepEqual, live } from '../index.js'
import { observerCount, setup } from './helpers.js'

type Item = Y.Map<unknown> | undefined

const titleOf = (doc: Y.Doc, id: string, options: { keys?: string[] } = {}) =>
  live(doc, {
    locate: (at) => at.map('items').child(id),
    project: (node: Item) => node?.get('title'),
    ...options,
  })

describe('live', () => {
  it('follows a node from before it exists through deletion', () => {
    const { doc, items, addItem, setProp } = setup()
    const title = titleOf(doc, 'x')
    const seen: unknown[] = []
    const stop = title.subscribe(() => seen.push(title.get()))
    expect(title.get()).toBeUndefined()
    addItem('x', { title: 'hello' })
    setProp('x', 'title', 'again')
    items.delete('x')
    expect(seen).toEqual(['hello', 'again', undefined])
    stop()
  })

  it('notifies only when the projection changes, keeping the old reference', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { labels: ['x'], other: 1 })
    const labels = live(doc, {
      locate: (at) => at.map('items').child('a'),
      project: (node: Item) => ({ labels: node?.get('labels') as string[] }),
      equals: deepEqual,
    })
    const listener = vi.fn()
    const stop = labels.subscribe(listener)
    const before = labels.get()
    setProp('a', 'labels', ['x'])
    setProp('a', 'other', 2)
    expect(listener).not.toHaveBeenCalled()
    expect(labels.get()).toBe(before)
    setProp('a', 'labels', ['y'])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(labels.get()).toEqual({ labels: ['y'] })
    stop()
  })

  it('passes the new and the previous projection to listeners, including late ones', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 'one' })
    const title = titleOf(doc, 'a')
    const early: [unknown, unknown][] = []
    const late: [unknown, unknown][] = []
    const stopEarly = title.subscribe((value, prev) => early.push([value, prev]))
    setProp('a', 'title', 'two')
    const stopLate = title.subscribe((value, prev) => late.push([value, prev]))
    setProp('a', 'title', 'three')
    expect(early).toEqual([
      ['two', 'one'],
      ['three', 'two'],
    ])
    expect(late).toEqual([['three', 'two']])
    stopEarly()
    stopLate()
  })

  it('resolves the located node as it is now', () => {
    const { doc, items, addItem } = setup()
    const title = titleOf(doc, 'a')
    expect(title.resolve()).toBeUndefined()
    addItem('a', { title: 'one' })
    expect(title.resolve()).toBe(items.get('a'))
  })

  it('writes to the located node in one transaction with its origin', () => {
    const { doc, addItem } = setup()
    addItem('a', { title: 'one' })
    const title = titleOf(doc, 'a')
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr) => origins.push(tr.origin))
    const result = title.write((node: Y.Map<unknown> | undefined) => {
      node!.set('title', 'two')
      return node
    }, 'form')
    expect(result).toBe(doc.getMap('items').get('a'))
    expect(origins).toEqual(['form'])
    expect(title.get()).toBe('two')
  })

  it('returns a stable reference from get while unsubscribed', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const item = live(doc, {
      locate: (at) => at.map('items').child('a'),
      project: (node: Item) => ({ title: node?.get('title') }),
    })
    const first = item.get()
    expect(item.get()).toBe(first)
    setProp('a', 'title', 'u')
    expect(item.get()).toEqual({ title: 'u' })
  })

  it('catches up with changes made between get and subscribe', () => {
    const { doc, addItem } = setup()
    const title = titleOf(doc, 'x')
    expect(title.get()).toBeUndefined()
    addItem('x', { title: 'late' })
    const stop = title.subscribe(() => {})
    expect(title.get()).toBe('late')
    stop()
  })

  it('catches up and observes again when re-subscribed after the last subscriber left', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const title = titleOf(doc, 'a')
    title.subscribe(() => {})()
    setProp('a', 'title', 'while away')
    const listener = vi.fn()
    const stop = title.subscribe(listener)
    expect(title.get()).toBe('while away')
    setProp('a', 'title', 'back')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(title.get()).toBe('back')
    stop()
  })

  it('does not call a listener unsubscribed earlier in the same notification', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const title = titleOf(doc, 'a')
    const second = vi.fn()
    let stopSecond = () => {}
    const stopFirst = title.subscribe(() => stopSecond())
    stopSecond = title.subscribe(second)
    setProp('a', 'title', 'u')
    expect(second).not.toHaveBeenCalled()
    stopFirst()
  })

  it('leaves nothing subscribed when the first subscribe throws', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const baseline = observerCount(doc)
    let fail = true
    const title = live(doc, {
      locate: (at) => at.map('items').child('a'),
      project: (node: Item) => {
        if (fail) throw new Error('bad data')
        return node?.get('title')
      },
    })
    expect(() => title.subscribe(() => {})).toThrow('bad data')
    expect(observerCount(doc)).toBe(baseline)
    fail = false
    const stop = title.subscribe(() => {})
    setProp('a', 'title', 'u')
    stop()
    expect(observerCount(doc)).toBe(baseline)
  })

  it('observes only while subscribed and shares one observation between subscribers', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const baseline = observerCount(doc)
    const title = titleOf(doc, 'a', { keys: ['title'] })
    expect(observerCount(doc)).toBe(baseline)
    const a = vi.fn()
    const b = vi.fn()
    const stopA = title.subscribe(a)
    const watching = observerCount(doc)
    expect(watching).toBeGreaterThan(baseline)
    const stopB = title.subscribe(b)
    expect(observerCount(doc)).toBe(watching)
    setProp('a', 'title', 'u')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    stopA()
    stopA()
    expect(observerCount(doc)).toBe(watching)
    stopB()
    expect(observerCount(doc)).toBe(baseline)
  })

  it('counts the same listener subscribed twice as two subscriptions', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const baseline = observerCount(doc)
    const title = titleOf(doc, 'a')
    const listener = vi.fn()
    const stop1 = title.subscribe(listener)
    const stop2 = title.subscribe(listener)
    setProp('a', 'title', 'u')
    expect(listener).toHaveBeenCalledTimes(2)
    stop1()
    expect(observerCount(doc)).toBeGreaterThan(baseline)
    stop2()
    expect(observerCount(doc)).toBe(baseline)
  })

  it('skips transactions the origin filter rejects', () => {
    const { doc, addItem, setProp } = setup()
    addItem('a', { title: 't' })
    const title = live(doc, {
      locate: (at) => at.map('items').child('a'),
      project: (node: Item) => node?.get('title'),
      origin: (origin) => origin !== 'local',
    })
    const listener = vi.fn()
    const stop = title.subscribe(listener)
    doc.transact(() => setProp('a', 'title', 'mine'), 'local')
    expect(listener).not.toHaveBeenCalled()
    expect(title.get()).toBe('t')
    setProp('a', 'title', 'theirs')
    expect(title.get()).toBe('theirs')
    stop()
  })

  it('skips changes the event filter rejects, with paths relative to the node', () => {
    const { doc, addItem, items } = setup()
    const notes = new Y.Map<unknown>()
    addItem('a', { notes, title: 't' })
    const project = vi.fn((node: Item) => node?.toJSON())
    const paths: unknown[] = []
    const item = live(doc, {
      locate: (at) => at.map('items').child('a'),
      project,
      deep: true,
      equals: deepEqual,
      event: (event) => {
        paths.push(event.path)
        return event.path[0] !== 'notes'
      },
    })
    const stop = item.subscribe(() => {})
    project.mockClear()
    notes.set('x', 1)
    expect(project).not.toHaveBeenCalled()
    items.get('a')!.set('title', 'u')
    expect(project).toHaveBeenCalledTimes(1)
    expect(paths).toEqual([['notes'], []])
    stop()
  })
})
