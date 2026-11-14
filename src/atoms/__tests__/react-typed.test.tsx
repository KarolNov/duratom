// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { atom, createStore, Provider } from 'jotai'
import { afterEach, expect, expectTypeOf, it } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { docAtom, select } from '../index.js'
import { useTypedAtom } from '../../react/index.js'
import { observerCount } from './helpers.js'

afterEach(cleanup)

const Card = z.object({ title: z.string(), priority: z.enum(['low', 'high']) })
const shape = { title: 'text' } as const

function setup() {
  const doc = new Y.Doc()
  const store = createStore()
  store.set(docAtom, doc)
  return { doc, store, cards: doc.getMap<unknown>('cards') }
}

it.each([
  ['a locator', (id: string) => select.map('cards').child(id)],
  ['a function that builds one', (id: string) => () => select.map('cards').child(id)],
] as const)('takes %s, reads and writes, and rebuilds when deps change', (_, locate) => {
  const { doc, store } = setup()
  let set!: ReturnType<typeof useTypedAtom<typeof Card, typeof shape>>[1]
  function View({ id }: { id: string }) {
    const [card, setCard] = useTypedAtom(locate(id), Card, shape, [id])
    expectTypeOf(card).toEqualTypeOf<StandardSchemaV1.Result<z.output<typeof Card>> | undefined>()
    set = setCard
    return (
      <span data-testid="t">{!card ? 'none' : card.issues ? 'invalid' : card.value.title}</span>
    )
  }
  const view = render(
    <Provider store={store}>
      <View id="a" />
    </Provider>,
  )
  expect(view.getByTestId('t').textContent).toBe('none')
  act(() => {
    expect(set({ title: 'one', priority: 'low' })).toEqual({
      value: { title: 'one', priority: 'low' },
    })
  })
  expect(view.getByTestId('t').textContent).toBe('one')
  act(() => {
    expect(set((prev) => ({ title: `${prev?.title}!` })).issues).toBeUndefined()
  })
  expect(view.getByTestId('t').textContent).toBe('one!')
  act(() => {
    expect(set({ priority: 'urgent' as 'low' }).issues).toBeDefined()
  })
  expect(view.getByTestId('t').textContent).toBe('one!')
  view.rerender(
    <Provider store={store}>
      <View id="b" />
    </Provider>,
  )
  expect(view.getByTestId('t').textContent).toBe('none')
  act(() => void set({ title: 'bee', priority: 'high' }))
  expect(view.getByTestId('t').textContent).toBe('bee')
  view.unmount()
  expect(observerCount(doc)).toBe(0)
})

it('follows a peer edit to the doc in its own doc atom', () => {
  const store = createStore()
  const doc = new Y.Doc()
  const otherDocAtom = atom<Y.Doc | null>(null)
  store.set(otherDocAtom, doc)
  function View() {
    const [card] = useTypedAtom(select.map('cards').child('a'), Card, shape, [], {
      docAtom: otherDocAtom,
    })
    return <span data-testid="t">{card && !card.issues ? card.value.priority : 'none'}</span>
  }
  const view = render(
    <Provider store={store}>
      <View />
    </Provider>,
  )
  expect(view.getByTestId('t').textContent).toBe('none')
  const node = new Y.Map<unknown>()
  act(() =>
    doc.transact(() => {
      doc.getMap('cards').set('a', node)
      node.set('title', new Y.Text('x'))
      node.set('priority', 'low')
    }),
  )
  expect(view.getByTestId('t').textContent).toBe('low')
  act(() => node.set('priority', 'high'))
  expect(view.getByTestId('t').textContent).toBe('high')
})
