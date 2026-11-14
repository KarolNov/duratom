// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { Provider } from 'jotai'
import { afterEach, expect, it } from 'vitest'
import * as Y from 'yjs'
import { select } from '../index.js'
import { useLiveAtom } from '../../react/index.js'
import { observerCount, setup } from './helpers.js'

afterEach(cleanup)

it('re-renders only when the projection changes and unsubscribes on unmount', () => {
  const { store, doc, addItem, setProp } = setup()
  addItem('a', { title: 'one', other: 1 })
  let renders = 0
  function Title({ id }: { id: string }) {
    renders++
    const title = useLiveAtom(
      (at) => at.map('items').child(id),
      (node: Y.Map<unknown> | undefined) => String(node?.get('title') ?? ''),
      { keys: ['title'] },
      [id],
    )
    return <span data-testid="t">{title}</span>
  }
  const view = render(
    <Provider store={store}>
      <Title id="a" />
    </Provider>,
  )
  expect(view.getByTestId('t').textContent).toBe('one')
  const base = renders
  act(() => setProp('a', 'other', 2))
  expect(renders).toBe(base)
  act(() => setProp('a', 'title', 'two'))
  expect(view.getByTestId('t').textContent).toBe('two')
  expect(renders).toBe(base + 1)
  view.unmount()
  expect(observerCount(doc)).toBe(0)
})

it.each([
  ['a selector', (id: string) => select.map('items').child(id).get('title', '')],
  [
    'a function that builds one',
    (id: string) => () => select.map('items').child(id).get('title', ''),
  ],
] as const)('takes %s and rebuilds it when deps change', (_, spec) => {
  const { store, addItem, setProp } = setup()
  addItem('a', { title: 'one' })
  addItem('b', { title: 'bee' })
  function Title({ id }: { id: string }) {
    const title = useLiveAtom(spec(id), [id])
    return <span data-testid="t">{title}</span>
  }
  const view = render(
    <Provider store={store}>
      <Title id="a" />
    </Provider>,
  )
  expect(view.getByTestId('t').textContent).toBe('one')
  act(() => setProp('a', 'title', 'two'))
  expect(view.getByTestId('t').textContent).toBe('two')
  view.rerender(
    <Provider store={store}>
      <Title id="b" />
    </Provider>,
  )
  expect(view.getByTestId('t').textContent).toBe('bee')
})
