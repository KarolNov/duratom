import type { StandardSchemaV1 } from '@standard-schema/spec'
import { atom, type Atom, type WritableAtom } from 'jotai'
import * as Y from 'yjs'
import { KeyPath, Locator, MapPath } from '../core/index.js'
import { create, isMap, keyReader, read, reader, write, writeKey } from '../schema/index.js'
import type { Exact } from '../schema/shape.js'
import { readDoc, versionedLiveAtom, type AtomOptions } from './live-atom.js'

/**
 * What a typed atom's setter takes: a patch of the fields to change, or a function of the node's
 * value as it is in the doc at write time (`undefined` while it has no valid value) returning one.
 */
export type Patch<T> = Partial<T> | ((prev: T | undefined) => Partial<T>)

/**
 * A Jotai atom over one `Y.Map` of the doc, read through a schema. It reads as `undefined` while
 * the node is missing, `{ issues }` while it doesn't satisfy the schema, and `{ value }`
 * otherwise. Setting it merges a patch and returns the schema's result.
 */
export type TypedAtom<T> = WritableAtom<
  StandardSchemaV1.Result<T> | undefined,
  [patch: Patch<T>],
  StandardSchemaV1.Result<T>
>

/**
 * What a key atom's setter takes: the whole new value, or a function of the key's value as it is
 * in the doc at write time (`undefined` while it has no valid value) returning one.
 */
export type KeyUpdate<T> = T | ((prev: T | undefined) => T)

/**
 * A Jotai atom over one key of a key-value array (y-utility's `YKeyValue`), read through a schema.
 * It reads as `undefined` while the key has no entry, `{ issues }` while its current value doesn't
 * satisfy the schema, and `{ value }` otherwise. Setting it validates and writes the whole value,
 * and returns the schema's result.
 */
export type TypedKeyAtom<T> = WritableAtom<
  StandardSchemaV1.Result<T> | undefined,
  [update: KeyUpdate<T>],
  StandardSchemaV1.Result<T>
>

/**
 * A typed, writable atom over the `Y.Map` at `locator`, read through `schema` and `shape`: a
 * `liveAtom` over `reader(schema, shape)` with a setter. It observes only that node, skips edits
 * inside its `'xml'` fields, and re-renders only when the result changes. Like a `liveAtom`, it
 * can read stale while nothing is subscribed, except right after its own setter wrote.
 *
 * Setting it reads the node as it is in the doc at write time, not the atom's last value, and
 * merges the patch into it: fields the patch leaves out, and keys the schema doesn't know, are
 * written back unchanged, so `write` changes only the patched fields and a peer's concurrent
 * edit to another field survives. A function patch gets that fresh value as `prev`.
 *
 * Invalid data never throws: the setter returns the schema's result, and `{ issues }` changes
 * nothing.
 *
 * While the node has no valid value, the patch is the whole value and a function patch gets
 * `undefined` as `prev`. On a missing node a valid value creates the `Y.Map` in its parent; when
 * the parent map is missing too, nothing is created and the result holds one issue saying so. On
 * an invalid node a valid value replaces what the schema rejected, keeping keys neither the shape
 * nor the value names: that is how a node a peer broke is repaired. A shared type of another kind
 * where the map belongs reads as issues, and only writing its parent can replace it.
 *
 * @example
 * const Card = z.object({ title: z.string(), priority: z.enum(['low', 'high']) })
 * const cardAtom = typedAtom(select.map('cards').child('card-1'), Card, { title: 'text' })
 *
 * store.get(cardAtom) // undefined, { issues } or { value }
 * store.set(cardAtom, { title: 'Ship it', priority: 'low' }) // creates the card
 * store.set(cardAtom, { priority: 'high' }) // changes only priority
 */
export function typedAtom<Schema extends StandardSchemaV1, const S extends object>(
  locator: Locator<any> | MapPath<any>,
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  options?: AtomOptions,
): TypedAtom<StandardSchemaV1.InferOutput<Schema>>
/**
 * A typed, writable atom over one key of a key-value array (y-utility's `YKeyValue`), read
 * through `schema`: `select.keyValue(name).key(k)`. It reads the key's current entry (the
 * rightmost) as `undefined`, `{ issues }` or `{ value }`, and re-renders only when an entry for
 * that key changes its result, not when other keys change or a stale entry is cleaned up. A
 * current value the schema rejects reads as `{ issues }`; it does not fall back to an older entry.
 *
 * Setting it validates the whole value, then writes it as `YKeyValue#set` does: pushes
 * `{ key, val }` and deletes the key's older entries, so a `YKeyValue` on the same doc reads it.
 * A function gets the key's valid value at write time, or `undefined`. `{ issues }` changes
 * nothing, and so does a missing array. Values are plain: a `YKeyValue` holds no shared types.
 *
 * @example
 * const toneAtom = typedAtom(select.keyValue('master').key('tone'), z.number().min(-1).max(1))
 *
 * store.get(toneAtom) // undefined, { issues } or { value }
 * store.set(toneAtom, -0.6)
 * store.set(toneAtom, (prev) => Math.min(1, (prev ?? 0) + 0.1))
 */
export function typedAtom<Schema extends StandardSchemaV1>(
  key: KeyPath,
  schema: Schema,
  options?: AtomOptions,
): TypedKeyAtom<StandardSchemaV1.InferOutput<Schema>>
export function typedAtom(
  locator: Locator<any> | MapPath<any> | KeyPath,
  schema: StandardSchemaV1,
  shapeOrOptions?: object,
  options: AtomOptions = {},
): TypedAtom<unknown> | TypedKeyAtom<unknown> {
  if (locator instanceof KeyPath)
    return typedKeyAtom(locator, schema, (shapeOrOptions as AtomOptions | undefined) ?? {})
  return refreshedTypedAtom(locator, schema, (shapeOrOptions ?? {}) as never, options, [])
}

const missingArray = 'The key-value Y.Array is missing'

function typedKeyAtom<Schema extends StandardSchemaV1>(
  path: KeyPath,
  schema: Schema,
  options: AtomOptions,
): TypedKeyAtom<StandardSchemaV1.InferOutput<Schema>> {
  type T = StandardSchemaV1.InferOutput<Schema>
  const { locator, key } = path
  const { live, version } = versionedLiveAtom(
    { locate: () => locator, ...keyReader(schema, key) },
    options,
  )
  return atom(
    (get) => get(live),
    (get, set, update: KeyUpdate<T>) => {
      const doc = readDoc(get, options)
      let result!: StandardSchemaV1.Result<T>
      doc.transact(() => {
        const array = locator.resolve(doc)
        if (!(array instanceof Y.Array))
          return void (result = { issues: [{ message: missingArray }] })
        let value = update
        if (typeof update === 'function') {
          const current = keyReader(schema, key).project(array)
          value = (update as (prev: T | undefined) => T)(
            current && !current.issues ? current.value : undefined,
          )
        }
        result = writeKey(schema, array, key, value as T)
      })
      if (!result.issues) set(version, (n) => n + 1)
      return result
    },
  )
}

/**
 * `typedAtom` whose read also depends on each atom in `refreshers`, so a write made elsewhere,
 * such as a collection's `create` or `remove`, can make an unmounted read see it.
 */
export function refreshedTypedAtom<Schema extends StandardSchemaV1, const S extends object>(
  locator: Locator<any> | MapPath<any>,
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  options: AtomOptions,
  refreshers: readonly Atom<unknown>[],
): TypedAtom<StandardSchemaV1.InferOutput<Schema>> {
  type T = StandardSchemaV1.InferOutput<Schema>
  const located = locator instanceof MapPath ? locator.locator : locator
  const last = located.steps.at(-1)
  // The map a missing node is created in, and its key there. A root map is never missing.
  const parent =
    last && 'key' in last
      ? { locator: new Locator(located.steps.slice(0, -1)), key: last.key }
      : undefined

  const { live, version } = versionedLiveAtom(
    { locate: () => located, ...reader(schema, shape) },
    options,
    refreshers,
  )

  const update = (doc: Y.Doc, patch: Patch<T>): StandardSchemaV1.Result<T> => {
    const node = located.resolve(doc)
    if (node === undefined) {
      const map = parent?.locator.resolve(doc)
      if (!parent || !isMap(map)) return { issues: [{ message: missingParent }] }
      const whole = typeof patch === 'function' ? patch(undefined) : patch
      return create(schema, shape, map, parent.key, whole as T)
    }
    // Another shared type where the map belongs reads as issues; only its parent can replace it.
    if (!isMap(node)) return read(schema, shape, node)!
    const current = read(schema, shape, node)!
    const prev = current.issues ? undefined : current.value
    const changes = typeof patch === 'function' ? patch(prev) : patch
    // With no valid value to merge into, the patch is the whole value.
    const merged = {
      ...unknownKeys(node, prev ?? changes, shape),
      ...(prev as object | undefined),
      ...changes,
    }
    return write(schema, shape, node, merged as T)
  }

  return atom(
    (get) => get(live),
    (get, set, patch: Patch<T>) => {
      const doc = readDoc(get, options)
      let result!: StandardSchemaV1.Result<T>
      // One transaction, so nothing changes the node between reading it and writing the merge.
      doc.transact(() => (result = update(doc, patch)))
      // An unmounted read would otherwise keep the value from before the write.
      if (!result.issues) set(version, (n) => n + 1)
      return result
    },
  )
}

const missingParent = 'The node is missing, and so is the Y.Map it would be created in'

/**
 * The fields of `node` that a valid read left out of `value` and `shape` doesn't declare: keys the
 * schema doesn't know, such as a newer peer's field. `write` deletes a key its value lacks, so a
 * merge writes these back as stored to keep them.
 */
function unknownKeys(node: Y.Map<unknown>, value: unknown, shape: object) {
  const out: Record<string, unknown> = {}
  const known = (key: string) =>
    Object.hasOwn(shape, key) ||
    (value !== null && typeof value === 'object' && Object.hasOwn(value, key))
  for (const [key, stored] of node.entries())
    if (!known(key))
      Object.defineProperty(out, key, {
        value: stored,
        enumerable: true,
        writable: true,
        configurable: true,
      })
  return out
}
