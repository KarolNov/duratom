import { docAtom } from 'duratom'
import { useLiveAtom } from 'duratom/react'
import { createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import { memo, useMemo, useState, type FormEvent } from 'react'
import * as Y from 'yjs'
import { link } from './link'
import { scanEnabled, setScan } from './scan'
import { doneOf, newId, progress, statusOf, titleOf, todos } from './todos'

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

// Each component reads only what it shows, so an edit re-renders only the components that show
// it: adding a todo re-renders the list and the new row, ticking one re-renders its checkbox and
// the counts, and typing in a title re-renders only that title.

export function App() {
  return (
    <main>
      <header>
        <h1>duratom todo</h1>
        <p>
          Two people, each with their own Y.Doc, linked in memory. Every edit syncs after the
          latency you set; cut the link to edit offline, and reconnecting merges both sides.
        </p>
        <Controls />
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

/** The link's controls, holding their own state so changing them re-renders nothing else. */
function Controls() {
  const [connected, setConnected] = useState(true)
  const toggle = () => {
    wire.setConnected(!connected)
    setConnected(!connected)
  }
  const [latency, setLatency] = useState(0)
  const changeLatency = (seconds: number) => {
    wire.setLatency(seconds * 1000)
    setLatency(seconds)
  }
  const [scan, setScanOn] = useState(scanEnabled)

  return (
    <>
      <button className={connected ? 'link on' : 'link off'} onClick={toggle}>
        {connected ? 'Connected: disconnect' : 'Offline: reconnect'}
      </button>
      <label className="latency">
        Latency
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={latency}
          onChange={(e) => changeLatency(Number(e.target.value))}
        />
        <output>{latency.toFixed(1)} s</output>
      </label>
      <label className="scan" title="Outline each component as it re-renders">
        <input
          type="checkbox"
          checked={scan}
          onChange={(e) => {
            setScanOn(e.target.checked)
            void setScan(e.target.checked)
          }}
        />
        Show re-renders
      </label>
    </>
  )
}

/** Reads no atom itself, so it renders once. */
function Pane({ name }: { name: string }) {
  return (
    <section className="pane">
      <h2>
        {name}
        <Progress />
      </h2>
      <AddTodo />
      <TodoList />
    </section>
  )
}

/** Re-renders only when a count changes, not when a title does. */
function Progress() {
  const { done, total } = useLiveAtom(progress, [])
  return (
    <span className="progress">
      {done} of {total} done
    </span>
  )
}

/** Re-renders only when a todo is added or removed; `todos.ids` ignores edits to fields. */
function TodoList() {
  const ids = useAtomValue(todos.ids)
  if (ids.length === 0) return <p className="empty">Nothing to do.</p>
  return (
    <ul>
      {ids.map((id) => (
        <TodoRow key={id} id={id} />
      ))}
    </ul>
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

/**
 * One todo. Memoized, so the list re-rendering for a new id leaves the other rows alone. It reads
 * only whether the todo can be shown; its title and checkbox each read their own field, so an edit
 * re-renders only the part that shows it.
 */
const TodoRow = memo(function TodoRow({ id }: { id: string }) {
  const status = useAtomValue(useMemo(() => statusOf(id), [id]))
  const remove = useSetAtom(todos.remove)

  if (status === undefined) return null
  if (status !== null) {
    return (
      <li className="broken">
        <span>Unreadable todo: {status}</span>
        <button onClick={() => remove(id)}>Remove</button>
      </li>
    )
  }

  return (
    <li>
      <DoneToggle id={id} />
      <TodoTitle id={id} />
      <button onClick={() => remove(id)} aria-label="Delete">
        ×
      </button>
    </li>
  )
})

/** Re-renders only when this todo's `done` changes. */
function DoneToggle({ id }: { id: string }) {
  const done = useLiveAtom(() => doneOf(id), [id])
  // A setter alone doesn't subscribe, so writing through the typed atom costs no re-renders.
  const setTodo = useSetAtom(todos.item(id))

  return (
    <input
      type="checkbox"
      checked={done === true}
      onChange={() => setTodo((prev) => ({ done: !prev?.done }))}
      aria-label="Done"
    />
  )
}

/** Re-renders only when this todo's title changes, whoever changed it. */
function TodoTitle({ id }: { id: string }) {
  const title = useLiveAtom(() => titleOf(id), [id])
  const setTodo = useSetAtom(todos.item(id))
  // What the input shows while it holds a title the schema rejects; the doc keeps the last valid one.
  const [draft, setDraft] = useState<{ title: string; error?: string }>()

  const rename = (next: string) => {
    // A patch: only the title changes, so a peer ticking this todo at the same time isn't undone.
    const result = setTodo({ title: next })
    setDraft(result.issues ? { title: next, error: result.issues[0]?.message } : undefined)
  }

  return (
    <input
      className={draft ? 'title invalid' : 'title'}
      value={draft?.title ?? title}
      onChange={(e) => rename(e.target.value)}
      onBlur={() => setDraft(undefined)}
      title={draft?.error}
      aria-label="Title"
      aria-invalid={draft ? true : undefined}
    />
  )
}
