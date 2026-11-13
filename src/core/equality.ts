export const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.hasOwn(b, k) && Object.is((a as never)[k], (b as never)[k]))
  )
}

/** An object literal, or one without a prototype: the objects `deepEqual` compares by their keys. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Compares arrays and plain objects all the way down, and bytes byte by byte.
 * Any other object (a `Map`, a `Set`, a `Date`, a shared type) equals only itself.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (a instanceof Uint8Array && b instanceof Uint8Array)
    return a.length === b.length && a.every((byte, n) => byte === b[n])
  const arrays = Array.isArray(a) && Array.isArray(b)
  if (!arrays && !(isPlainObject(a) && isPlainObject(b))) return false
  const ka = Object.keys(a as object)
  return (
    ka.length === Object.keys(b as object).length &&
    ka.every((k) => Object.hasOwn(b as object, k) && deepEqual((a as never)[k], (b as never)[k]))
  )
}
