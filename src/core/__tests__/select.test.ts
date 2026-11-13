import * as Y from 'yjs'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { live, select, type Selector } from '../index.js'

function setup() {
  const doc = new Y.Doc()
  const cards = doc.getMap<Y.Map<unknown>>('cards')
  const addCard = (id: string, props: Record<string, unknown> = {}) =>
    doc.transact(() => {
      const card = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(props)) card.set(k, v)
      cards.set(id, card)
    })
  const card = (id: string) => cards.get(id)!
  return { doc, cards, addCard, card }
}

/** Subscribes to a selector and records each value it notifies with. */
function watch<T>(doc: Y.Doc, selector: Selector<T>) {
  const source = live(doc, selector)
  const seen: T[] = []
  const stop = source.subscribe(() => seen.push(source.get()))
  return { source, seen, stop }
}

describe('get', () => {
  it('reads the fallback for a missing map, a missing key and a value of the wrong type', () => {
    const { doc, addCard, card } = setup()
    const title = watch(doc, select.map('cards').child('a').get('title', ''))
    expect(title.source.get()).toBe('')
    addCard('a')
    card('a').set('title', 'hello')
    card('a').set('title', 42)
    card('a').set('title', new Y.Text('shared'))
    expect(title.seen).toEqual(['hello', ''])
    title.stop()
  })

  it('tells null, arrays and objects apart from one another', () => {
    const { doc, addCard } = setup()
    addCard('a', {
      labels: { not: 'an array' },
      meta: ['not', 'an object'],
      gone: null,
    })
    const a = select.map('cards').child('a')
    expect(live(doc, a.get('labels', [] as string[])).get()).toEqual([])
    expect(live(doc, a.get('meta', {})).get()).toEqual({})
    expect(live(doc, a.get('gone', {})).get()).toEqual({})
    expect(live(doc, a.get('gone', null)).get()).toBeNull()
  })

  it('reads the stored value as it is without a fallback', () => {
    const { doc, addCard } = setup()
    const done = select.map('cards').child('a').get('done')
    expect(live(doc, done).get()).toBeUndefined()
    addCard('a', { done: 'yes' })
    expect(live(doc, done).get()).toBe('yes')
  })

  it('reads an undefined fallback as no fallback', () => {
    const { doc, addCard } = setup()
    addCard('a', { title: 'hello' })
    const fallback: string | undefined = undefined
    expect(live(doc, select.map('cards').child('a').get('title', fallback)).get()).toBe('hello')
  })

  it('reads a bytes fallback as a copy, so one reader cannot change the next one', () => {
    const { doc } = setup()
    const meta = select.map('cards').child('a').get('meta', new Uint8Array(1))
    live(doc, meta).get()[0] = 1
    expect(live(doc, meta).get()).toEqual(new Uint8Array(1))
  })

  it('tells bytes and other objects apart from plain objects', () => {
    const { doc, addCard } = setup()
    const bytes = new Uint8Array([1])
    addCard('a', { meta: bytes })
    const a = select.map('cards').child('a')
    expect(live(doc, a.get('meta', {})).get()).toEqual({})
    expect(live(doc, a.get('meta', new Uint8Array())).get()).toBe(bytes)
  })

  it('reads a frozen fallback, so one reader cannot change the next one', () => {
    const { doc } = setup()
    const tags = live(
      doc,
      select
        .map('cards')
        .child('a')
        .get('tags', [] as string[]),
    ).get()
    expect(() => tags.push('x')).toThrow(TypeError)
    const fields = live(
      doc,
      select
        .map('cards')
        .child('a')
        .pick({ meta: { n: 1 } }),
    ).get()
    expect(() => (fields.meta.n = 2)).toThrow(TypeError)
  })

  it('notifies only for its key', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { title: 'one' })
    const title = watch(doc, select.map('cards').child('a').get('title', ''))
    card('a').set('other', 1)
    card('a').set('title', 'two')
    expect(title.seen).toEqual(['two'])
    title.stop()
  })
})

describe('pick', () => {
  it('reads each key with its default and keeps the reference while they are unchanged', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { title: 'one', done: 'not a boolean' })
    const fields = watch(doc, select.map('cards').child('a').pick({ title: '', done: false }))
    const before = fields.source.get()
    expect(before).toEqual({ title: 'one', done: false })
    card('a').set('other', 1)
    card('a').set('title', 'one')
    expect(fields.source.get()).toBe(before)
    card('a').set('done', true)
    expect(fields.seen).toEqual([{ title: 'one', done: true }])
    fields.stop()
  })
})

describe('text', () => {
  it('follows edits to a Y.Text and reads a missing or plain field as an empty string', () => {
    const { doc, addCard, card } = setup()
    const body = watch(doc, select.map('cards').child('a').text('body'))
    addCard('a', { body: 'plain' })
    expect(body.source.get()).toBe('')
    const text = new Y.Text('hi')
    card('a').set('body', text)
    text.insert(2, ' there')
    card('a').delete('body')
    expect(body.seen).toEqual(['hi', 'hi there', ''])
    body.stop()
  })

  it('reads a Y.XmlText as an empty string rather than its markup', () => {
    const { doc, addCard } = setup()
    const xml = new Y.XmlText()
    addCard('a', { body: xml })
    xml.insert(0, 'hi', { bold: true })
    expect(live(doc, select.map('cards').child('a').text('body')).get()).toBe('')
  })
})

describe('nodes of another kind', () => {
  it('read as missing instead of throwing', () => {
    const { doc, addCard } = setup()
    addCard('a', { tags: new Y.Text('x'), list: Y.Array.from([1]) })
    const a = select.map('cards').child('a')
    expect(live(doc, a.child('tags', 'array').toArray()).get()).toEqual([])
    expect(live(doc, a.child('tags', 'array').length()).get()).toBe(0)
    expect(live(doc, a.child('list').keys()).get()).toEqual([])
    expect(live(doc, a.child('list').toJSON()).get()).toEqual({})
    expect(
      live(
        doc,
        a.child('list').project((node) => node),
      ).get(),
    ).toBeUndefined()
  })

  it('reach a packaged projection as stored, so it can report them', () => {
    const { doc, addCard } = setup()
    const list = Y.Array.from([1])
    addCard('a', { list })
    const kind = { project: (node: Y.AbstractType<any> | undefined) => node }
    expect(live(doc, select.map('cards').child('a').child('list').project(kind)).get()).toBe(list)
  })

  it('read a Y.XmlHook as missing where a Y.Map belongs, also on the way to a child', () => {
    const { doc, addCard } = setup()
    const hook = new Y.XmlHook('h')
    addCard('a', { hook })
    hook.set('x', 1)
    hook.set('body', new Y.Text('hi'))
    hook.set('inner', new Y.Map())
    const path = select.map('cards').child('a').child('hook')
    expect(live(doc, path.toJSON()).get()).toEqual({})
    expect(live(doc, path.text('body')).get()).toBe('')
    expect(live(doc, path.child('inner').toJSON()).get()).toEqual({})
  })
})

describe('keys', () => {
  it('lists keys sorted and notifies only when they change', () => {
    const { doc, addCard, card } = setup()
    const ids = watch(doc, select.map('cards').keys())
    addCard('b')
    addCard('a', { title: 'x' })
    card('a').set('title', 'y')
    addCard('a')
    expect(ids.seen).toEqual([['b'], ['a', 'b']])
    ids.stop()
  })

  it('does not re-read when a value is replaced under an existing key', () => {
    const { doc, addCard, cards } = setup()
    addCard('a')
    const spec = select.map('cards').keys()
    const project = vi.fn(spec.project)
    const ids = watch(doc, { ...spec, project })
    project.mockClear()
    addCard('a', { title: 'replaced' })
    expect(project).not.toHaveBeenCalled()
    doc.transact(() => {
      cards.delete('a')
      addCard('b')
    })
    expect(ids.seen).toEqual([['b']])
    ids.stop()
  })
})

describe('toJSON', () => {
  it('reads a missing map as {} and counts nested changes, keeping the reference when equal', () => {
    const { doc, addCard, card } = setup()
    const a = watch(doc, select.map('cards').child('a').toJSON())
    expect(a.source.get()).toEqual({})
    const tags = new Y.Array<string>()
    addCard('a', { tags })
    tags.push(['x'])
    const before = a.source.get()
    card('a').set('tags', Y.Array.from(['x']))
    expect(a.source.get()).toBe(before)
    expect(a.seen).toEqual([{ tags: [] }, { tags: ['x'] }])
    a.stop()
  })
})

describe('arrays', () => {
  it('reads a nested Y.Array as items, length and JSON, empty while missing', () => {
    const { doc, addCard, card } = setup()
    const tags = select.map('cards').child('a').child<string>('tags', 'array')
    const items = watch(doc, tags.toArray())
    const length = watch(doc, tags.length())
    expect(live(doc, tags.toJSON()).get()).toEqual([])
    addCard('a', { tags: Y.Array.from(['x']) })
    ;(card('a').get('tags') as Y.Array<string>).push(['y'])
    expect(items.seen).toEqual([['x'], ['x', 'y']])
    expect(length.seen).toEqual([1, 2])
    items.stop()
    length.stop()
  })

  it('reads a root array', () => {
    const { doc } = setup()
    const list = doc.getArray<number>('list')
    list.push([1, 2])
    expect(live(doc, select.array<number>('list').toArray()).get()).toEqual([1, 2])
  })
})

describe('project', () => {
  it('runs a custom projection deeply, compared with deepEqual', () => {
    const { doc, addCard, card } = setup()
    const nested = new Y.Map<unknown>()
    addCard('a', { nested })
    const project = vi.fn((node: Y.Map<unknown> | undefined) => ({
      size: (node?.get('nested') as Y.Map<unknown> | undefined)?.size ?? 0,
    }))
    const size = watch(doc, select.map('cards').child('a').project(project))
    const before = size.source.get()
    nested.set('x', 1)
    nested.set('x', 2)
    expect(project).toHaveBeenCalledTimes(3)
    expect(size.seen).toEqual([{ size: 1 }])
    card('a').set('other', 1)
    expect(size.source.get()).toEqual({ size: 1 })
    expect(before).toEqual({ size: 0 })
    size.stop()
  })

  it('tells apart projections that are Sets, Maps or Dates', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { x: 1 })
    const keys = watch(
      doc,
      select
        .map('cards')
        .child('a')
        .project((node) => new Set(node?.keys())),
    )
    card('a').set('y', 2)
    expect(keys.seen.map((s) => [...s])).toEqual([['x', 'y']])
    keys.stop()
  })

  it('observes only `keys` when given keys without `deep`', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { title: 'one' })
    const project = vi.fn((node: Y.Map<unknown> | undefined) => node?.get('title'))
    const title = watch(
      doc,
      select
        .map('cards')
        .child('a')
        .project(project, { keys: ['title'] }),
    )
    project.mockClear()
    card('a').set('other', 1)
    expect(project).not.toHaveBeenCalled()
    card('a').set('title', 'two')
    expect(title.seen).toEqual(['two'])
    title.stop()
  })

  it('takes observe options and equality', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { title: 'one' })
    const project = vi.fn((node: Y.Map<unknown> | undefined) => node?.get('title'))
    const title = watch(
      doc,
      select
        .map('cards')
        .child('a')
        .project(project, { deep: false, keys: ['title'] }),
    )
    project.mockClear()
    card('a').set('other', 1)
    expect(project).not.toHaveBeenCalled()
    title.stop()
  })

  it('takes a packaged projection with its own options and equality', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { title: 'one' })
    const equals = vi.fn((a: string, b: string) => a.toLowerCase() === b.toLowerCase())
    const projection = {
      project: (node: Y.AbstractType<any> | undefined) =>
        node instanceof Y.Map ? String(node.get('title') ?? '') : '',
      keys: ['title'],
      deep: false,
      equals,
    }
    const title = watch(doc, select.map('cards').child('a').project(projection))
    card('a').set('other', 1)
    expect(equals).not.toHaveBeenCalled()
    card('a').set('title', 'ONE')
    card('a').set('title', 'two')
    expect(title.seen).toEqual(['two'])
    title.stop()
  })
})

describe('as a LiveSpec', () => {
  it('can be spread to add an origin filter', () => {
    const { doc, addCard, card } = setup()
    addCard('a', { title: 'one' })
    const title = watch(doc, {
      ...select.map('cards').child('a').get('title', ''),
      origin: (o: unknown) => o !== 'ignored',
    })
    doc.transact(() => card('a').set('title', 'skipped'), 'ignored')
    card('a').set('title', 'two')
    expect(title.seen).toEqual(['two'])
    title.stop()
  })

  it('infers types from fallbacks and typed paths', () => {
    const board = select.map<Y.Map<string>>('cards')
    expectTypeOf(board.child('a').get('title')).toEqualTypeOf<Selector<string | undefined>>()
    expectTypeOf(board.child('a').get('title', '')).toEqualTypeOf<Selector<string>>()
    expectTypeOf(select.map('cards').child('a').pick({ title: '', done: false })).toEqualTypeOf<
      Selector<{ title: string; done: boolean }>
    >()
    expectTypeOf(select.map('cards').child('a').text('body')).toEqualTypeOf<Selector<string>>()
    expectTypeOf(
      select
        .map('cards')
        .child('a')
        .get('status', 'open' as 'open' | 'done'),
    ).toEqualTypeOf<Selector<string>>()
  })
})
