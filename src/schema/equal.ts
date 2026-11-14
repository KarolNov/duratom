/**
 * Whether two JSON values are equal: primitives by `Object.is`, arrays and bytes item by item,
 * plain objects (with or without a prototype) by their own keys whatever their order. Any other
 * object, a shared type included, equals only itself.
 *
 * Only a local `set` can store a cycle. Two cycles compare equal when unrolling them never differs.
 * A stack of pairs rather than recursion, so nesting as deep as a peer can sync can't overflow.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  const pairs: [unknown, unknown][] = [[a, b]]
  // Pairs already compared or being compared, so a cycle compares equal instead of looping.
  const seen = new Map<object, Set<object>>()
  for (let pair = pairs.pop(); pair; pair = pairs.pop()) {
    const [x, y] = pair
    if (Object.is(x, y)) continue
    if (x !== null && typeof x === 'object' && y !== null && typeof y === 'object') {
      const partners = seen.get(x) ?? seen.set(x, new Set()).get(x)!
      if (partners.has(y)) continue
      partners.add(y)
    }
    if (x instanceof Uint8Array && y instanceof Uint8Array) {
      if (x.length !== y.length || x.some((byte, n) => byte !== y[n])) return false
      continue
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false
      for (let n = 0; n < x.length; n++) pairs.push([x[n], y[n]])
      continue
    }
    if (!isPlainObject(x) || !isPlainObject(y)) return false
    const keys = Object.keys(x)
    if (keys.length !== Object.keys(y).length) return false
    for (const key of keys) {
      if (!Object.hasOwn(y, key)) return false
      pairs.push([x[key], y[key]])
    }
  }
  return true
}

/** An object Yjs stores by its keys: an object literal, or one without a prototype. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
