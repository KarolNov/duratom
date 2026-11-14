import type { StandardSchemaV1 } from '@standard-schema/spec'
import { live, select, type Selector } from '../../core/index.js'
import * as Y from 'yjs'
import { z } from 'zod'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { map, read, reader, record } from '../index.js'

const Card = z.object({ title: z.string(), done: z.boolean() })
const cardShape = { title: 'text' } as const

function setup() {
  const doc = new Y.Doc()
  const cards = doc.getMap<Y.Map<unknown>>('cards')
  const addCard = (id: string, title: string, done: unknown = false) =>
    doc.transact(() => {
      const card = new Y.Map<unknown>()
      cards.set(id, card)
      card.set('title', new Y.Text(title))
      card.set('done', done)
    })
  const card = (id: string) => cards.get(id)!
  return { doc, cards, addCard, card }
}

describe('reader', () => {
  it('projects as read does, observes deeply and compares results deeply', () => {
    const { addCard, card } = setup()
    addCard('a', 'one')
    const r = reader(Card, cardShape)
    expect(r.project(card('a'))).toEqual(read(Card, cardShape, card('a')))
    expect(r.project(undefined)).toBeUndefined()
    expect(r.deep).toBe(true)
    expect(r.equals(r.project(card('a')), r.project(card('a')))).toBe(true)
    expect(r.equals({ issues: [{ message: 'a' }] }, { issues: [{ message: 'b' }] })).toBe(false)
  })
})

describe('as a selector projection', () => {
  it('follows a card from missing, through edits to its text, to invalid', () => {
    const { doc, addCard, card } = setup()
    const source = live(doc, select.map('cards').child('a').project(reader(Card, cardShape)))
    const seen: unknown[] = []
    const stop = source.subscribe(() => seen.push(source.get()))
    expect(source.get()).toBeUndefined()
    addCard('a', 'one')
    ;(card('a').get('title') as Y.Text).insert(3, '!')
    card('a').set('done', 'not a boolean')
    expect(seen.slice(0, 2)).toEqual([
      { value: { title: 'one', done: false } },
      { value: { title: 'one!', done: false } },
    ])
    expect((seen[2] as StandardSchemaV1.FailureResult).issues[0]?.path).toEqual(['done'])
    stop()
  })

  it('reports a card a peer stored as another shared type, rather than reading it as missing', () => {
    const { doc, cards } = setup()
    cards.set('a', new Y.Text('not a card') as never)
    const source = live(doc, select.map('cards').child('a').project(reader(Card, cardShape)))
    expect(source.get()).toEqual({
      issues: [{ message: 'Shape mismatch: expected a Y.Map, found a Y.Text', path: [] }],
    })
  })

  it('keeps the reference and does not notify when a change reads the same', () => {
    const { doc, addCard, card } = setup()
    addCard('a', 'one')
    const source = live(doc, select.map('cards').child('a').project(reader(Card, cardShape)))
    let notified = 0
    const stop = source.subscribe(() => notified++)
    const before = source.get()
    card('a').set('done', false)
    expect(notified).toBe(0)
    expect(source.get()).toBe(before)
    stop()
  })

  it('does not re-read for edits inside an xml field, nested or not, but does when it is replaced', () => {
    const doc = new Y.Doc()
    const Note = z.object({ body: z.instanceof(Y.XmlFragment), title: z.string() })
    const Page = z.object({
      body: z.instanceof(Y.XmlFragment),
      meta: z.object({ body: z.instanceof(Y.XmlFragment) }),
      notes: z.record(z.string(), Note),
    })
    const pageShape = {
      body: 'xml',
      meta: map({ body: 'xml' }),
      notes: record({ body: 'xml', title: 'text' }),
    } as const
    const page = doc.getMap<Y.Map<unknown>>('pages').set('p', new Y.Map())
    const body = page.set('body', new Y.XmlFragment())
    const metaBody = page.set('meta', new Y.Map()).set('body', new Y.XmlFragment())
    const note = page.set('notes', new Y.Map()).set('n', new Y.Map<unknown>())
    const noteBody = note.set('body', new Y.XmlFragment())
    const noteTitle = note.set('title', new Y.Text('t'))
    const r = reader(Page, pageShape)
    const project = vi.fn(r.project)
    const source = live(doc, { ...select.map('pages').child('p').project(r), project })
    const stop = source.subscribe(() => {})
    expect(source.get()).toHaveProperty('value')
    project.mockClear()
    body.insert(0, [new Y.XmlText('a')])
    metaBody.insert(0, [new Y.XmlText('b')])
    noteBody.insert(0, [new Y.XmlText('c')])
    expect(project).not.toHaveBeenCalled()
    noteTitle.insert(1, '!')
    expect(project).toHaveBeenCalledTimes(1)
    page.set('body', new Y.XmlFragment())
    expect(project).toHaveBeenCalledTimes(2)
    stop()
  })

  it('types the selector from the schema', () => {
    expectTypeOf(select.map('cards').child('a').project(reader(Card, cardShape))).toEqualTypeOf<
      Selector<StandardSchemaV1.Result<{ title: string; done: boolean }> | undefined>
    >()
  })
})
