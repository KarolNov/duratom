import { collection, docAtom, select } from 'duratom'
import { atom } from 'jotai'
import * as Y from 'yjs'
import { z } from 'zod'

const Todo = z.object({ title: z.string().min(1), done: z.boolean() })
const todos = collection(select.map('todos'), Todo, { title: 'text' })

/**
 * Repairs a todo a peer stored with a value the schema rejects. While an item has no valid value,
 * setting its atom takes a whole value and replaces what the schema rejected. Only the app knows
 * what a sensible value is: here, the stored title when there is one, and not done.
 */
export const repairTodo = atom(null, (get, set, id: string) => {
  const stored = get(docAtom)?.getMap<unknown>('todos').get(id)
  const title = stored instanceof Y.Map ? String(stored.get('title') ?? '').trim() : ''
  return set(todos.item(id), { title: title || 'Repaired todo', done: false })
})

/** Whether a todo needs repair: listed, but read as `{ issues }` or not a map at all. */
export const needsRepair = (id: string) =>
  atom((get) => {
    const result = get(todos.item(id))
    return !result || result.issues !== undefined
  })
