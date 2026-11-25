import type { StandardSchemaV1 } from '@standard-schema/spec'
import { atom, type WritableAtom } from 'jotai'
import * as Y from 'yjs'
import { KeyValuePath } from '../core/index.js'
import { currentEntries, setEntry, touchesKeys } from '../core/key-value.js'
import { assertStorable } from '../schema/write.js'
import { deepEqual } from '../schema/equal.js'
import { copy } from '../schema/copy.js'
import { readValue } from '../schema/key-value.js'
import { validate } from '../schema/validate.js'
import { readDoc, versionedLiveAtom, type AtomOptions } from './live-atom.js'

type Schemas = Record<string, StandardSchemaV1>
type Values<S extends Schemas> = { [K in keyof S]: StandardSchemaV1.InferOutput<S[K]> }

/**
 * A Jotai atom over the keys of a key-value array that `schemas` names, each read through its
 * own schema. It reads as an object with one result per key: `undefined` while the key has no
 * entry, `{ issues }` while its value is invalid, `{ value }` otherwise. Setting it takes a patch
 * of the keys to change, or a function of their valid values returning one.
 */
export type KeyValueAtom<S extends Schemas> = WritableAtom<
  { [K in keyof S]: StandardSchemaV1.Result<Values<S>[K]> | undefined },
  [patch: Partial<Values<S>> | ((prev: Partial<Values<S>>) => Partial<Values<S>>)],
  StandardSchemaV1.Result<Partial<Values<S>>>
>

/**
 * A typed, writable atom over a whole key-value array (y-utility's `YKeyValue`), with one schema
 * per key. Keys `schemas` doesn't name are left out of the read and never written. It re-renders
 * only when an entry for one of its keys changes a result; for one key alone, use
 * `typedAtom(path.key(k), schema)`, which also ignores the other keys.
 *
 * Setting it validates every key of the patch first: when any is invalid, nothing is written and
 * the result holds their issues, each path starting at its key. Otherwise each key is written as
 * `YKeyValue#set` does, in one transaction. A missing array changes nothing.
 *
 * @example
 * const master = keyValueAtom(select.keyValue('master'), {
 *   tone: z.number().min(-1).max(1),
 *   filter: z.object({ x: z.number(), y: z.number() }),
 * })
 *
 * store.get(master).tone // undefined, { issues } or { value }
 * store.set(master, { tone: -0.6 })
 */
export function keyValueAtom<const S extends Schemas>(
  path: KeyValuePath<any>,
  schemas: S,
  options: AtomOptions = {},
): KeyValueAtom<S> {
  type Read = { [K in keyof S]: StandardSchemaV1.Result<Values<S>[K]> | undefined }
  type Patch = Partial<Values<S>>
  if (!(path instanceof KeyValuePath)) throw new TypeError('keyValueAtom needs a KeyValuePath.')
  const keys = Object.keys(schemas)
  const project = (node: Y.AbstractType<any> | undefined): Read => {
    const entries = node instanceof Y.Array ? currentEntries(node) : undefined
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const entry = entries?.get(key)
      out[key] = entry && readValue(schemas[key]!, entry.val, key)
    }
    return out as Read
  }
  const { live, version } = versionedLiveAtom(
    { locate: () => path.locator, project, event: touchesKeys(keys), equals: deepEqual },
    options,
  )

  return atom(
    (get) => get(live),
    (get, set, update: Patch | ((prev: Patch) => Patch)) => {
      const doc = readDoc(get, options)
      let result!: StandardSchemaV1.Result<Patch>
      doc.transact(() => {
        const array = path.locator.resolve(doc)
        if (!(array instanceof Y.Array)) {
          result = { issues: [{ message: 'The key-value Y.Array is missing' }] }
          return
        }
        let patch = update as Patch
        if (typeof update === 'function') {
          const prev: Record<string, unknown> = {}
          for (const [key, read] of Object.entries(project(array)))
            if (read && !read.issues) prev[key] = read.value
          patch = update(prev as Patch)
        }
        const issues: StandardSchemaV1.Issue[] = []
        const valid: [string, unknown][] = []
        for (const [key, value] of Object.entries(patch)) {
          const schema = Object.hasOwn(schemas, key) ? schemas[key] : undefined
          if (!schema) {
            issues.push({ message: `Unknown key ${JSON.stringify(key)}`, path: [key] })
            continue
          }
          const checked = validate(schema, value)
          if (checked.issues)
            for (const issue of checked.issues)
              issues.push({ ...issue, path: [key, ...(issue.path ?? [])] })
          else valid.push([key, value])
        }
        if (issues.length > 0) return void (result = { issues })
        for (const [key, value] of valid) assertStorable(value, { key, parent: undefined })
        for (const [key, value] of valid) setEntry(array, key, copy(value), deepEqual)
        result = { value: patch }
      })
      if (!result.issues) set(version, (n) => n + 1)
      return result
    },
  )
}
