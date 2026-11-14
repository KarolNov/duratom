import { docAtom } from 'duratom'
import { useLiveAtom } from 'duratom/react'
import { createStore, Provider, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useState, type FormEvent } from 'react'
import * as Y from 'yjs'
import { link } from './link'
import { newId, progress, todos } from './todos'

/** One person: a doc of their own, and a Jotai store whose `docAtom` holds it. */
function person(name: string) {
  const doc = new Y.Doc()
  const store = createStore()
  store.set(docAtom, doc)
  return { name, doc, store }
}

const alice = person('Alice')
const bob = person('Bob')
const wire = link(alice.doc, bob.doc)

alice.store.set(
  todos.create,
  { title: 'Try editing this title in both panes', done: false },
  newId(),
)
bob.store.set(
  todos.create,
  { title: 'Disconnect, edit both sides, reconnect', done: false },
  newId(),
)

export function App() {
  const [connected, setConnected] = useState(true)
  const toggle = () => {
    wire.setConnected(!connected)
    setConnected(!connected)
  }

  return (
    <main>
      <header>
        <h1>duratom todo</h1>
        <p>
          Two people, each with their own Y.Doc, linked in memory. Every edit syncs; cut the link to
          edit offline, and reconnecting merges both sides.
        </p>
        <button className={connected ? 'link on' : 'link off'} onClick={toggle}>
          {connected ? 'Connected: disconnect' : 'Offline: reconnect'}
        </button>
      </header>
      <div className="panes">
        {[alice, bob].map(({ name, store }) => (
          <Provider key={name} store={store}>
            <Pane name={name} />
          </Provider>
        ))}
      </div>
    </main>
  )
}

function Pane({ name }: { name: string }) {
  const ids = useAtomValue(todos.ids)
  const { done, total } = useLiveAtom(progress, [])

  return (
    <section className="pane">
      <h2>
        {name}
        <span className="progress">
          {done} of {total} done
        </span>
      </h2>
      <AddTodo />
      <ul>
        {ids.map((id) => (
          <TodoRow key={id} id={id} />
        ))}
      </ul>
      {total === 0 && <p className="empty">Nothing to do.</p>}
    </section>
  )
}

function AddTodo() {
  const create = useSetAtom(todos.create)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = create({ title: title.trim(), done: false }, newId())
    if (result.issues) return setError(result.issues[0]?.message)
    setTitle('')
    setError(undefined)
  }

  return (
    <form onSubmit={submit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing?"
        aria-label="New todo"
      />
      <button type="submit">Add</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function TodoRow({ id }: { id: string }) {
  const [todo, setTodo] = useAtom(todos.item(id))
  const remove = useSetAtom(todos.remove)
  // What the input shows while it holds a title the schema rejects; the doc keeps the last valid one.
  const [draft, setDraft] = useState<{ title: string; error?: string }>()

  if (!todo) return null
  if (todo.issues) {
    return (
      <li className="broken">
        <span>Unreadable todo: {todo.issues[0]?.message}</span>
        <button onClick={() => remove(id)}>Remove</button>
      </li>
    )
  }

  const { title, done } = todo.value
  const rename = (next: string) => {
    // A patch: only the title changes, so a peer ticking this todo at the same time isn't undone.
    const result = setTodo({ title: next })
    setDraft(result.issues ? { title: next, error: result.issues[0]?.message } : undefined)
  }

  return (
    <li className={done ? 'done' : undefined}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => setTodo((prev) => ({ done: !prev?.done }))}
        aria-label="Done"
      />
      <input
        className={draft ? 'title invalid' : 'title'}
        value={draft?.title ?? title}
        onChange={(e) => rename(e.target.value)}
        onBlur={() => setDraft(undefined)}
        title={draft?.error}
        aria-label="Title"
        aria-invalid={draft ? true : undefined}
      />
      <button onClick={() => remove(id)} aria-label="Delete">
        ×
      </button>
    </li>
  )
}
