# Repair a broken node

Fix a node a peer stored with data your schema rejects, by setting its typed atom with a whole valid value.

A peer running an older or buggy version of an app can store a value your schema rejects: a string where a boolean belongs, a missing field. duratom never throws for it. The node's typed atom reads `{ issues }`, and a collection still lists its id, so the app can show it as broken and offer to fix it.

Repairing is app code, because only the app knows what a sensible value is. While a node has no valid value, setting its typed atom takes a whole value and replaces what the schema rejected, keeping keys neither the shape nor the value names, such as fields a newer peer added.

<!-- snippet: docs/snippets/repair.ts -->

```ts
import { collection, docAtom, select } from 'duratom'
import { atom } from 'jotai'
import * as Y from 'yjs'
import { z } from 'zod'

const Todo = z.object({ title: z.string().min(1), done: z.boolean() })
const todos = collection(select.map('todos'), Todo, { title: 'text' })

/**
 * Repairs a todo a peer stored with a value the schema rejects. While an item has no valid value,
 * setting its atom takes a whole value and replaces what the schema rejected. Only the app knows
 * what a sensible value is: here, the stored title when there is one, and not done.
 */
export const repairTodo = atom(null, (get, set, id: string) => {
  const stored = get(docAtom)?.getMap<unknown>('todos').get(id)
  const title = stored instanceof Y.Map ? String(stored.get('title') ?? '').trim() : ''
  return set(todos.item(id), { title: title || 'Repaired todo', done: false })
})

/** Whether a todo needs repair: listed, but read as `{ issues }` or not a map at all. */
export const needsRepair = (id: string) =>
  atom((get) => {
    const result = get(todos.item(id))
    return !result || result.issues !== undefined
  })
```

<!-- /snippet -->

A row can read `needsRepair(id)` to show a repair button, and call `useSetAtom(repairTodo)(id)` when it's pressed. `repairTodo` returns the schema's result: `{ issues }` if the value it built is still invalid, in which case nothing changed.

An entry a peer stored as a plain value is replaced the same way: the item's typed atom reads `undefined`, and setting it with a whole value stores a new map in its place. An entry stored as another shared type, such as a `Y.Text`, reads as `{ issues }` and can't be replaced through the item's atom; delete it with the collection's `remove` and create the item again.
