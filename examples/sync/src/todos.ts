import { collection, select } from 'duratom'
import * as Y from 'yjs'
import { z } from 'zod'

/** One todo. `title` is collaborative text, so two devices typing in it both keep their edits. */
export const Todo = z.object({
  title: z.string().refine((title) => title.trim() !== '', 'A todo needs a title'),
  done: z.boolean(),
})

/** Every todo, in the root map `todos` of the doc in `docAtom`. */
export const todos = collection(select.map('todos'), Todo, { title: 'text' })

/** How many todos there are and how many are done; changes only when either number does. */
export const progress = select.map('todos').project((map) => {
  let done = 0
  map?.forEach((item) => {
    if (item instanceof Y.Map && item.get('done') === true) done++
  })
  return { done, total: map?.size ?? 0 }
})

/** An id that sorts by creation time, since a collection lists its ids sorted. */
export const newId = () =>
  `${Date.now().toString(36).padStart(9, '0')}-${crypto.randomUUID().slice(0, 8)}`
