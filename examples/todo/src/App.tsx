import { docAtom } from 'duratom'
import { useLiveAtom } from 'duratom/react'
import { createStore, Provider, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Y from 'yjs'
import { link } from './link'
import { scanOnAtom, setScan } from './scan'
import { Tip } from './Tip'
import {
  addInvalidTodo,
  doneOf,
  newId,
  progress,
  repairTodo,
  statusOf,
  titleOf,
  todos,
} from './todos'

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
// Editing this module in dev builds a new pair of docs; unhook the old pair's link.
import.meta.hot?.dispose(() => wire.destroy())

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
          A shared todo list for two people, Alice and Bob. Each has their own Y.Doc, and the two
          docs are linked in memory the way a sync provider links them over a network.
        </p>
        <ul className="try">
          <li>
            <strong>Edit in one pane</strong> to see it arrive in the other: add, tick, rename, or
            type in the same title from both sides.
          </li>
          <li>
            <strong>Latency</strong> delays every update by up to 5 seconds. Edit both panes in the
            meantime and watch the edits merge when they arrive.
          </li>
          <li>
            <strong>Disconnect</strong> to edit both sides offline. Reconnecting sends each side
            what it missed.
          </li>
          <li>
            <strong>🐛</strong> beside Add adds a todo the schema rejects, as a buggy peer would.
            Both panes show it as unreadable instead of crashing, and <strong>🔧</strong> repairs it
            with a valid value, keeping its title.
          </li>
          <li>
            <strong>Show re-renders</strong> outlines each component as it re-renders and explains
            below the panes which atom each one reads.
          </li>
        </ul>
        <Controls />
      </header>
      <div className="panes">
        {[alice, bob].map(({ name, store }) => (
          <Provider key={name} store={store}>
            <Pane name={name} />
          </Provider>
        ))}
      </div>
      <HowItWorks />
    </main>
  )
}

/**
 * What each component reads, and so when it re-renders. Shown only while react-scan is on, next to
 * the outlines it explains.
 */
function HowItWorks() {
  if (!useAtomValue(scanOnAtom)) return null
  return (
    <section className="how">
      <h2>What re-renders, and why</h2>
      <p>
        duratom atoms notify only when the value they show changes. A Y.Doc edit that leaves an
        atom's value equal reaches no component. So each component here subscribes to the smallest
        atom that holds what it shows, and an edit re-renders only the components showing it. The
        outlines show it: typing in a title outlines that title and nothing else.
      </p>
      <div className="table">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Reads</th>
              <th>Re-renders when</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Title</td>
              <td>
                <code>select.map('todos').child(id).text('title')</code>, a selector for one field,
                through <code>useLiveAtom</code>
              </td>
              <td>that todo's title changes, here or from the other pane</td>
            </tr>
            <tr>
              <td>Checkbox</td>
              <td>
                <code>select.map('todos').child(id).get('done', false)</code>
              </td>
              <td>that todo is ticked or unticked</td>
            </tr>
            <tr>
              <td>Row</td>
              <td>
                a Jotai atom derived from <code>todos.item(id)</code> that keeps only whether the
                todo is valid
              </td>
              <td>
                the todo becomes valid or invalid, never for a field edit. Add one with 🐛, which
                writes a todo the schema rejects as a buggy peer would: only its row renders, to
                show the issue, and 🔧 re-renders it back into a title and a checkbox.
              </td>
            </tr>
            <tr>
              <td>List</td>
              <td>
                <code>todos.ids</code>, which ignores edits inside items
              </td>
              <td>a todo is added or removed; the other rows are memoized and stay put</td>
            </tr>
            <tr>
              <td>Count</td>
              <td>
                <code>select.map('todos').project(…)</code>, counting into{' '}
                <code>{'{ done, total }'}</code> and compared deeply
              </td>
              <td>either number changes, not when a title is typed</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Writes cost no re-renders either. Each part writes a patch with{' '}
        <code>useSetAtom(todos.item(id))</code>, and a setter alone doesn't subscribe. The patch
        changes one field, like <code>{'{ done: true }'}</code>, and is merged into the todo as it
        is in the doc at write time. So it never overwrites a field the other pane just edited.
      </p>
    </section>
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
  const [scan, setScanOn] = useAtom(scanOnAtom)

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
      <Tip text="Outline each component as it re-renders, and explain below the panes which atom each one reads.">
        {(describedBy) => (
          <label className="scan">
            <input
              type="checkbox"
              checked={scan}
              onChange={(e) => {
                setScanOn(e.target.checked)
                void setScan(e.target.checked)
              }}
              aria-describedby={describedBy}
            />
            Show re-renders
          </label>
        )}
      </Tip>
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
  const addInvalid = useSetAtom(addInvalidTodo)
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
      <Tip
        align="end"
        text={
          <>
            <strong>Add an invalid todo</strong>, as a buggy peer would: it skips the schema and
            stores <code>{"{ done: 'yes' }"}</code>. Both panes show it as unreadable; 🔧 repairs
            it.
          </>
        }
      >
        {(describedBy) => (
          <button
            type="button"
            className="icon"
            onClick={() => {
              addInvalid(title.trim())
              setTitle('')
              setError(undefined)
            }}
            aria-label="Add an invalid todo"
            aria-describedby={describedBy}
          >
            🐛
          </button>
        )}
      </Tip>
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
  const repair = useSetAtom(repairTodo)
  const [repairError, setRepairError] = useState<string>()

  // Rows mount per pane, and the panes share the family, so a pane that still shows the todo just
  // gets a fresh atom on its next render. Without this, every removed todo's atom stays forever.
  useEffect(() => () => todos.item.remove(id), [id])

  if (status !== null) {
    return (
      <li className="broken">
        <span className="issue">
          Unreadable todo: {status}
          {repairError && <> (repair failed: {repairError})</>}
        </span>
        <Tip
          align="end"
          text={
            <>
              <strong>Repair</strong>: replace what the schema rejects with a valid todo, keeping
              its title, through the todo's typed atom.
            </>
          }
        >
          {(describedBy) => (
            <button
              className="icon"
              onClick={() => {
                const result = repair(id)
                setRepairError(
                  result.issues ? (result.issues[0]?.message ?? 'Invalid todo') : undefined,
                )
              }}
              aria-label="Repair"
              aria-describedby={describedBy}
            >
              🔧
            </button>
          )}
        </Tip>
        <button onClick={() => remove(id)} aria-label="Delete">
          ×
        </button>
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
  // Why the input's text was rejected, while it holds one; the doc keeps the last valid title.
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)

  // The input is uncontrolled so a peer's edit can keep the caret where it was: a controlled input
  // given a new value moves its caret to the end. Its text is left alone while it holds a rejected
  // one, and catches up once that's fixed or the input loses focus.
  useLayoutEffect(() => {
    if (input.current && error === undefined) replaceKeepingSelection(input.current, title)
  }, [title, error])

  const rename = (next: string) => {
    // A patch: only the title changes, so a peer ticking this todo at the same time isn't undone.
    const result = setTodo({ title: next })
    setError(result.issues ? (result.issues[0]?.message ?? 'Invalid title') : undefined)
  }

  return (
    <Tip
      grow
      open={error !== undefined}
      tone="danger"
      align="center"
      text={`${error ?? ''}. The doc keeps the last valid title.`}
    >
      {(describedBy) => (
        <input
          ref={input}
          className={error === undefined ? 'title' : 'title invalid'}
          defaultValue={title}
          onChange={(e) => rename(e.target.value)}
          onBlur={() => setError(undefined)}
          aria-label="Title"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : describedBy}
        />
      )}
    </Tip>
  )
}

/**
 * Sets an input's text to `next`, moving its selection with the text around it: a position before
 * the changed span stays, one after it shifts by the change's length, and one inside it lands at the
 * end of the new text.
 */
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
