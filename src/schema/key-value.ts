import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as Y from 'yjs'
import { currentEntry, setEntry, touchesKeys } from '../core/key-value.js'
import { copy, isShared, pathOf, type Path } from './copy.js'
import { deepEqual } from './equal.js'
import { validate } from './validate.js'
import { assertStorable } from './write.js'

type Result<Schema extends StandardSchemaV1> = StandardSchemaV1.Result<
  StandardSchemaV1.InferOutput<Schema>
>

/**
 * Reads the current value of `key` in a key-value array (y-utility's `YKeyValue`: the rightmost
 * `{ key, val }` entry per key wins) and validates it with `schema`, returning the schema's own
 * result. A missing array or a key with no entry returns `undefined` without validating. A value
 * holding a shared type returns the layer's own issue without validating, since a `YKeyValue`
 * holds plain values only.
 *
 * A current value the schema rejects reads as `{ issues }`, like an invalid map field: it does not
 * fall back to an older entry, which a `YKeyValue` deletes anyway. Writing a valid value repairs it.
 *
 * @example
 * const result = readKey(z.number(), doc.getArray('master'), 'tone')
 * if (result && !result.issues) console.log(result.value)
 */
export function readKey<Schema extends StandardSchemaV1>(
  schema: Schema,
  array: Y.AbstractType<any> | undefined,
  key: string,
): Result<Schema> | undefined {
  if (!(array instanceof Y.Array)) return undefined
  const entry = currentEntry(array, key)
  return entry && readValue(schema, entry.val, key)
}

/** Validates a stored value of `key` with `schema`, reporting a shared type inside it as an issue. */
export function readValue<Schema extends StandardSchemaV1>(
  schema: Schema,
  stored: unknown,
  key: string,
): Result<Schema> {
  const issues: StandardSchemaV1.Issue[] = []
  const onShared = (_found: unknown, at: NonNullable<Path>) =>
    issues.push({
      message: 'Shape mismatch: expected a plain value, found a shared type',
      path: pathOf(at),
    })
  const at = { key, parent: undefined }
  // `copy` reports shared types inside a value, not the value itself.
  if (isShared(stored)) onShared(stored, at)
  const value = copy(stored, { at, onShared })
  if (issues.length > 0) return { issues }
  return validate(schema, value)
}

/**
 * Validates `value` with `schema` and, if it's valid, sets `key` of the key-value array as
 * `YKeyValue#set` does: pushes `{ key, val }` to its end and deletes every older entry for `key`,
 * in one transaction. Returns the schema's own result; an invalid value changes nothing, and so
 * does a value equal to the current one. Throws `UnsupportedValueError` for a value Yjs can't store
 * as written, since the schema accepted it.
 *
 * @example
 * const result = writeKey(z.number().min(-1).max(1), doc.getArray('master'), 'tone', -0.6)
 * if (result.issues) console.warn(result.issues) // the doc is unchanged
 */
export function writeKey<Schema extends StandardSchemaV1>(
  schema: Schema,
  array: Y.Array<any>,
  key: string,
  value: StandardSchemaV1.InferOutput<Schema>,
): Result<Schema> {
  if (!(array instanceof Y.Array)) throw new TypeError('writeKey needs a Y.Array.')
  const result = validate(schema, value)
  if (result.issues) return result
  const at: NonNullable<Path> = { key, parent: undefined }
  assertStorable(value, at)
  setEntry(array, key, copy(value), deepEqual)
  return result
}

/**
 * `readKey(schema, node, key)` packaged as a projection for `select.keyValue(name).project(...)`:
 * it counts only changes that add or delete an entry for `key`, and compares results deeply.
 * `typedAtom(path.key(k), schema)` reads through it.
 *
 * @example
 * const tone = live(doc, select.keyValue('master').project(keyReader(z.number(), 'tone')))
 * tone.subscribe((result) => console.log(result?.issues ?? result?.value))
 */
export function keyReader<Schema extends StandardSchemaV1>(
  schema: Schema,
  key: string,
): KeyReader<StandardSchemaV1.InferOutput<Schema>> {
  return {
    project: (node) => readKey(schema, node, key),
    deep: false,
    event: touchesKeys([key]),
    equals: deepEqual,
  }
}

/** What `keyReader` returns: a projection of one key's validated value, with its event filter. */
export interface KeyReader<T> {
  project: (node: Y.AbstractType<any> | undefined) => StandardSchemaV1.Result<T> | undefined
  deep: false
  event: (event: Y.YEvent<any>) => boolean
  equals: (
    a: StandardSchemaV1.Result<T> | undefined,
    b: StandardSchemaV1.Result<T> | undefined,
  ) => boolean
}
