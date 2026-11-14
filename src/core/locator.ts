import * as Y from 'yjs'

/** A `Y.Map` a path can descend through. A Y.XmlHook is a Y.Map too, but peers decode it as its own type. */
export const isMap = (node: unknown): node is Y.Map<unknown> =>
  node instanceof Y.Map && !(node instanceof Y.XmlHook)

type Step = { root: string; kind: 'map' | 'array' } | { key: string }

/**
 * A path from a root type to the node a component cares about. It is a path
 * rather than a bare function of the doc so the subscription can watch the key
 * in each parent map: that is how a node that does not exist yet (a card that
 * another tab has not created) or that gets deleted is noticed without
 * observing the whole doc.
 *
 * @example
 * const card = at.map('cards').child<Y.Map<unknown>>('card-1')
 * card.resolve(doc) // the Y.Map, or undefined while it's missing
 */
export class Locator<N extends Y.AbstractType<any> = Y.AbstractType<any>> {
  constructor(readonly steps: readonly Step[]) {}

  /** Descend into the Y type stored under `key` of a map. */
  child<C extends Y.AbstractType<any> = Y.AbstractType<any>>(key: string): Locator<C> {
    return new Locator<C>([...this.steps, { key }])
  }

  resolve(doc: Y.Doc): N | undefined {
    let node: Y.AbstractType<any> | undefined
    for (const step of this.steps) {
      if ('root' in step)
        node = step.kind === 'map' ? doc.getMap(step.root) : doc.getArray(step.root)
      else {
        const next: unknown = isMap(node) ? node.get(step.key) : undefined
        node = next instanceof Y.AbstractType ? next : undefined
      }
      if (!node) return undefined
    }
    return node as N | undefined
  }
}

/**
 * Starts a `Locator` at a root type of the doc. `select` builds on it, and is what most code
 * uses; `at` is for a `LiveSpec` written by hand.
 *
 * @example
 * const spec = {
 *   locate: () => at.map('cards').child<Y.Map<unknown>>('card-1'),
 *   project: (card: Y.Map<unknown> | undefined) => card?.size ?? 0,
 * }
 */
export const at = {
  map: <V = unknown>(name: string) => new Locator<Y.Map<V>>([{ root: name, kind: 'map' }]),
  array: <V = unknown>(name: string) => new Locator<Y.Array<V>>([{ root: name, kind: 'array' }]),
}
/** The type of `at`, which a `LiveSpec`'s `locate` gets. */
export type At = typeof at
