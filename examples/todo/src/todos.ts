import { collection, docAtom, select } from 'duratom'
import { atom } from 'jotai'
import * as Y from 'yjs'
import { z } from 'zod'

const MAX_TITLE = 80

/** One todo. `title` is collaborative text, so two people typing in it both keep their edits. */
export const Todo = z.object({
  title: z
    .string()
    // A check rather than `.trim()`, which would strip the space typed between two words.
    .refine((title) => title.trim() !== '', 'A todo needs a title')
    .max(MAX_TITLE, `Keep the title to ${MAX_TITLE} characters or fewer`),
  done: z.boolean(),
})
export type Todo = z.output<typeof Todo>

/**
 * Every todo, in the root map `todos` of whichever doc the store's `docAtom` holds. The same atoms
 * serve both panes: each pane has its own store, and so its own doc.
 */
export const todos = collection(select.map('todos'), Todo, { title: 'text' })

/** How many todos there are and how many are done; re-renders only when either number changes. */
export const progress = select.map('todos').project((map) => {
  let done = 0
  let total = 0
  map?.forEach((item) => {
    total++
    if (item instanceof Y.Map && item.get('done') === true) done++
  })
  return { done, total }
})

/** One todo's node, for selectors that read a single field of it. */
const todo = (id: string) => select.map('todos').child(id)

/** A todo's title, as a selector: an atom over it re-renders only when the title changes. */
export const titleOf = (id: string) => todo(id).text('title')

/** Whether a todo is done, as a selector: an atom over it ignores title edits. */
export const doneOf = (id: string) => todo(id).get('done', false)

/**
 * Whether a todo can be shown: `null` when it can, and otherwise why not, either the schema's first
 * issue or that the entry isn't a todo at all (a plain value a peer stored, which the item's typed
 * atom reads as `undefined`). Rows exist only for listed ids, so a missing entry is one listed but
 * not a map. Derived from the item's typed atom, and Jotai notifies only
 * when this changes, so a row reading it doesn't re-render while a field is edited.
 */
export const statusOf = (id: string) =>
  atom((get) => {
    const result = get(todos.item(id))
    if (!result) return 'Not a todo'
    return result.issues ? (result.issues[0]?.message ?? 'Invalid todo') : null
  })

/**
 * Adds a todo the schema rejects, writing to the Y.Doc directly as a buggy or outdated peer would:
 * its `done` is the string `'yes'`. `todos.create` validates and would refuse it. Every pane lists
 * it and reads it as `{ issues }`.
 */
export const addInvalidTodo = atom(null, (get, _set, title: string) => {
  const map = get(docAtom)?.getMap<unknown>('todos')
  if (!map) return
  map.set(
    newId(),
    new Y.Map<unknown>([
      ['title', new Y.Text(title || 'Buggy todo')],
      ['done', 'yes'],
    ]),
  )
})

/**
 * Repairs a todo the schema rejects. While a todo has no valid value, its typed atom's setter
 * takes a whole value and replaces what the schema rejected; this keeps the stored title when
 * there is one, cut to the length the schema allows. Repair is app code because only the app knows what a sensible value is.
 */
export const repairTodo = atom(null, (get, set, id: string) => {
  const item = get(docAtom)?.getMap<unknown>('todos').get(id)
  const title = item instanceof Y.Map ? String(item.get('title') ?? '').trim() : ''
  // A buggy peer's title can be longer than the schema allows; keeping it whole would fail the repair.
  const kept = title.slice(0, MAX_TITLE).trim()
  return set(todos.item(id), { title: kept || 'Repaired todo', done: false })
})

/** An id that sorts by creation time, since a collection lists its ids sorted. */
export const newId = () =>
  `${Date.now().toString(36).padStart(9, '0')}-${crypto.randomUUID().slice(0, 8)}`
