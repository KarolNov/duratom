// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { atom, createStore, Provider } from 'jotai'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { useLiveAtom } from '../../react/index.js'
import { docAtom, liveAtom, select } from '../index.js'
import { watch } from './helpers.js'

afterEach(cleanup)

const titled = (title: string) => {
  const doc = new Y.Doc()
  doc.getMap('meta').set('title', title)
  return doc
}
const title = select.map('meta').get('title', '')

describe('an atom given its own doc atom', () => {
  it('reads that doc, not the one in docAtom', () => {
    const store = createStore()
    const otherDocAtom = atom<Y.Doc | null>(null)
    store.set(docAtom, titled('main'))
    store.set(otherDocAtom, titled('other'))
    expect(store.get(liveAtom(title))).toBe('main')
    expect(store.get(liveAtom(title, { docAtom: otherDocAtom }))).toBe('other')
  })

  it('stays live on its own doc while edits to docAtom go unnoticed', () => {
    const store = createStore()
    const otherDocAtom = atom<Y.Doc | null>(null)
    const main = titled('main')
    const other = titled('other')
    store.set(docAtom, main)
    store.set(otherDocAtom, other)
    const a = liveAtom(title, { docAtom: otherDocAtom })
    const stop = watch(store, a)
    main.getMap('meta').set('title', 'main 2')
    other.getMap('meta').set('title', 'other 2')
    expect(stop.seen).toEqual(['other 2'])
    stop()
  })

  it('works without docAtom being set at all', () => {
    const store = createStore()
    const readOnly = atom(titled('fixed'))
    expect(store.get(liveAtom(title, { docAtom: readOnly }))).toBe('fixed')
  })

  it('throws an error that does not blame docAtom when its doc atom is empty', () => {
    const store = createStore()
    store.set(docAtom, titled('main'))
    const empty = atom<Y.Doc | null>(null)
    expect(() => store.get(liveAtom(title, { docAtom: empty }))).toThrow(
      'The doc atom passed to this atom holds no doc on this store',
    )
  })
})

describe('useLiveAtom with its own doc atom', () => {
  it('reads that doc in both hook forms', () => {
    const store = createStore()
    const otherDocAtom = atom<Y.Doc | null>(null)
    const other = titled('other')
    store.set(docAtom, titled('main'))
    store.set(otherDocAtom, other)
    function Titles() {
      const fromSpec = useLiveAtom(title, [], { docAtom: otherDocAtom })
      const positional = useLiveAtom(
        (at) => at.map('meta'),
        (meta: Y.Map<unknown> | undefined) => String(meta?.get('title') ?? ''),
        { keys: ['title'], docAtom: otherDocAtom },
        [],
      )
      return (
        <span data-testid="t">
          {fromSpec}/{positional}
        </span>
      )
    }
    const view = render(
      <Provider store={store}>
        <Titles />
      </Provider>,
    )
    expect(view.getByTestId('t').textContent).toBe('other/other')
    act(() => other.getMap('meta').set('title', 'renamed'))
    expect(view.getByTestId('t').textContent).toBe('renamed/renamed')
  })
})
