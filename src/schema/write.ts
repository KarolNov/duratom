import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as Y from 'yjs'
import { copy, type Path, pathOf } from './copy.js'
import { deepEqual, isPlainObject } from './equal.js'
import { UnsupportedValueError } from './errors.js'
import { type AnyShape, type Exact, isMap, isText, isXml, kindOf } from './shape.js'
import { validate } from './validate.js'

/**
 * Validates `value` with `schema` and, if it's valid, merges it into the located `Y.Map` so only
 * the differences change. Returns the schema's own result; an invalid value changes nothing.
 * Fields the value lacks are deleted, so pass the whole value; a typed atom merges a patch first.
 *
 * @example
 * const Todo = z.object({ title: z.string(), done: z.boolean() })
 * const node = doc.getMap('todos').get(id) as Y.Map<unknown>
 * const result = write(Todo, { title: 'text' }, node, { title: 'Ship it', done: true })
 * if (result.issues) console.warn(result.issues) // the doc is unchanged
 */
export function write<Schema extends StandardSchemaV1, const S extends object>(
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  node: Y.Map<unknown>,
  value: StandardSchemaV1.InferOutput<Schema>,
): StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>> {
  // Only the parent can replace a node a peer stored as another shared type: write the parent.
  // A Y.XmlHook extends Y.Map, but peers decode it as its own type, so it's another type too.
  if (!isMap(node))
    throw new TypeError(
      (node as unknown) instanceof Y.AbstractType
        ? 'write needs a Y.Map, not another shared type (a Y.XmlHook is one); write its parent to repair it.'
        : 'write needs a located Y.Map; write its parent to create a missing one.',
    )
  const doc = node.doc
  // Yjs hides the keys of a Y.Map until it's in a doc, so there'd be nothing to merge into.
  if (!doc) throw new TypeError('write needs a Y.Map that is in a Y.Doc.')
  return apply(schema, shape as AnyShape, doc, new Target(node), value)
}

/**
 * Validates `value` with `schema` and, if it's valid, stores it as a new `Y.Map` under `key` of
 * `parent`, replacing whatever was stored there. Returns the schema's own result; an invalid
 * value creates nothing, and a value the shape can't store throws before anything is created.
 *
 * @example
 * const Todo = z.object({ title: z.string(), done: z.boolean() })
 * create(Todo, { title: 'text' }, doc.getMap('todos'), 'todo-1', { title: 'Buy milk', done: false })
 */
export function create<Schema extends StandardSchemaV1, const S extends object>(
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  parent: Y.Map<unknown>,
  key: string,
  value: StandardSchemaV1.InferOutput<Schema>,
): StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>> {
  if (!isMap(parent)) throw new TypeError('create needs a Y.Map to create the node in.')
  const doc = parent.doc
  if (!doc) throw new TypeError('create needs a Y.Map that is in a Y.Doc.')
  const root = new Target(undefined, new Target(parent), key)
  return apply(schema, shape as AnyShape, doc, root, value)
}

/** Validates `value`, then merges it into `root` in one transaction, creating `root` if missing. */
function apply<T>(
  schema: StandardSchemaV1<unknown, T>,
  shape: AnyShape,
  doc: Y.Doc,
  root: Target,
  value: unknown,
): StandardSchemaV1.Result<T> {
  const result = validate(schema, value)
  if (result.issues) return result
  if (!isPlainObject(value))
    throw new TypeError('write needs a field object as its value, since a Y.Map holds fields.')
  // Every change is planned, and every value checked, before anything is written.
  const changes = plan(shape, root, value)
  doc.transact(() => {
    // A node being created exists even when all its fields are empty.
    root.ensure()
    for (const change of changes) change()
  })
  return result
}

/**
 * A `Y.Map` the merge writes into: the stored one, or one created in its parent on its first
 * change, so a missing `map` field written with nothing to store stays missing, as it reads.
 */
class Target {
  #map: Y.Map<unknown> | undefined

  constructor(
    /** The `Y.Map` stored before the write, whose keys the merge compares against. */
    readonly stored: Y.Map<unknown> | undefined,
    private readonly parent?: Target,
    private readonly key?: string,
  ) {
    this.#map = stored
  }

  /** The `Y.Map`, created along with any missing parents, replacing whatever was stored there. */
  ensure(): Y.Map<unknown> {
    // A loop rather than recursion, so a chain of missing maps as deep as a value nests can't
    // overflow.
    const missing: Target[] = []
    for (let target: Target = this; !target.#map; target = target.parent!) missing.push(target)
    for (let n = missing.length - 1; n >= 0; n--) {
      const target = missing[n]!
      target.#map = new Y.Map()
      target.parent!.#map!.set(target.key!, target.#map)
    }
    return this.#map!
  }

  /** The `Y.Map` if it's stored or has been created, without creating it. */
  get map(): Y.Map<unknown> | undefined {
    return this.#map
  }
}

/**
 * The changes that merge `value` into `root` following `shape`, in the order they apply. Throws,
 * having changed nothing, for a value the shape can't store. A stack of steps rather than
 * recursion, so a self-referential shape can write nesting as deep as a peer can sync.
 */
function plan(shape: AnyShape, root: Target, value: Record<string, unknown>) {
  type Step = { shape: AnyShape; target: Target; value: Record<string, unknown>; at: Path }
  const changes: (() => void)[] = []
  // Missing 'xml' fields, created last and only in maps that exist by then, so a missing map
  // stays missing when nothing else is stored in it.
  const fragments: [Target, string][] = []
  const steps: Step[] = [{ shape, target: root, value, at: undefined }]
  for (let step = steps.pop(); step; step = steps.pop()) {
    const { shape, target, value, at } = step
    const { stored } = target
    const kindAt = (key: string) => (Object.hasOwn(shape, key) ? kindOf(shape[key]) : undefined)
    // A key the value doesn't have is deleted, except an 'xml' field, which a write never touches.
    const absent = stored
      ? [...stored.keys()].filter((key) => !Object.hasOwn(value, key) && kindAt(key) !== 'xml')
      : []
    if (absent.length > 0) changes.push(() => absent.forEach((key) => stored!.delete(key)))
    // A missing 'xml' field is created whatever the value holds for it. Any other stored value is
    // a shape mismatch, so it's replaced.
    for (const key of Object.keys(shape))
      if (kindAt(key) === 'xml' && !isXml(stored?.get(key))) fragments.push([target, key])
    for (const [key, field] of Object.entries(value)) {
      const kind = kindAt(key)
      const here = { key, parent: at }
      const has = stored?.has(key) ?? false
      const current = stored?.get(key)
      if (kind === undefined) {
        if (has && deepEqual(current, field)) continue
        // A missing map already reads without it, and creating the map could beat a peer's first
        // write to it.
        if (field === undefined && !stored) continue
        assertStorable(field, here)
        // Yjs keeps the object it's given, so a copy keeps the caller's later edits out of the doc.
        changes.push(() => target.ensure().set(key, copy(field)))
      } else if (kind === 'xml') {
        // Opaque: the fragment is the editor's, so the written value never reaches it.
        continue
      } else if (field === undefined || field === null) {
        // Missing, it reads as its kind's empty value. Stored as a plain field it would read as a
        // shape mismatch.
        if (has) changes.push(() => stored!.delete(key))
      } else if (kind === 'text') {
        // Stored as a plain field, it would read back as a shape mismatch.
        if (typeof field !== 'string') throw notStorable(here, 'a string, null or undefined')
        // Any other stored value is a shape mismatch, so it's replaced.
        if (isText(current)) changes.push(() => splice(current, field))
        // A missing one already reads as '', and creating it could beat a peer's first text.
        else if (field !== '' || has)
          changes.push(() => target.ensure().set(key, new Y.Text(field)))
      } else if (kind.kind === 'array') {
        if (!Array.isArray(field)) throw notStorable(here, 'an array, null or undefined')
        // Array.from reads a hole as undefined, which a Y.Array can't store.
        const items = Array.from(field)
        const array = current instanceof Y.Array ? current : undefined
        const { start, removed, inserted } = diff(array?.toArray() ?? [], items)
        inserted.forEach((item, n) => {
          const itemAt = { key: start + n, parent: here }
          // Y.Array throws for an undefined item, halfway through the merge.
          if (item === undefined) throw new UnsupportedValueError(pathOf(itemAt))
          assertStorable(item, itemAt)
        })
        if (array) {
          if (removed > 0 || inserted.length > 0)
            changes.push(() => {
              if (removed > 0) array.delete(start, removed)
              if (inserted.length > 0) array.insert(start, inserted.map(copyItem))
            })
        }
        // A missing one already reads as [], and creating it could beat a peer's first items. Any
        // other stored value is a shape mismatch, so it's replaced.
        else if (items.length > 0 || has)
          changes.push(() => {
            const created = new Y.Array<unknown>()
            target.ensure().set(key, created)
            created.insert(0, items.map(copyItem))
          })
      } else {
        if (!isPlainObject(field)) throw notStorable(here, 'an object, null or undefined')
        const child = new Target(isMap(current) ? current : undefined, target, key)
        // Any other stored value is a shape mismatch, so it's replaced.
        if (has && !child.stored) changes.push(() => child.ensure())
        if (kind.kind === 'map') {
          steps.push({ shape: kind.shape, target: child, value: field, at: here })
          continue
        }
        const items = child.stored
        const gone = items ? [...items.keys()].filter((id) => !Object.hasOwn(field, id)) : []
        if (gone.length > 0) changes.push(() => gone.forEach((id) => items!.delete(id)))
        for (const [id, item] of Object.entries(field)) {
          const itemAt = { key: id, parent: here }
          // Like a Shared field, an item written as null or undefined is deleted.
          if (item === undefined || item === null) {
            if (items?.has(id)) changes.push(() => items.delete(id))
            continue
          }
          if (!isPlainObject(item)) throw notStorable(itemAt, 'an object')
          const storedItem = items?.get(id)
          const itemTarget = new Target(isMap(storedItem) ? storedItem : undefined, child, id)
          // An item exists even when all its fields are empty, so a new one is always created.
          if (!itemTarget.stored) changes.push(() => itemTarget.ensure())
          steps.push({ shape: kind.shape, target: itemTarget, value: item, at: itemAt })
        }
      }
    }
  }
  changes.push(() => {
    for (const [target, key] of fragments)
      if (target.map && !isXml(target.map.get(key))) target.map.set(key, new Y.XmlFragment())
  })
  return changes
}

const copyItem = (item: unknown) => copy(item)

/** The error for a Shared field or record item written with a value the shape can't store. */
const notStorable = (at: NonNullable<Path>, expected: string) =>
  new TypeError(
    `write can't store ${JSON.stringify(pathOf(at))} as the shape declares it: only ${expected}.`,
  )

/**
 * The changed middle between `current` and `next` once their common prefix and suffix, compared by
 * deep equality, are left out: where it starts, how many items of `current` it removes, and the
 * items of `next` it inserts.
 */
function diff(current: readonly unknown[], next: readonly unknown[]) {
  const end = Math.min(current.length, next.length)
  let start = 0
  while (start < end && deepEqual(current[start], next[start])) start++
  let suffix = 0
  while (
    suffix < end - start &&
    deepEqual(current[current.length - 1 - suffix], next[next.length - 1 - suffix])
  )
    suffix++
  return {
    start,
    removed: current.length - start - suffix,
    inserted: next.slice(start, next.length - suffix),
  }
}

/**
 * Throws `UnsupportedValueError` unless `field` is a value a `Y.Map` stores and syncs as written:
 * JSON values, `undefined` and bytes, without cycles, `__proto__` keys, or a `constructor` key on
 * the field's own object. Yjs would store anything else differently (a Date syncs as `{}`) or
 * throw halfway through the merge.
 * A stack of steps rather than recursion, so nesting as deep as a peer can sync can't overflow.
 */
function assertStorable(field: unknown, root: NonNullable<Path>) {
  // Each step links to its parent's, so the path is built only for the value that fails.
  type At = NonNullable<Path>
  type Step = { value: unknown; at: At } | { leave: object }
  const fail = (at: At): never => {
    throw new UnsupportedValueError(pathOf(at))
  }
  const onPath = new Set<object>()
  const steps: Step[] = [{ value: field, at: root }]
  for (let step = steps.pop(); step; step = steps.pop()) {
    if ('leave' in step) {
      onPath.delete(step.leave)
      continue
    }
    const { value, at } = step
    if (value === null || value === undefined) continue
    if (['string', 'number', 'boolean'].includes(typeof value)) continue
    if (value instanceof Uint8Array) continue
    if (typeof value !== 'object' || onPath.has(value)) fail(at)
    const items = Array.isArray(value)
      ? // Array.from reads a hole as undefined, as Yjs stores it.
        Array.from(value, (item, n) => [n, item] as const)
      : isPlainObject(value)
        ? Object.entries(value)
        : fail(at)
    onPath.add(value)
    steps.push({ leave: value as object })
    for (const [key, item] of items) {
      const child = { key, parent: at }
      // A peer decodes a `__proto__` key as the object's prototype, so it never arrives. Yjs picks
      // how to store a field by its value's `constructor`, which an own key of that name hides.
      if (key === '__proto__' || (key === 'constructor' && at === root)) fail(child)
      steps.push({ value: item, at: child })
    }
  }
}

/** Turns `text` into `next` keeping their common prefix and suffix, so a peer's edits there merge. */
function splice(text: Y.Text, next: string) {
  const current = text.toString()
  const end = Math.min(current.length, next.length)
  let start = 0
  while (start < end && current[start] === next[start]) start++
  // Yjs garbles a surrogate pair split between two edits, so both ends stay off a pair's middle.
  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start--
  let suffix = 0
  while (
    suffix < end - start &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++
  if (suffix > 0 && isLowSurrogate(current.charCodeAt(current.length - suffix))) suffix--
  const removed = current.length - start - suffix
  const inserted = next.slice(start, next.length - suffix)
  if (removed === 0 && !inserted) return
  // An embed counts in the Y.Text's length but not in its string, so string offsets are mapped
  // to Y.Text offsets. Embeds next to the changed middle stay; those inside it go with it.
  const offsets = text.length === current.length ? undefined : offsetsOf(text)
  const at = (index: number) => offsets?.[index] ?? index
  const from = at(start)
  if (removed > 0) text.delete(from, at(start + removed - 1) + 1 - from)
  if (inserted) text.insert(from, inserted)
}

/** The Y.Text offset of each code unit of its string, and its length after the last. */
function offsetsOf(text: Y.Text) {
  const offsets: number[] = []
  let offset = 0
  for (const { insert } of text.toDelta() as { insert: unknown }[]) {
    if (typeof insert === 'string') for (let n = 0; n < insert.length; n++) offsets.push(offset++)
    else offset++
  }
  offsets.push(text.length)
  return offsets
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff
