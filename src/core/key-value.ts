import * as Y from 'yjs'

/**
 * One entry of a key-value array: the `{ key, val }` object y-utility's `YKeyValue` pushes. Of the
 * entries with the same key, the rightmost is the current one.
 */
export interface Entry<V = unknown> {
  key: string
  val: V
}

/** Whether an item of a key-value array is an entry; anything else is skipped, never read. */
export const isEntry = (item: unknown): item is Entry =>
  item !== null &&
  typeof item === 'object' &&
  !Array.isArray(item) &&
  !(item instanceof Y.AbstractType) &&
  typeof (item as { key?: unknown }).key === 'string'

/** The current entry for `key`: the rightmost one. `undefined` when the array has none. */
export function currentEntry<V>(array: Y.Array<V>, key: string): Entry | undefined {
  const items = array.toArray()
  for (let n = items.length - 1; n >= 0; n--) {
    const item = items[n]
    if (isEntry(item) && item.key === key) return item
  }
  return undefined
}

/** The current entry of every key, in the order of the array. */
export function currentEntries<V>(array: Y.Array<V>): Map<string, Entry> {
  const seen = new Map<string, Entry>()
  const items = array.toArray()
  for (let n = items.length - 1; n >= 0; n--) {
    const item = items[n]
    if (isEntry(item) && !seen.has(item.key)) seen.set(item.key, item)
  }
  return new Map([...seen].reverse())
}

/**
 * An event filter that counts a change to a key-value array only when an entry it adds or deletes
 * has one of `keys`, so a component over one key ignores writes to the others. A delete of a stale
 * entry still counts; the projection then reads the same value and `equals` keeps the old one.
 */
export const touchesKeys =
  (keys: readonly string[]) =>
  (event: Y.YEvent<any>): boolean => {
    if (!(event instanceof Y.YArrayEvent)) return true
    const { added, deleted } = event.changes
    for (const item of [...added, ...deleted]) {
      // Deleted items still hold their content while observers run, but count one that doesn't.
      const content: unknown[] | undefined = item.content?.getContent()
      if (!content) return true
      if (content.some((entry) => isEntry(entry) && keys.includes(entry.key))) return true
    }
    return false
  }

/**
 * Sets `key` to `val` as `YKeyValue#set` does: pushes `{ key, val }` to the end of `array` and
 * deletes every older entry for `key`, in one transaction. Leaves the array as it is when its only
 * entry for `key` already holds an equal value, as decided by `equals`.
 */
export function setEntry(
  array: Y.Array<unknown>,
  key: string,
  val: unknown,
  equals: (a: unknown, b: unknown) => boolean,
): void {
  const items = array.toArray()
  const older: number[] = []
  items.forEach((item, n) => {
    if (isEntry(item) && item.key === key) older.push(n)
  })
  if (older.length === 1 && equals((items[older[0]!] as Entry).val, val)) return
  const write = () => {
    // Right to left, so deleting one doesn't move the next.
    for (let n = older.length - 1; n >= 0; n--) array.delete(older[n]!, 1)
    array.push([{ key, val }])
  }
  if (array.doc) array.doc.transact(write)
  else write()
}
