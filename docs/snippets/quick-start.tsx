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
