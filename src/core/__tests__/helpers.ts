import * as Y from 'yjs'

export function setup() {
  const doc = new Y.Doc()
  const items = doc.getMap<Y.Map<unknown>>('items')
  const addItem = (id: string, props: Record<string, unknown> = {}) =>
    doc.transact(() => {
      const item = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(props)) item.set(k, v)
      items.set(id, item)
    })
  const setProp = (id: string, key: string, value: unknown) => items.get(id)!.set(key, value)
  return { doc, items, addItem, setProp }
}

/** Number of observe/observeDeep handlers on every type of the doc, root and nested. */
export function observerCount(doc: Y.Doc): number {
  let total = 0
  const visit = (type: Y.AbstractType<any>) => {
    total += type._eH.l.length + type._dEH.l.length
    if (type instanceof Y.Map)
      for (const child of type.values()) if (child instanceof Y.AbstractType) visit(child)
  }
  for (const root of doc.share.values()) visit(root)
  return total
}
