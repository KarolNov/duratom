import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as Y from 'yjs'
import { copy, isShared, type Path, pathOf, setField } from './copy.js'
import { deepEqual } from './equal.js'
import { type AnyShape, type Exact, isMap, isText, isXml, kindOf } from './shape.js'
import { validate } from './validate.js'

/**
 * Projects a located `Y.Map` following `shape` and validates it with `schema`, returning the
 * schema's own result. An absent node returns `undefined` without validating, and a node with a
 * shape mismatch, or a shared type that isn't a `Y.Map`, returns the layer's own issues without
 * validating.
 *
 * @example
 * const Todo = z.object({ title: z.string(), done: z.boolean() })
 * const result = read(Todo, { title: 'text' }, doc.getMap('todos').get(id) as Y.Map<unknown>)
 * if (result?.issues) console.warn(result.issues)
 * else if (result) console.log(result.value.title)
 */
export function read<Schema extends StandardSchemaV1, const S extends object>(
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  node: Y.AbstractType<any> | undefined,
): StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>> | undefined {
  if (node === undefined) return undefined
  // A locator resolves whatever shared type a peer stored where the caller expects a Y.Map.
  if (!isMap(node)) return { issues: [mismatch(undefined, yMap, node)] }
  // Yjs hides the keys of a Y.Map until it's in a doc, so it would read as empty.
  if (!node.doc) throw new TypeError('read needs a Y.Map that is in a Y.Doc.')
  const { value, issues } = project(shape, node)
  if (issues.length > 0) return { issues }
  return validate(schema, value)
}

/**
 * `read` packaged as a store binding's projection: `project` reads a located node through
 * `schema` and `shape`, `deep` observes every change under it, `event` skips edits inside an
 * `'xml'` field, which a read returns as the fragment itself, and `equals` compares two results
 * deeply, since each read returns a fresh tree. It has the shape `project` of a
 * `select` selector and a `liveAtom` spec take, so the schema layer and the observation core
 * stay independent of each other.
 */
export interface Reader<T> {
  project: (node: Y.AbstractType<any> | undefined) => StandardSchemaV1.Result<T> | undefined
  deep: true
  event: (event: Y.YEvent<any>) => boolean
  equals: (
    a: StandardSchemaV1.Result<T> | undefined,
    b: StandardSchemaV1.Result<T> | undefined,
  ) => boolean
}

/**
 * `read(schema, shape, node)` as a `Reader`, for `select...project(reader(schema, shape))`.
 * `typedAtom` reads through it; use it for a read-only typed value outside Jotai.
 *
 * @example
 * const Todo = z.object({ title: z.string(), done: z.boolean() })
 * const todo = live(doc, select.map('todos').child(id).project(reader(Todo, { title: 'text' })))
 * todo.subscribe((result) => console.log(result?.issues ?? result?.value))
 */
export function reader<Schema extends StandardSchemaV1, const S extends object>(
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
): Reader<StandardSchemaV1.InferOutput<Schema>> {
  return {
    project: (node) => read(schema, shape, node),
    deep: true,
    event: (event) => !insideXml(shape as AnyShape, event.path),
    equals: deepEqual,
  }
}

/**
 * Whether a change at `path` under a node is inside an `'xml'` field of `shape`, following `map`
 * fields and the items of `record` fields. A change that sets or deletes the field itself is
 * on its parent map, so its path stops before the field and it still counts.
 */
function insideXml(shape: AnyShape, path: readonly (string | number)[]): boolean {
  let current = shape
  for (let n = 0; n < path.length; n++) {
    const key = path[n]
    if (typeof key !== 'string' || !Object.hasOwn(current, key)) return false
    const kind = kindOf(current[key])
    if (kind === 'xml') return true
    if (kind === undefined || kind === 'text' || kind.kind === 'array') return false
    // A record's next step is the item's key, and the item follows the record's shape.
    if (kind.kind === 'record') n++
    current = kind.shape
  }
  return false
}

/**
 * The most mismatches a read reports, so a doc a peer filled with mismatches nested deep can't make
 * building their paths take time and memory quadratic in its depth.
 */
const maxIssues = 100

/**
 * Thrown by `report` to stop a read's projection once it has found more mismatches than
 * `maxIssues`, and always caught by `project`. A throw unwinds the walks of `project` and `copy`
 * at once, where a returned stop signal would need checking after every report in both.
 */
class TooManyIssues extends Error {}

/** The one `TooManyIssues` every read throws, so stopping doesn't build a stack trace each time. */
const tooManyIssues = new TooManyIssues()

/** Adds `issue`, or stops the projection with one last issue when the read already has the most. */
function report(issues: StandardSchemaV1.Issue[], issue: StandardSchemaV1.Issue) {
  if (issues.length < maxIssues) return void issues.push(issue)
  issues.push({
    message: `Shape mismatch: more than ${maxIssues} mismatches, the rest left out`,
  })
  throw tooManyIssues
}

/** The layer issue for `found` at `at`, where the shape expects `expected`. */
const mismatch = (at: Path, expected: string, found: unknown) => ({
  message: `Shape mismatch: expected ${expected}, found ${describeFound(found)}`,
  path: pathOf(at),
})

// The wording for what a mismatch expects and finds, shared so the two read alike.
const plain = 'a plain value'
const yText = 'a Y.Text'
const yMap = 'a Y.Map'
const yArray = 'a Y.Array'
const yXmlFragment = 'a Y.XmlFragment'

function describeFound(value: unknown): string {
  if (value instanceof Y.Doc) return 'a Y.Doc'
  if (value instanceof Y.XmlElement) return 'a Y.XmlElement'
  if (value instanceof Y.XmlFragment) return yXmlFragment
  if (value instanceof Y.XmlText) return 'a Y.XmlText'
  if (value instanceof Y.XmlHook) return 'a Y.XmlHook'
  if (value instanceof Y.Text) return yText
  if (value instanceof Y.Map) return yMap
  if (value instanceof Y.Array) return yArray
  if (value instanceof Y.AbstractType) return 'a shared type'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (value instanceof Uint8Array) return 'bytes'
  if (typeof value === 'object') return 'an object'
  if (value === undefined) return 'undefined'
  return `a ${typeof value}`
}

/**
 * Projects `node` following `shape`, collecting a layer issue for each shape mismatch instead of
 * reading the mismatched value. A missing `node` reads as its shape's empty values, so a missing
 * `map` field reads the same as an empty one. A stack of steps rather than recursion, so a
 * self-referential shape can read nesting as deep as a peer can sync without overflowing.
 */
function project(shape: AnyShape, node: Y.Map<unknown> | undefined) {
  type Step = {
    shape: AnyShape
    node: Y.Map<unknown> | undefined
    value: object
    at: Path
    /** For a missing node, the shapes of the missing maps it is nested in, to stop a cycle. */
    missing: readonly AnyShape[]
  }
  const root: Record<string, unknown> = {}
  const issues: StandardSchemaV1.Issue[] = []
  const onShared = (found: unknown, at: Path) => report(issues, mismatch(at, plain, found))
  const reportAt = (at: NonNullable<Path>) => ({ at, onShared })
  const steps: Step[] = [{ shape, node, value: root, at: undefined, missing: [] }]
  /** Sets `key` to a plain object that `shape` fills in once the step is taken. */
  const later = (step: Omit<Step, 'value'>, target: object, key: string) => {
    const value = {}
    setField(target, key, value)
    steps.push({ ...step, value })
  }
  try {
    for (let step = steps.pop(); step; step = steps.pop()) {
      const { shape, node, value, at, missing } = step
      if (node)
        for (const [key, stored] of node.entries()) {
          const kind = Object.hasOwn(shape, key) ? kindOf(shape[key]) : undefined
          const here = { key, parent: at }
          if (kind === undefined) {
            if (isShared(stored)) report(issues, mismatch(here, plain, stored))
            else setField(value, key, copy(stored, reportAt(here)))
          } else if (kind === 'text') {
            if (isText(stored)) setField(value, key, stored.toString())
            else report(issues, mismatch(here, yText, stored))
          } else if (kind === 'xml') {
            // Opaque: the layer reads the fragment itself, and never looks inside it.
            if (isXml(stored)) setField(value, key, stored)
            else report(issues, mismatch(here, yXmlFragment, stored))
          } else if (kind.kind === 'array') {
            if (stored instanceof Y.Array)
              setField(value, key, copy(stored.toArray(), reportAt(here)))
            else report(issues, mismatch(here, yArray, stored))
          } else if (!isMap(stored)) report(issues, mismatch(here, yMap, stored))
          else if (kind.kind === 'map')
            later({ shape: kind.shape, node: stored, at: here, missing: [] }, value, key)
          else {
            // A record's items, each a `Y.Map` projected following the item shape.
            const items = {}
            setField(value, key, items)
            for (const [id, item] of stored.entries()) {
              const itemAt = { key: id, parent: here }
              if (isMap(item))
                later({ shape: kind.shape, node: item, at: itemAt, missing: [] }, items, id)
              else report(issues, mismatch(itemAt, yMap, item))
            }
          }
        }
      // A declared field the node doesn't hold reads as its kind's empty value. A missing 'xml'
      // field stays undefined.
      for (const [key, declared] of Object.entries(shape)) {
        const kind = kindOf(declared)
        if (kind === undefined || kind === 'xml' || node?.has(key)) continue
        if (kind === 'text') setField(value, key, '')
        else if (kind.kind === 'array') setField(value, key, [])
        else if (kind.kind === 'record' || missing.includes(kind.shape)) setField(value, key, {})
        else
          later(
            {
              shape: kind.shape,
              node: undefined,
              at: { key, parent: at },
              missing: [...missing, kind.shape],
            },
            value,
            key,
          )
      }
    }
  } catch (error) {
    if (error !== tooManyIssues) throw error
  }
  return { value: root, issues }
}
