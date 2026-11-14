---
name: duratom
description: Build React apps whose state lives in a Yjs Y.Doc, through duratom's Jotai atoms - typed reads, validated patch writes, collections, live projections, and the sync and offline recipes. Use when code imports duratom, duratom/react or duratom/core, or when the user wants collaborative, synced or offline-first state with Jotai and Yjs.
---

# duratom

duratom turns nodes of a Yjs `Y.Doc` into Jotai atoms. A typed atom reads one `Y.Map` through a Standard Schema validator (zod, valibot, arktype) and writes validated patches into it; a collection covers a map of such items; a live atom reads any projection of a node. Each atom re-renders only when its own value changes. Sync and offline storage come from Yjs providers attached to the doc, never from duratom.

The whole documentation is in `node_modules/duratom/llms-full.txt`: the README, the recipes and the API reference with every signature. Read it when this file doesn't answer a question; don't read duratom's source to find out how to use it.

## Rules

1. **Set `docAtom` once per Jotai store, before any atom is read.** `store.set(docAtom, doc)` and pass that store to `<Provider store={store}>`. Reading an atom with no doc throws `docAtom has not been set on this store`. For a second doc, make a doc atom (`atom<Y.Doc | null>(null)`) and pass `{ docAtom: thatAtom }` as the last argument of the atom.
2. **Setting a typed atom merges a patch.** `set({ done: true })` changes only `done`, merging into the node as it is in the doc at write time, so a peer's concurrent edit to another field survives. Don't spread the atom's current value into the patch: `set({ ...todo.value, done: true })` writes back the fields it read, and can undo a peer's edit made since. For a value computed from the current one, use `set((prev) => ({ count: (prev?.count ?? 0) + 1 }))`; `prev` is read from the doc at write time.
3. **Results, not exceptions.** A typed atom reads `undefined` (node missing), `{ issues }` (node fails the schema, such as a peer's bad data) or `{ value }`. Handle all three in the component. Setting returns the schema result too: `{ issues }` means nothing was written. Never wrap a set in try/catch for validation; check `result.issues`.
4. **A missing node is created by setting its whole value.** While the node has no valid value, the patch must be the whole value; a partial one returns `{ issues }`. Its parent map must exist: root maps always do (`select.map('todos')`), nested ones may not.
5. **Atoms follow the doc while subscribed.** Components using `useAtomValue` or `useAtom` are always current. `store.get(atom)` with nothing subscribed may return a value from before a peer's edit; subscribe with `store.sub`, or read the doc as it is now with `live` from `duratom/core`.
6. **Name shared fields in the shape.** `{ title: 'text' }` stores `title` as a `Y.Text`, so concurrent typing merges. Fields the shape omits are plain values: last writer wins. Kinds: `'text'`, `'xml'`, `map(shape)`, `record(itemShape)`, `array()`. Use `{}` when every field is plain.
7. **Schemas must validate synchronously and accept only JSON values and bytes.** An async refinement throws `AsyncValidationUnsupportedError`; a `Date`, `Map` or class instance throws `UnsupportedValueError`. Store dates as ISO strings or numbers.

## Which API

| Need                                        | Use                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| One typed object at a known path            | `typedAtom(select.map('root').child('key'), Schema, shape)`                             |
| A list of items with ids                    | `collection(select.map('items'), Schema, shape)`: `ids`, `item(id)`, `create`, `remove` |
| One field, a count, a derived value         | `liveAtom(select.map('m').get('field', fallback))` or `.project(fn)`                    |
| A selector that depends on props, in a hook | `useLiveAtom(() => select..., [deps])` from `duratom/react`                             |
| A typed object whose path depends on props  | `useTypedAtom(() => select..., Schema, shape, [deps])` from `duratom/react`             |
| No Jotai                                    | `live`, `read`, `write` from `duratom/core`                                             |
| Values derived from typed atoms             | a plain Jotai `atom((get) => ...)` over them                                            |

Paths: `select.map(name)` and `select.array(name)` start at a root type; `.child(key)` descends into a nested map, `.child(key, 'array')` into a nested array. Selectors end a path: `.get(key, fallback)`, `.pick(defaults)`, `.text(key)`, `.keys()`, `.toJSON()`, `.project(fn)` on a map; `.toArray()`, `.length()`, `.toJSON()` on an array.

## Setup

```bash
npm install duratom jotai jotai-family yjs zod
```

<!-- snippet: docs/snippets/quick-start.tsx -->

```tsx
// src/main.tsx of a new Vite React app: npm create vite@latest my-app -- --template react-ts
import { docAtom, select, typedAtom } from 'duratom'
import { createStore, Provider, useAtom } from 'jotai'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { z } from 'zod'

// What a todo is, and where it lives in the doc: the map `first` in the root map `todos`.
// `title` is collaborative text, so two people typing in it both keep their edits.
const Todo = z.object({ title: z.string(), done: z.boolean() })
const todoAtom = typedAtom(select.map('todos').child('first'), Todo, { title: 'text' })

// One Y.Doc per Jotai store. A sync provider would connect this doc to other devices.
const store = createStore()
store.set(docAtom, new Y.Doc())

function TodoRow() {
  // undefined while the todo is missing, { issues } while it's invalid, { value } otherwise.
  const [todo, setTodo] = useAtom(todoAtom)
  if (!todo) {
    // Setting a missing node with a whole valid value creates it.
    return <button onClick={() => setTodo({ title: 'Learn duratom', done: false })}>Add</button>
  }
  if (todo.issues) return <p>Can't read this todo: {todo.issues[0]?.message}</p>
  return (
    <label>
      {/* A patch changes only the fields it names. */}
      <input
        type="checkbox"
        checked={todo.value.done}
        onChange={(e) => setTodo({ done: e.target.checked })}
      />
      <input value={todo.value.title} onChange={(e) => setTodo({ title: e.target.value })} />
    </label>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <TodoRow />
    </Provider>
  </StrictMode>,
)
```

<!-- /snippet -->

## Collections

<!-- snippet: docs/snippets/collection.tsx -->

```tsx
import { collection, select } from 'duratom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { z } from 'zod'

const Todo = z.object({ title: z.string().min(1), done: z.boolean() })

// Every todo in the root map `todos`, each one a Y.Map read through `Todo`.
const todos = collection(select.map('todos'), Todo, { title: 'text' })

export function TodoList() {
  // Changes only when a todo is added or removed, not when one is edited.
  const ids = useAtomValue(todos.ids)
  const create = useSetAtom(todos.create)
  const add = () => {
    const result = create({ title: 'New todo', done: false })
    if (result.issues) console.warn(result.issues)
  }
  return (
    <>
      <ul>
        {ids.map((id) => (
          <TodoItem key={id} id={id} />
        ))}
      </ul>
      <button onClick={add}>Add</button>
    </>
  )
}

function TodoItem({ id }: { id: string }) {
  // The same typed atom for the same id; it re-renders this row only.
  const [todo, setTodo] = useAtom(todos.item(id))
  const remove = useSetAtom(todos.remove)
  if (!todo || todo.issues) return <li>Unreadable todo</li>
  return (
    <li>
      <input
        type="checkbox"
        checked={todo.value.done}
        onChange={(e) => setTodo({ done: e.target.checked })}
      />
      {todo.value.title}
      <button onClick={() => remove(id)}>Remove</button>
    </li>
  )
}
```

<!-- /snippet -->

`create(value, id?)` returns `{ value, id }` or `{ issues }`; it refuses an id already in use. Generated ids are random UUIDs and `ids` is sorted, so for creation order pass ids that sort by time. `item(id)` returns the same atom for the same id. A row reads `todos.item(id)` itself, so editing one item re-renders only its row.

## Sync and offline

Attach a provider to the doc before or after putting it in `docAtom`; atoms don't change.

- Sync: `new YProvider(host, room, doc, { party })` from `y-partyserver/provider`, served by a `YServer` Durable Object. See `docs/recipes/sync.md` in `llms-full.txt` for the Worker and its `wrangler.jsonc`.
- Offline: `new IndexeddbPersistence(name, doc)` from `y-indexeddb`; `await persistence.whenSynced` before rendering to skip an empty first frame.
- Both: attach both providers to the same doc.

## Broken data from a peer

A node a peer stored invalidly reads `{ issues }`, and a collection still lists its id. Show it as broken; to repair, set the item's atom with a whole valid value built from what's stored. Repair is app code; see `docs/recipes/repair.md`.

## Checklist before finishing

- Every component reading a typed atom handles `undefined`, `{ issues }` and `{ value }`.
- Every set whose result matters checks `result.issues`.
- No patch spreads the atom's previous value; function patches use `prev`.
- Shared-text fields are `'text'` in the shape.
- Each Jotai store has `docAtom` set before render.
- Schemas have no async refinements and no `Date` or class values.
