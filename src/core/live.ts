import type * as Y from 'yjs'
import { shallowEqual } from './equality.js'
import { at, type At, type Locator } from './locator.js'
import { observeLocated, type ObserveOptions } from './observe.js'

export interface LiveSpec<N extends Y.AbstractType<any>, T> extends ObserveOptions {
  locate: (at: At) => Locator<N>
  /** Plain snapshot. `undefined` when the located node does not exist. */
  project: (node: N | undefined) => T
  /** Whether two projections are the same; an equal result keeps the old reference and does not notify. Default: shallow. */
  equals?: (a: T, b: T) => boolean
}

/** A read-only value over one node of a doc, in the shape `useSyncExternalStore` takes. */
export interface Live<T, N extends Y.AbstractType<any> = Y.AbstractType<any>> {
  /** The current projection. Keeps the same reference until `equals` says it changed. */
  get(): T
  /**
   * Calls `listener(value, prev)` after a change, with the new and the previous
   * projection. The first subscriber starts observing, the last one to leave stops.
   */
  subscribe(listener: (value: T, prev: T) => void): () => void
  /** The located node as it is now, `undefined` when it does not exist. */
  resolve(): N | undefined
  /**
   * Runs `fn` in one transaction of the doc with the located node as it is
   * now, `undefined` when it does not exist, and returns what `fn` returns.
   * The change comes back through `subscribe` like any other, so a write whose
   * origin the `origin` filter rejects leaves `get()` behind the doc until the
   * next accepted change.
   */
  write<R>(fn: (node: N | undefined, doc: Y.Doc) => R, origin?: unknown): R
}

/**
 * A live projection of one node of `doc`. While anything is subscribed it
 * observes only the located node (see `observeLocated`), re-runs `project` on
 * matching transactions and notifies only when `equals` says the result
 * changed. With no subscribers nothing is observed and `get` projects the
 * current doc on each call.
 *
 * A change skipped by the `origin` filter is not remembered while subscribed:
 * the value catches up at the next accepted change. With no subscribers there
 * is nothing to filter, so `get` shows every change made so far.
 */
export function live<N extends Y.AbstractType<any>, T>(
  doc: Y.Doc,
  spec: LiveSpec<N, T>,
): Live<T, N> {
  const equals = spec.equals ?? shallowEqual
  const locator = spec.locate(at)
  const listeners = new Set<(value: T, prev: T) => void>()
  let current: { value: T } | undefined
  let stop: (() => void) | undefined

  /** Re-projects and returns whether the value changed. */
  const refresh = () => {
    const next = spec.project(locator.resolve(doc))
    if (current && equals(current.value, next)) return false
    current = { value: next }
    return true
  }

  return {
    get() {
      if (!stop) refresh()
      return current!.value
    },
    subscribe(listener) {
      // A wrapper per call, so subscribing the same function twice needs two unsubscribes.
      const entry = (value: T, prev: T) => listener(value, prev)
      listeners.add(entry)
      if (!stop) {
        try {
          stop = observeLocated(doc, locator, spec, () => {
            // Subscribing refreshed `current`, so it is set by the time an observer fires.
            const prev = current!.value
            if (!refresh()) return
            const value = current!.value
            // Skip a listener that an earlier one unsubscribed during this dispatch.
            for (const fn of [...listeners]) if (listeners.has(fn)) fn(value, prev)
          })
          // The doc may have changed since the last `get`; callers read `get` after subscribing.
          refresh()
        } catch (error) {
          listeners.delete(entry)
          stop?.()
          stop = undefined
          throw error
        }
      }
      return () => {
        if (!listeners.delete(entry) || listeners.size > 0) return
        stop?.()
        stop = undefined
      }
    },
    resolve: () => locator.resolve(doc),
    write: (fn, origin) => doc.transact(() => fn(locator.resolve(doc), doc), origin),
  }
}
