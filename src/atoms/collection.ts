import type { StandardSchemaV1 } from '@standard-schema/spec'
import { atom, type Atom, type PrimitiveAtom, type WritableAtom } from 'jotai'
import { atomFamily, type AtomFamily } from 'jotai-family'
import { MapPath, type Locator } from '../core/index.js'
import { isMap } from '../schema/index.js'
import type { Exact } from '../schema/shape.js'
import { readDoc, versionedLiveAtom, type AtomOptions } from './live-atom.js'
import { versionedTypedAtom, type TypedAtom } from './typed-atom.js'

/** What a collection's `create` returns: the schema's result, with the new item's id when valid. */
export type CreateResult<T> =
  | (StandardSchemaV1.SuccessResult<T> & { readonly id: string })
  | StandardSchemaV1.FailureResult

/**
 * Atoms over a `Y.Map` of items, each item a `Y.Map` read through one schema. Write with
 * `store.set` or `useSetAtom`, like any Jotai atom.
 */
export interface Collection<T> {
  /**
   * The ids of every entry of the map, sorted so every peer sees the same order; `[]` while the
   * map is missing. Notifies only when an id is added or removed, never when an item's fields
   * change.
   */
  readonly ids: Atom<string[]>
  /**
   * The typed atom of the item under `id`, the same atom for the same id: it reads `undefined`,
   * `{ issues }` or `{ value }` and merges a patch when set, as `typedAtom` does. Atoms stay in
   * the family until `item.remove(id)` or `item.setShouldRemove` drops them.
   */
  readonly item: AtomFamily<string, TypedAtom<T>>
  /**
   * Validates a whole value and adds it as a new item under `id`, or under
   * `crypto.randomUUID()` when no id is given. Returns the schema's result with the id; an
   * invalid value, an id already in use, or a missing map adds nothing and returns `{ issues }`.
   */
  readonly create: WritableAtom<null, [value: T, id?: string], CreateResult<T>>
  /** Removes the item under `id`. Returns whether there was one. */
  readonly remove: WritableAtom<null, [id: string], boolean>
}

/**
 * A collection over the `Y.Map` at `locator`, whose every entry is an item `Y.Map` read through
 * `schema` and `shape`. `ids` lists the items and stays quiet while their fields change, `item(id)`
 * is a `typedAtom` per item, and `create` and `remove` add and delete items.
 *
 * Like any duratom atom, `ids` and `item(id)` can read stale while nothing is subscribed, except
 * right after the collection's own `create` or `remove`. An entry a peer stored as something other
 * than a `Y.Map` is still listed in `ids`, so it can be found and repaired; its `item` atom reads
 * it as `{ issues }`, or as `undefined` for a plain value.
 *
 * @example
 * const Todo = z.object({ title: z.string(), done: z.boolean() })
 * const todos = collection(select.map('todos'), Todo, { title: 'text' })
 *
 * const { id } = store.set(todos.create, { title: 'Buy milk', done: false }) as { id: string }
 * store.get(todos.ids) // [id]
 * store.set(todos.item(id), { done: true }) // changes only done
 * store.set(todos.remove, id)
 */
export function collection<Schema extends StandardSchemaV1, const S extends object>(
  locator: Locator<any> | MapPath<any>,
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  options: AtomOptions = {},
): Collection<StandardSchemaV1.InferOutput<Schema>> {
  type T = StandardSchemaV1.InferOutput<Schema>
  const path = locator instanceof MapPath ? locator : new MapPath(locator)

  const { live: ids, version: idsVersion } = versionedLiveAtom(path.keys(), options)

  // Each item atom's version, so `remove` can make an unmounted read of it see the removal. Weak,
  // so an atom dropped from the family by `item.remove` or `setShouldRemove` takes it along.
  const versions = new WeakMap<Atom<unknown>, PrimitiveAtom<number>>()
  const item = atomFamily((id: string) => {
    const { typed, version } = versionedTypedAtom(path.child(id), schema, shape, options)
    versions.set(typed, version)
    return typed
  })

  const bump = (set: <V>(a: PrimitiveAtom<V>, update: (prev: V) => V) => void, id: string) => {
    set(idsVersion, (n) => n + 1)
    // Only an atom already in the family can hold a stale read; asking for one would add it.
    for (const param of item.getParams()) {
      if (param !== id) continue
      const version = versions.get(item(id))
      if (version) set(version, (n) => n + 1)
      break
    }
  }

  const create = atom(null, (get, set, value: T, id?: string): CreateResult<T> => {
    const doc = readDoc(get, options)
    const key = id ?? crypto.randomUUID()
    let result!: StandardSchemaV1.Result<T>
    // One transaction, so no other write lands between checking the id and creating the item.
    doc.transact(() => {
      const map = path.locator.resolve(doc)
      if (!isMap(map)) result = { issues: [{ message: missingMap }] }
      else if (map.has(key)) result = { issues: [{ message: taken(key) }] }
      // On a missing node a typed atom's setter takes the patch as the whole value and creates it.
      else result = set(item(key), value)
    })
    if (result.issues) return result
    bump(set, key)
    return { value: result.value, id: key }
  })

  const remove = atom(null, (get, set, id: string): boolean => {
    const doc = readDoc(get, options)
    const map = path.locator.resolve(doc)
    if (!isMap(map) || !map.has(id)) return false
    map.delete(id)
    bump(set, id)
    return true
  })

  return { ids, item, create, remove }
}

const missingMap = "The collection's Y.Map is missing, so there is nowhere to create the item"
const taken = (id: string) => `An item with id ${JSON.stringify(id)} already exists`
