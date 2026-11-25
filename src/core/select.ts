import * as Y from 'yjs'
import { deepEqual, isPlainObject } from './equality.js'
import { currentEntries, currentEntry, touchesKeys } from './key-value.js'
import { at, isMap, type Locator } from './locator.js'
import type { LiveSpec } from './live.js'

/**
 * A ready `LiveSpec`: path, observed keys, projection and equality in one
 * plain object. Pass it to `live` or a binding's `liveAtom` as it is, or
 * spread it to add an option (`{ ...selector, origin }`).
 */
export type Selector<T> = LiveSpec<any, T>

/** Options of `project`: how to observe the node and compare projections. */
export interface ProjectOptions<T> {
  /** Default: `deepEqual`, since a custom projection usually builds a fresh value. */
  equals?: (a: T, b: T) => boolean
  /** Default: true without `keys`, so a change anywhere under the node counts; false with `keys`. */
  deep?: boolean
  keys?: readonly string[]
  /** Return false to ignore a change by its event, as `ObserveOptions#event` says. */
  event?: (event: Y.YEvent<any>) => boolean
}

/**
 * A projection packaged with how to observe and compare it, such as
 * `reader(schema, shape)` from `@y-modern/schema`. Hand it to `project`, or
 * spread it into a spec beside `locate`. It takes the node as stored, of any
 * shared type, so it can report one of another kind than its path says, as
 * `reader` does, rather than see it as missing.
 */
export interface Projection<T> extends ProjectOptions<T> {
  project: (node: Y.AbstractType<any> | undefined) => T
}

/**
 * A spec over `locator` whose `project` sees a node of another kind than `is`
 * accepts as missing, so a peer storing a `Y.Text` where a `Y.Array` belongs
 * reads as empty instead of throwing.
 */
const selector = <N, T>(
  locator: Locator,
  is: (node: unknown) => node is N,
  project: (node: N | undefined) => T,
  options: Omit<LiveSpec<any, T>, 'locate' | 'project'> = {},
): Selector<T> => ({
  locate: () => locator,
  project: (node: unknown) => project(is(node) ? node : undefined),
  ...options,
})

// A Y.XmlText is a Y.Text too, but its `toString()` is markup.
const isText = (node: unknown): node is Y.Text =>
  node instanceof Y.Text && !(node instanceof Y.XmlText)

/** Accepts any node, so a packaged projection gets it as stored. */
const asStored = (node: unknown): node is Y.AbstractType<any> => true

const kindOf = (value: unknown) =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : value instanceof Uint8Array
        ? 'bytes'
        : isPlainObject(value)
          ? 'object'
          : typeof value === 'object'
            ? 'other'
            : typeof value

/**
 * Whether `value` can stand in for `fallback`: same `typeof`, with null,
 * arrays, bytes and plain objects told apart. Shared types and other objects
 * never pass.
 */
const sameKind = (value: unknown, fallback: unknown) => {
  const kind = kindOf(value)
  return kind !== 'other' && kind === kindOf(fallback)
}

/** A frozen copy of a fallback's arrays and plain objects, so one reader can't change what the next one reads. */
const frozen = <T>(value: T): T =>
  Array.isArray(value)
    ? (Object.freeze(value.map(frozen)) as T)
    : isPlainObject(value)
      ? (Object.freeze(
          Object.fromEntries(Object.entries(value).map(([k, v]) => [k, frozen(v)])),
        ) as T)
      : value

/**
 * `value` when it has `fallback`'s kind, else `fallback`. An `undefined` fallback checks nothing.
 * Bytes can't be frozen, so a bytes fallback is read as a copy.
 */
const orFallback = (value: unknown, fallback: unknown) =>
  fallback === undefined || sameKind(value, fallback)
    ? value
    : fallback instanceof Uint8Array
      ? fallback.slice()
      : fallback

/**
 * What a fallback guarantees: its kind, not its literal. `typeof` tells a string from a number,
 * not `'open'` from `'garbage'`, so a literal fallback type widens to its primitive.
 */
type Checked<D> = D extends string
  ? string
  : D extends number
    ? number
    : D extends boolean
      ? boolean
      : D

/** The observe options and `equals` of `project`, with their defaults. */
const observing = <T>({
  equals = deepEqual,
  keys,
  deep = keys === undefined,
  event,
}: ProjectOptions<T>) => ({ equals, deep, keys, event })

/** A path to a node. End it with a projection to get a `Selector`. */
export abstract class Path<N extends Y.AbstractType<any>> {
  constructor(readonly locator: Locator<N>) {}

  protected abstract is(node: unknown): node is N

  protected selector<T>(
    project: (node: N | undefined) => T,
    options?: Omit<LiveSpec<any, T>, 'locate' | 'project'>,
  ): Selector<T> {
    return selector(this.locator, (node): node is N => this.is(node), project, options)
  }

  /** `toJSON()` of the node and everything under it, `empty` when missing. Observes deeply; compared deeply. */
  protected json<E>(empty: E): Selector<E> {
    return this.selector((node) => (node ? (node.toJSON() as E) : empty), observing({}))
  }

  /**
   * Your own projection of the node, `undefined` when it is missing or of
   * another kind. Observes deeply and compares with `deepEqual` unless
   * `options` say otherwise; `keys` alone observes only those keys.
   */
  project<T>(project: (node: N | undefined) => T, options?: ProjectOptions<T>): Selector<T>
  /**
   * A packaged projection, such as `reader(schema, shape)`, with its own
   * observe options and `equals`. It gets the node as stored, whatever its kind.
   */
  project<T>(projection: Projection<T>): Selector<T>
  project<T>(
    projection: Projection<T> | ((node: N | undefined) => T),
    options: ProjectOptions<T> = {},
  ): Selector<T> {
    if (typeof projection === 'function') return this.selector(projection, observing(options))
    return selector(this.locator, asStored, projection.project, observing(projection))
  }
}

/**
 * A path to a `Y.Map`. Descend with `child`, or end with a projection to get a `Selector`.
 * `select.map(name)` starts one; `typedAtom` and `collection` take one as their locator.
 *
 * @example
 * const card = select.map('cards').child('card-1')
 * const title = liveAtom(card.text('title'))
 * const flags = liveAtom(card.pick({ done: false, starred: false }))
 */
export class MapPath<V = unknown> extends Path<Y.Map<V>> {
  protected is(node: unknown): node is Y.Map<V> {
    return isMap(node)
  }

  /** Descend into the `Y.Map` stored under `key`. */
  child<W = V extends Y.Map<infer X> ? X : unknown>(key: string): MapPath<W>
  /** Descend into the `Y.Array` stored under `key`. */
  child<W = V extends Y.Array<infer X> ? X : unknown>(key: string, kind: 'array'): ArrayPath<W>
  /** Descend into the `Y.Array` under `key` that holds a y-utility `YKeyValue`. */
  child<W = unknown>(key: string, kind: 'keyValue'): KeyValuePath<W>
  child(
    key: string,
    kind: 'map' | 'array' | 'keyValue' = 'map',
  ): MapPath<unknown> | ArrayPath<unknown> | KeyValuePath<unknown> {
    if (kind === 'array') return new ArrayPath(this.locator.child(key))
    if (kind === 'keyValue') return new KeyValuePath(this.locator.child(key))
    return new MapPath(this.locator.child(key))
  }

  /** The value under `key`, or `undefined` when it or the map is missing. Observes only `key`. */
  get(key: string): Selector<V | undefined>
  /**
   * The value under `key` when it has the same type as `fallback` (`typeof`,
   * with null, arrays, bytes and plain objects told apart), else `fallback`. So
   * a missing map, a missing key and a value of the wrong type all read as
   * `fallback`. An `undefined` fallback reads the value as `get(key)` does.
   * A literal type widens to its primitive, since only the kind is checked; the
   * items of an array and the fields of an object aren't checked. An array or
   * object fallback is read frozen, a bytes fallback as a copy. Observes only `key`.
   */
  get<D>(key: string, fallback: D): Selector<undefined extends D ? V | Checked<D> : Checked<D>>
  get(key: string, fallback?: unknown): Selector<any> {
    const safe = frozen(fallback)
    return this.selector((node) => orFallback(node?.get(key), safe), {
      keys: [key],
    })
  }

  /**
   * An object with each key of `defaults`, read as `get(key, defaults[key])`
   * reads it. Observes only those keys; compared shallowly.
   */
  pick<D extends Record<string, unknown>>(
    defaults: D,
  ): Selector<{ [K in keyof D]: Checked<D[K]> }> {
    const safe = frozen(defaults)
    const keys = Object.keys(safe)
    return this.selector(
      (node) => {
        const out: Record<string, unknown> = {}
        for (const k of keys) out[k] = orFallback(node?.get(k), safe[k])
        return out as { [K in keyof D]: Checked<D[K]> }
      },
      { keys },
    )
  }

  /**
   * The string of the `Y.Text` under `key`, `''` when it is missing or not a
   * `Y.Text` (a `Y.XmlText` included). Follows edits to the text.
   */
  text(key: string): Selector<string> {
    return selector(this.locator.child<Y.Text>(key), isText, (node) =>
      node ? node.toString() : '',
    )
  }

  /**
   * The map's keys, sorted so every peer sees the same order. `[]` when the
   * map is missing. Only a key added or deleted counts, not a value replaced.
   * Its own `event` filter does that, so a spec that adds an `event` filter
   * calls it from its own: `{ ...ids, event: (e) => ids.event!(e) && mine(e) }`.
   */
  keys(): Selector<string[]> {
    return this.selector((node) => (node ? [...node.keys()].sort() : []), {
      event: (event) => [...event.changes.keys.values()].some((c) => c.action !== 'update'),
    })
  }

  /** `toJSON()` of the map and everything under it, `{}` when missing. Observes deeply; compared deeply. */
  toJSON(): Selector<Record<string, unknown>> {
    return this.json({})
  }
}

/**
 * A path to a `Y.Array`. End it with a projection to get a `Selector`.
 *
 * @example
 * const log = select.map('board').child('log', 'array')
 * const entries = liveAtom(log.length())
 */
export class ArrayPath<V = unknown> extends Path<Y.Array<V>> {
  protected is(node: unknown): node is Y.Array<V> {
    return node instanceof Y.Array
  }

  /** The items as stored, `[]` when the array is missing. Compared shallowly. */
  toArray(): Selector<V[]> {
    return this.selector((node) => (node ? node.toArray() : []))
  }

  /** The number of items, 0 when the array is missing. */
  length(): Selector<number> {
    return this.selector((node) => node?.length ?? 0)
  }

  /** `toJSON()` of the array and everything under it, `[]` when missing. Observes deeply; compared deeply. */
  toJSON(): Selector<unknown[]> {
    return this.json<unknown[]>([])
  }
}

/**
 * A path to a `Y.Array` that holds y-utility's `YKeyValue`: `{ key, val }` entries where the
 * rightmost entry per key is the current one. duratom reads and writes the same entries as
 * `YKeyValue`, so the two can share a doc. Items that aren't entries are skipped. End it with a
 * projection, or pass `key(k)` to `typedAtom` for a validated, writable atom over one key.
 *
 * @example
 * const master = select.keyValue('master')
 * const tone = liveAtom(master.get('tone', 0))
 * const toneAtom = typedAtom(master.key('tone'), z.number().min(-1).max(1))
 */
export class KeyValuePath<V = unknown> extends Path<Y.Array<unknown>> {
  protected is(node: unknown): node is Y.Array<unknown> {
    return node instanceof Y.Array
  }

  /** The entry for `key`, for `typedAtom(path.key(k), schema)`. */
  key(key: string): KeyPath {
    return new KeyPath(this.locator, key)
  }

  /**
   * The current value of `key` as stored, `undefined` when it has no entry or the array is
   * missing. Notifies only when an entry for `key` is added or deleted and the value changed.
   */
  get(key: string): Selector<V | undefined>
  /**
   * The current value of `key` when it has `fallback`'s kind, else `fallback`, as `MapPath#get`
   * checks it. Notifies only when an entry for `key` changes the value.
   */
  get<D>(key: string, fallback: D): Selector<undefined extends D ? V | Checked<D> : Checked<D>>
  get(key: string, fallback?: unknown): Selector<any> {
    const safe = frozen(fallback)
    return this.selector((node) => orFallback(node && currentEntry(node, key)?.val, safe), {
      event: touchesKeys([key]),
      equals: deepEqual,
    })
  }

  /** The keys that have an entry, sorted so every peer sees the same order. `[]` when missing. */
  keys(): Selector<string[]> {
    return this.selector((node) => (node ? [...currentEntries(node).keys()].sort() : []), {
      equals: deepEqual,
    })
  }

  /** The current value of every key, as stored. `{}` when missing. Compared deeply. */
  toJSON(): Selector<Record<string, V>> {
    return this.selector(
      (node) => {
        const out: Record<string, V> = {}
        if (node)
          for (const [key, entry] of currentEntries(node))
            Object.defineProperty(out, key, {
              value: entry.val,
              enumerable: true,
              writable: true,
              configurable: true,
            })
        return out
      },
      { equals: deepEqual },
    )
  }
}

/**
 * One key of a key-value array (see `KeyValuePath`): `select.keyValue(name).key(k)`. `typedAtom`
 * takes one for a validated atom over that key's current value.
 *
 * @example
 * const tone = select.keyValue('master').key('tone')
 * const toneAtom = typedAtom(tone, z.number())
 */
export class KeyPath {
  constructor(
    /** Where the key-value array is. */
    readonly locator: Locator<Y.Array<unknown>>,
    readonly key: string,
  ) {}
}

/**
 * Builds selectors: `select.map('cards').child(id).get('title', '')`. Starts
 * at a root type of the doc, like `at`.
 *
 * @example
 * const title = liveAtom(select.map('cards').child('card-1').get('title', ''))
 * const ids = liveAtom(select.map('cards').keys())
 * const order = liveAtom(select.array<string>('order').toArray())
 * const tone = liveAtom(select.keyValue('master').get('tone', 0))
 */
export const select = {
  map: <V = unknown>(name: string) => new MapPath<V>(at.map<V>(name)),
  array: <V = unknown>(name: string) => new ArrayPath<V>(at.array<V>(name)),
  /** A root `Y.Array` that holds a y-utility `YKeyValue`. */
  keyValue: <V = unknown>(name: string) => new KeyValuePath<V>(at.array<unknown>(name)),
}
