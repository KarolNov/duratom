# duratom

Durable, live Jotai atoms over a Y.Doc: read typed values, write validated patches, and re-render only when what an atom shows changes.

A [Y.Doc](https://docs.yjs.dev) is the shared, conflict-free state that sync providers keep the same on every device. duratom turns a node of it into a Jotai atom: you read a value your schema has checked, you write a patch that is merged into the doc and validated first, and a component re-renders only when the value it shows changes, whoever changed the doc. Persistence and network sync come from existing Yjs providers; duratom has no provider code of its own.

## Install

```bash
npm install duratom jotai jotai-family yjs
```

Add a [Standard Schema](https://standardschema.dev) validator for typed atoms, such as zod, valibot or arktype, and React for `duratom/react`. duratom needs `yjs` 13.6.33 or later, `jotai` 2.9 or later and `jotai-family`.

## Quick start

Paste this into `src/main.tsx` of a new Vite React app (`npm create vite@latest my-app -- --template react-ts`), then `npm install duratom jotai jotai-family yjs zod` and `npm run dev`.

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

Add a sync provider to the doc ([sync recipe](docs/recipes/sync.md)) and the same atom shows and edits the todo on every device, with no change to the atom or the component.

## Rules

Four rules cover how duratom behaves; the [API reference](https://duratom-docs.karolnovljakovic.workers.dev/api) has the details.

- **One doc per store.** Atoms read the Y.Doc in `docAtom`, so set it once on each Jotai store before reading an atom. An app with several docs gives an atom its own doc atom: `typedAtom(locator, Schema, shape, { docAtom: otherDocAtom })`.
- **Patches merge.** Setting a typed atom with `{ priority: 'high' }` reads the node as it is in the doc at that moment, merges the patch into it and writes only what changed, so a peer's concurrent edit to another field survives. `set(prev => patch)` gets that fresh value as `prev`. On a node with no valid value, the patch is the whole value: that creates a missing node, or repairs an invalid one.
- **Results, not exceptions.** A typed atom reads as `undefined` while its node is missing, `{ issues }` while the node doesn't satisfy the schema, and `{ value }` otherwise. Setting it returns the schema's result; an invalid patch changes nothing and returns `{ issues }`. Only misconfiguration throws: an async schema (`AsyncValidationUnsupportedError`), a value a `Y.Map` can't store (`UnsupportedValueError`), or no doc in `docAtom`.
- **Subscribed atoms follow the doc.** An atom observes its node while something is subscribed to it (a component, or `store.sub`), and then only that node. Read with `store.get` while nothing is subscribed, it can show a value from before a peer's edit; it does see its own writes. Use `live` from `duratom/core` to read the doc as it is now outside Jotai.

## Shapes

A schema says what a value is; a shape says which of its fields are Yjs shared types, so that peers editing them at once merge their edits. Every field the shape doesn't name is a plain value, where the last writer wins.

- `'text'`: a `Y.Text`, read as a string. Two people typing in it both keep their edits.
- `'xml'`: a `Y.XmlFragment`, read as the fragment itself, for rich-text editors.
- `map(shape)`: a nested `Y.Map` with fixed keys, read as an object.
- `record(itemShape)`: a `Y.Map` of item maps with any keys, read as an object of objects.
- `array()`: a `Y.Array` of plain values, read as an array.

A shape's keys are checked against the schema's type, so a key the schema doesn't have, or a kind its field can't hold, is a type error. An empty shape, `{}`, makes every field plain.

## Collections

`collection` covers a map of items: an `ids` atom that changes only when an item is added or removed, a typed atom per item, and `create` and `remove`.

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

## Custom projections

`liveAtom` is the read-only atom under `typedAtom`, for values a schema doesn't describe: one field, a count, anything computed from a node. `select` builds what it reads, and the atom re-renders only when the result changes.

<!-- snippet: docs/snippets/live-atom.tsx -->

```tsx
import { liveAtom, select } from 'duratom'
import { useLiveAtom } from 'duratom/react'
import { useAtomValue } from 'jotai'
import * as Y from 'yjs'

// One field, with a fallback for a missing map, a missing key or a value of another type.
const boardName = liveAtom(select.map('board').get('name', 'Untitled'))

// Your own projection: re-renders only when the counts change, not on every edit to a todo.
const progress = liveAtom(
  select.map('todos').project((todos) => {
    let done = 0
    todos?.forEach((todo) => {
      if (todo instanceof Y.Map && todo.get('done') === true) done++
    })
    return { done, total: todos?.size ?? 0 }
  }),
)

export function Header() {
  const name = useAtomValue(boardName)
  const { done, total } = useAtomValue(progress)
  return (
    <h1>
      {name}: {done} of {total} done
    </h1>
  )
}

// A selector that depends on props: the hook rebuilds the atom only when `id` changes.
export function Title({ id }: { id: string }) {
  const title = useLiveAtom(() => select.map('todos').child(id).text('title'), [id])
  return <span>{title}</span>
}
```

<!-- /snippet -->

## Several docs

Every atom takes a last argument, `{ docAtom }`, naming the atom that holds its doc. Atoms without it read `docAtom`.

<!-- snippet: docs/snippets/several-docs.ts -->

```ts
import { select, typedAtom } from 'duratom'
import { atom, createStore } from 'jotai'
import * as Y from 'yjs'
import { z } from 'zod'

// A second doc, beside the one in `docAtom`: settings kept apart from the shared board, say.
const settingsDocAtom = atom<Y.Doc | null>(null)

const Settings = z.object({ theme: z.enum(['light', 'dark']) })
const settingsAtom = typedAtom(
  select.map('settings').child('user'),
  Settings,
  {},
  {
    docAtom: settingsDocAtom,
  },
)

const store = createStore()
store.set(settingsDocAtom, new Y.Doc())
store.set(settingsAtom, { theme: 'dark' })
```

<!-- /snippet -->

## Without Jotai

`duratom/core` has the pieces under the atoms, for other state libraries or none: `live` follows one node of a doc, and `read` and `write` read and write a `Y.Map` through a schema.

<!-- snippet: docs/snippets/core.ts -->

```ts
import { live, read, select, write } from 'duratom/core'
import * as Y from 'yjs'
import { z } from 'zod'

const Todo = z.object({ title: z.string(), done: z.boolean() })
const doc = new Y.Doc()
const todo = doc.getMap('todos').set('first', new Y.Map())

// Validated writes and typed reads, on any Y.Map.
write(Todo, { title: 'text' }, todo, { title: 'Learn duratom', done: false })
const result = read(Todo, { title: 'text' }, todo) // { value: { title: 'Learn duratom', done: false } }

// A live value in the shape useSyncExternalStore takes, for any state library or none.
const done = live(doc, select.map('todos').child('first').get('done', false))
const stop = done.subscribe((value) => console.log('done is now', value))
write(Todo, { title: 'text' }, todo, { title: 'Learn duratom', done: true }) // logs: done is now true
stop()

export { result }
```

<!-- /snippet -->

## Docs

- [API reference](https://duratom-docs.karolnovljakovic.workers.dev/api): every export, generated from the TSDoc.
- Recipes: [sync between devices](docs/recipes/sync.md), [offline storage](docs/recipes/offline.md), [repair a broken node](docs/recipes/repair.md).
- [Example app](examples/todo): a two-pane shared todo list.
- For AI agents: [`llms.txt`](llms.txt), [`llms-full.txt`](llms-full.txt) (every doc in one file) and an agent skill, [`skills/duratom/SKILL.md`](skills/duratom/SKILL.md). The npm package ships `llms-full.txt` and the skill, so an agent finds them in `node_modules/duratom`.

Every code snippet in these docs is compiled against the source in CI, and so is every `@example` in the TSDoc.

## License

MIT
