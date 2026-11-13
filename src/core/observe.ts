import * as Y from 'yjs'
import { isMap, type Locator } from './locator.js'

export interface ObserveOptions {
  /** Use `observeDeep` on the located node, so changes in nested types count. */
  deep?: boolean
  /**
   * Only count Y.Map changes to these keys. In deep mode, changes to the located
   * node itself (children added or removed) always count.
   */
  keys?: readonly string[]
  /** Return false to ignore a transaction by its origin. */
  origin?: (origin: unknown) => boolean
  /**
   * Return false to ignore a change by its event. It decides whether a
   * transaction counts, not what is seen: in deep mode it is called with the
   * transaction's events under the node until one is accepted, so it may not
   * see them all. It runs while the observer runs, so `event.changes` and
   * `event.path` (relative to the located node) can be read.
   */
  event?: (event: Y.YEvent<any>) => boolean
}

/**
 * Calls `onChange` after a transaction that may have changed what the locator
 * points at. Watches the located node (and nothing else in the doc) plus, for
 * each step of the path, that one key of the parent map. Returns an unsubscribe.
 */
export function observeLocated(
  doc: Y.Doc,
  locator: Locator,
  options: ObserveOptions,
  onChange: () => void,
): () => void {
  const { deep = false, keys, origin, event: accepted } = options
  let cleanups: (() => void)[] = []
  let node: Y.AbstractType<any> | undefined

  const accepts = (tr: Y.Transaction) => !origin || origin(tr.origin)
  const touchesKeys = (event: Y.YEvent<any>) =>
    !keys ||
    !(event instanceof Y.YMapEvent) ||
    (deep && event.target === node) ||
    keys.some((k) => event.keysChanged.has(k))
  const counts = (event: Y.YEvent<any>) => touchesKeys(event) && (!accepted || accepted(event))

  const unbind = () => {
    for (const fn of cleanups) fn()
    cleanups = []
  }

  const bind = () => {
    unbind()
    let current: Y.AbstractType<any> | undefined
    node = undefined
    for (const step of locator.steps) {
      if ('root' in step) {
        current = step.kind === 'map' ? doc.getMap(step.root) : doc.getArray(step.root)
        continue
      }
      if (!isMap(current)) return
      const parent: Y.Map<unknown> = current
      const handler = (event: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
        if (!event.keysChanged.has(step.key)) return
        bind()
        if (accepts(tr)) onChange()
      }
      parent.observe(handler)
      cleanups.push(() => parent.unobserve(handler))
      const next = parent.get(step.key)
      if (!(next instanceof Y.AbstractType)) return
      current = next
    }
    const target = current
    if (!target) return
    node = target
    if (deep) {
      const handler = (events: Y.YEvent<any>[], tr: Y.Transaction) => {
        if (accepts(tr) && events.some(counts)) onChange()
      }
      target.observeDeep(handler)
      cleanups.push(() => target.unobserveDeep(handler))
    } else {
      const handler = (event: Y.YEvent<any>, tr: Y.Transaction) => {
        if (accepts(tr) && counts(event)) onChange()
      }
      target.observe(handler)
      cleanups.push(() => target.unobserve(handler))
    }
  }

  bind()
  return unbind
}
