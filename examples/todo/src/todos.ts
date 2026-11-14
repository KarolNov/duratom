import { collection, select } from 'duratom'
import * as Y from 'yjs'
import { z } from 'zod'

/** One todo. `title` is collaborative text, so two people typing in it both keep their edits. */
export const Todo = z.object({
  title: z.string().min(1, 'A todo needs a title').max(80, 'Keep the title under 80 characters'),
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

/** An id that sorts by creation time, since a collection lists its ids sorted. */
export const newId = () =>
  `${Date.now().toString(36).padStart(9, '0')}-${crypto.randomUUID().slice(0, 8)}`
