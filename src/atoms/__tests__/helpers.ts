import { createStore, type Atom } from 'jotai'
import * as Y from 'yjs'
import { setup as setupDoc } from '../../core/__tests__/helpers.js'
import { docAtom } from '../live-atom.js'

export { observerCount } from '../../core/__tests__/helpers.js'

export function setup() {
  const base = setupDoc()
  const store = createStore()
  store.set(docAtom, base.doc)
  return { ...base, store }
}

/** Collect notifications of an atom in a store; call the returned function to unsubscribe. */
export function watch<T>(store: ReturnType<typeof createStore>, target: Atom<T>) {
  const seen: unknown[] = []
  const stop = store.sub(target, () => seen.push(store.get(target)))
  return Object.assign(stop, { seen })
}

export const syncDocs = (a: Y.Doc, b: Y.Doc, origin: unknown = 'remote') => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), origin)
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), origin)
}
