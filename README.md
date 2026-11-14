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

Add a sync provider to the doc ([sync recipe](https://duratom.karolnov.dev/recipes/sync)) and the same atom shows and edits the todo on every device, with no change to the atom or the component.

## Docs

Everything else is at **[duratom.karolnov.dev](https://duratom.karolnov.dev)**: the guide, recipes for sync and offline storage, and the API reference.

For AI agents, the npm package ships [`llms-full.txt`](llms-full.txt) (every doc in one file) and an agent skill, [`skills/duratom/SKILL.md`](skills/duratom/SKILL.md), so an agent finds them in `node_modules/duratom`.

## Specs and blueprints

What each part of duratom must do is written down as **capability specs**: requirements with GIVEN / WHEN / THEN scenarios, one page per capability (`core/observe`, `schema`, `atoms`, `docs`). A planned change is a **blueprint**: a brief with the decisions, the tasks and a spec delta, plus a review for people. When the change is built, its delta is merged into the specs.

These come from the [`/blueprint` skills](https://github.com/KarolNov/skills/tree/main/skills/blueprint) in [KarolNov/skills](https://github.com/KarolNov/skills). The specs live outside the repo; [`.blueprint/`](.blueprint) maps each capability to the code that implements it and records when the two last agreed. `python3 .blueprint/drift.py check` lists capabilities whose code changed since then.

## License

MIT
