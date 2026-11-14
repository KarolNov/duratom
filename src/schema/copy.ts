import * as Y from 'yjs'

/** Sets `key` as an own field, so a stored `__proto__` key reads as a field, not a prototype. */
export const setField = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })

/** A path into a value, innermost key first, built only when something reports it. */
export type Path = { readonly key: PropertyKey; readonly parent: Path } | undefined

/** The keys from the root down to `at`. */
export const pathOf = (at: Path) => {
  const keys: PropertyKey[] = []
  for (let link = at; link; link = link.parent) keys.push(link.key)
  return keys.reverse()
}

/** A stored value that holds a shape's place: a shared type, or a subdocument. */
export const isShared = (value: unknown): value is Y.AbstractType<unknown> | Y.Doc =>
  value instanceof Y.AbstractType || value instanceof Y.Doc

/**
 * A deep copy of a stored JSON value. Yjs hands back the objects it stores, so mutating a read's
 * result would otherwise change the local doc without emitting an update.
 *
 * Only a local `set` can store an object twice or a cycle, since a peer decodes separate objects.
 * An object stored twice is copied twice, as a peer would read it, and a cycle stays a cycle.
 * A stack of steps rather than recursion, so nesting as deep as a peer can sync can't overflow.
 *
 * A shared type inside the value is never copied or flattened: with `onShared` it is reported at
 * its path, starting from `at`, and left out; without it, it is kept as the live type.
 */
export function copy(
  stored: unknown,
  report?: {
    at: NonNullable<Path>
    onShared: (found: unknown, at: NonNullable<Path>) => void
  },
): unknown {
  if (!isContainer(stored)) return stored
  if (stored instanceof Uint8Array) return new Uint8Array(stored)
  const onPath = new Map<object, unknown>()
  // A step's path is linked only when a container's children need it or a shared type is reported.
  type Step =
    | {
        value: unknown
        target: object
        key: string
        pathKey: PropertyKey
        parent: Path
      }
    | { leave: object }
  const root: Record<string, unknown> = {}
  const steps: Step[] = [
    {
      value: stored,
      target: root,
      key: 'value',
      pathKey: report?.at.key ?? 'value',
      parent: report?.at.parent,
    },
  ]
  for (let step = steps.pop(); step; step = steps.pop()) {
    if ('leave' in step) {
      onPath.delete(step.leave)
      continue
    }
    const { value, target, key, pathKey, parent } = step
    if (report && isShared(value)) report.onShared(value, { key: pathKey, parent })
    else if (!isContainer(value)) setField(target, key, value)
    else if (onPath.has(value)) setField(target, key, onPath.get(value))
    else if (value instanceof Uint8Array) setField(target, key, new Uint8Array(value))
    else {
      const here: Path = report && { key: pathKey, parent }
      const children: Step[] = []
      let copied: unknown[] | Record<string, unknown>
      if (Array.isArray(value)) {
        copied = new Array<unknown>(value.length)
        for (let n = 0; n < value.length; n++)
          children.push({
            value: value[n],
            target: copied,
            key: String(n),
            pathKey: n,
            parent: here,
          })
      } else {
        copied = {}
        for (const [field, item] of Object.entries(value))
          children.push({
            value: item,
            target: copied,
            key: field,
            pathKey: field,
            parent: here,
          })
      }
      setField(target, key, copied)
      onPath.set(value, copied)
      steps.push({ leave: value })
      for (let n = children.length - 1; n >= 0; n--) steps.push(children[n]!)
    }
  }
  return root.value
}

/** A stored value `copy` must descend into: an object that isn't a shared type. */
const isContainer = (value: unknown): value is object =>
  value !== null && typeof value === 'object' && !isShared(value)
