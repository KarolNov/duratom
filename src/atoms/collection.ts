import type { StandardSchemaV1 } from '@standard-schema/spec'
import { atom, type Atom, type Getter, type Setter, type WritableAtom } from 'jotai'
import { atomFamily, type AtomFamily } from 'jotai-family'
import { MapPath, type Locator } from '../core/index.js'
import { create as createNode, isMap } from '../schema/index.js'
import type { Exact } from '../schema/shape.js'
import { validate } from '../schema/validate.js'
import { readDoc, versionedLiveAtom, type AtomOptions } from './live-atom.js'
import { refreshedTypedAtom, type Patch, type TypedAtom } from './typed-atom.js'

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
   * `{ issues }` or `{ value }` and merges a patch when set, as `typedAtom` does; setting a
   * missing item creates it. The collection's `remove` drops the item's atom from the family, and
   * `item.remove(id)` or `item.setShouldRemove` can drop others; an atom a caller still holds keeps
   * working after it's dropped.
   */
  readonly item: AtomFamily<string, TypedAtom<T>>
  /**
   * Validates a whole value and adds it as a new item under `id`, or under a random UUID when no
   * id is given. Returns the schema's result with the id. An invalid value, an id already in use,
   * or a missing map adds nothing and returns `{ issues }`: the value's own issues when it has
   * any, else one saying why it couldn't be added.
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
 * right after the collection's own `create` or `remove`, or a write through `item(id)` that
 * created the item. An entry a peer stored as something other than a `Y.Map` is still listed in
 * `ids`, so it can be found and repaired; its `item` atom reads it as `{ issues }`, or as
 * `undefined` for a plain value.
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

  // Bumped whenever this collection adds or removes an item. `ids` and every item atom read it,
  // so an unmounted read of any of them sees the change, including an item atom that the family
  // has since dropped but a caller still holds.
  const membership = atom(0)
  const changed = (set: Setter) => set(membership, (n) => n + 1)
  const has = (get: Getter, id: string) => {
    const map = path.locator.resolve(readDoc(get, options))
    return isMap(map) && map.has(id)
  }

  const { live: ids } = versionedLiveAtom(path.keys(), options, [membership])

  const item = atomFamily((id: string): TypedAtom<T> => {
    const typed = refreshedTypedAtom(path.child(id), schema, shape, options, [membership])
    return atom(
      (get) => get(typed),
      (get, set, patch: Patch<T>) => {
        const existed = has(get, id)
        const result = set(typed, patch)
        // Setting a missing item creates it, which adds an id.
        if (!result.issues && !existed) changed(set)
        return result
      },
    )
  })

  /** The value's own issues if it has any, else one issue saying why nothing can be added. */
  const refuse = (value: T, message: string): StandardSchemaV1.FailureResult => {
    const checked = validate(schema, value)
    return checked.issues ? checked : { issues: [{ message }] }
  }

  const create = atom(null, (get, set, value: T, id?: string): CreateResult<T> => {
    const doc = readDoc(get, options)
    const key = id ?? randomId()
    let result!: StandardSchemaV1.Result<T>
    // One transaction, so no other write lands between checking the id and creating the item.
    doc.transact(() => {
      const map = path.locator.resolve(doc)
      if (!isMap(map)) result = refuse(value, missingMap)
      else if (map.has(key)) result = refuse(value, taken(key))
      // Written straight into the map, so creating doesn't add an atom to the `item` family.
      else result = createNode(schema, shape, map, key, value)
    })
    if (result.issues) return result
    changed(set)
    return { value: result.value, id: key }
  })

  const remove = atom(null, (get, set, id: string): boolean => {
    const doc = readDoc(get, options)
    const map = path.locator.resolve(doc)
    if (!isMap(map) || !map.has(id)) return false
    map.delete(id)
    changed(set)
    // The removed item's atom leaves the family, so removed ids don't pile up in it.
    item.remove(id)
    return true
  })

  return { ids, item, create, remove }
}

const missingMap = "The collection's Y.Map is missing, so there is nowhere to create the item"
const taken = (id: string) => `An item with id ${JSON.stringify(id)} already exists`

/**
 * A random v4 UUID. `crypto.randomUUID` exists only in secure contexts (HTTPS and localhost), so
 * a page served over plain HTTP builds one from `crypto.getRandomValues`, which exists everywhere.
 */
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
