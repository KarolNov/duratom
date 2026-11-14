import { useLiveAtom } from 'duratom/react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { room, type Connection, type Status } from './sync'
import { newId, progress, todos } from './todos'

const LABELS: Record<Status, string> = {
  offline: 'Offline',
  connecting: 'Connecting…',
  connected: 'Syncing…',
  synced: 'Synced',
}

export function App({
  connection,
  clearLocal,
}: {
  connection: Connection
  clearLocal: () => Promise<void>
}) {
  return (
    <main>
      <header>
        <h1>duratom sync</h1>
        <p>
          A todo list kept in a Y.Doc that is saved in this browser with y-indexeddb and synced
          through a Cloudflare Durable Object with y-partyserver. Open this page in another browser
          or device to edit the same list; go offline, edit, reload, and come back online.
        </p>
        <ConnectionBar connection={connection} clearLocal={clearLocal} />
      </header>
      <section className="pane">
        <h2>
          Room <code data-testid="room">{room}</code>
          <Progress />
        </h2>
        <AddTodo />
        <TodoList />
      </section>
    </main>
  )
}

function ConnectionBar({
  connection,
  clearLocal,
}: {
  connection: Connection
  clearLocal: () => Promise<void>
}) {
  const status = useSyncExternalStore(connection.subscribe, connection.status)
  const online = status !== 'offline'
  const forget = async () => {
    await clearLocal()
    location.reload()
  }
  return (
    <div className="bar">
      <span className={`status ${status}`} data-testid="status" role="status">
        {LABELS[status]}
      </span>
      <button onClick={() => connection.setOnline(!online)}>
        {online ? 'Go offline' : 'Go online'}
      </button>
      <button onClick={forget} title="Delete this browser's copy of the room and reload">
        Forget this device
      </button>
      <a href={location.href} target="_blank" rel="noreferrer">
        Open in a new window
      </a>
    </div>
  )
}

function Progress() {
  const { done, total } = useLiveAtom(progress, [])
  return (
    <span className="progress" data-testid="progress">
      {done} of {total} done
    </span>
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

function TodoRow({ id }: { id: string }) {
  const todo = useAtomValue(todos.item(id))
  const setTodo = useSetAtom(todos.item(id))
  const remove = useSetAtom(todos.remove)
  useEffect(() => () => todos.item.remove(id), [id])
  if (!todo || todo.issues) return <li className="broken">Unreadable todo</li>
  return (
    <li data-testid="todo">
      <input
        type="checkbox"
        checked={todo.value.done}
        // A patch: only `done` changes, so a title edit from another device isn't undone.
        onChange={(e) => setTodo({ done: e.target.checked })}
        aria-label="Done"
      />
      <TitleInput value={todo.value.title} onChange={(title) => setTodo({ title })} />
      <button onClick={() => remove(id)} aria-label="Delete">
        ×
      </button>
    </li>
  )
}

/**
 * Uncontrolled, so an edit from another device keeps the caret where it was: a controlled input
 * given a new value moves its caret to the end.
 */
function TitleInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (input.current) replaceKeepingSelection(input.current, value)
  }, [value])
  return (
    <input
      ref={input}
      className="title"
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Title"
    />
  )
}

/** Sets an input's text, moving its selection with the text around it. */
function replaceKeepingSelection(el: HTMLInputElement, next: string) {
  const prev = el.value
  if (prev === next) return
  const end = Math.min(prev.length, next.length)
  let prefix = 0
  while (prefix < end && prev[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (suffix < end - prefix && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix])
    suffix++
  const focused = el === document.activeElement
  const { selectionStart, selectionEnd, selectionDirection } = el
  el.value = next
  if (!focused || selectionStart === null || selectionEnd === null) return
  const move = (at: number) =>
    at <= prefix
      ? at
      : at >= prev.length - suffix
        ? at + next.length - prev.length
        : next.length - suffix
  el.setSelectionRange(move(selectionStart), move(selectionEnd), selectionDirection ?? undefined)
}
