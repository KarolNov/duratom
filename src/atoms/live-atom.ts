import { live as liveSource, type Live, type LiveSpec } from '../core/index.js'
import { atom, type Atom, type PrimitiveAtom } from 'jotai'
import type * as Y from 'yjs'

export type { LiveSpec }

/**
 * Holds the live Y.Doc handle that atoms read by default. Set once per store; the doc never
 * changes, so this atom never notifies.
 *
 * @example
 * const store = createStore()
 * store.set(docAtom, new Y.Doc())
 */
export const docAtom = atom<Y.Doc | null>(null)

/** Options every duratom atom takes. */
export interface AtomOptions {
  /**
   * The atom holding the doc this atom reads, for apps with several docs. Defaults to
   * `docAtom`.
   *
   * @example
   * const boardDocAtom = atom<Y.Doc | null>(null)
   * const title = liveAtom(select.map('meta').get('title', ''), { docAtom: boardDocAtom })
   */
  docAtom?: Atom<Y.Doc | null | undefined>
}

type Getter = <V>(a: Atom<V>) => V

/** The doc in `options.docAtom`, or in `docAtom`; throws naming the doc atom when it holds none. */
export function readDoc(get: Getter, options: AtomOptions): Y.Doc {
  const holder = options.docAtom ?? docAtom
  const doc = get(holder)
  if (!doc) {
    throw new Error(
      holder === docAtom
        ? 'docAtom has not been set on this store'
        : 'The doc atom passed to this atom holds no doc on this store',
    )
  }
  return doc
}

type Message = { type: 'start'; register: (stop: () => void) => void } | { type: 'stop' }

/**
 * A read-only atom over one node of the doc in `docAtom` (or the doc atom given in `options`),
 * built on `live` from `duratom/core`. While something is subscribed it observes only the
 * located node, re-runs `project` on matching transactions and updates only when `equals` says
 * the result changed. Unsubscribes when the last subscriber goes away.
 *
 * Read while nothing is subscribed (`store.get` outside a component), it can be stale: Jotai
 * keeps an unmounted atom's value until one of its atom dependencies changes, and a doc edit
 * isn't one. It projects the doc on its first read and again whenever it is mounted, but not
 * after later doc edits made while unmounted. Subscribe (`useAtomValue`, `store.sub`) to follow
 * the doc; outside Jotai, `live` from `duratom/core` reads the doc as it is now.
 *
 * A change skipped by the `origin` filter is not remembered: the value catches up at the next
 * accepted change.
 *
 * @example
 * const titleAtom = liveAtom(select.map('cards').child('card-1').get('title', ''))
 */
export function liveAtom<N extends Y.AbstractType<any>, T>(
  spec: LiveSpec<N, T>,
  options: AtomOptions = {},
): Atom<T> {
  return versionedLiveAtom(spec, options).live
}

/**
 * `liveAtom` with the atom its read depends on to project the doc again. Jotai keeps an
 * unmounted atom's value until a dependency changes, and a doc change isn't one, so a write
 * through an atom bumps `version` to make an unmounted read see it. Other doc edits still
 * leave an unmounted read stale, as `liveAtom` says.
 */
export function versionedLiveAtom<N extends Y.AbstractType<any>, T>(
  spec: LiveSpec<N, T>,
  options: AtomOptions,
): { live: Atom<T>; version: PrimitiveAtom<number> } {
  const version = atom(0)
  const getDoc = (get: Getter) => readDoc(get, options)
  // One source per doc, so reads and mounts share its locator and kept reference.
  const sources = new WeakMap<Y.Doc, Live<T>>()
  const sourceFor = (doc: Y.Doc) => {
    let source = sources.get(doc)
    if (!source) sources.set(doc, (source = liveSource(doc, spec)))
    return source
  }

  const snapshot = atom<{ value: T } | null>(null)
  const live = atom(
    (get) => {
      get(version)
      const snap = get(snapshot)
      return snap ? snap.value : sourceFor(getDoc(get)).get()
    },
    (get, set, message: Message) => {
      if (message.type === 'stop') return set(snapshot, null)
      const source = sourceFor(getDoc(get))
      message.register(source.subscribe((value) => set(snapshot, { value })))
      // Subscribing catches up with changes since the first read, keeping the reference if equal.
      set(snapshot, { value: source.get() })
    },
  )
  live.onMount = (send) => {
    let stop: (() => void) | undefined
    send({ type: 'start', register: (fn) => (stop = fn) })
    return () => {
      stop?.()
      send({ type: 'stop' })
    }
  }
  return { live, version }
}
