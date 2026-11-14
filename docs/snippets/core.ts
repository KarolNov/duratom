import { live, read, select, write } from 'duratom/core'
import * as Y from 'yjs'
import { z } from 'zod'

const Todo = z.object({ title: z.string(), done: z.boolean() })
const doc = new Y.Doc()
const todo = doc.getMap('todos').set('first', new Y.Map())

// Validated writes and typed reads, on any Y.Map.
write(Todo, { title: 'text' }, todo, { title: 'Learn duratom', done: false })
const result = read(Todo, { title: 'text' }, todo) // { value: { title: 'Learn duratom', done: false } }

// A live value in the shape useSyncExternalStore takes, for any state library or none.
const done = live(doc, select.map('todos').child('first').get('done', false))
const stop = done.subscribe((value) => console.log('done is now', value))
write(Todo, { title: 'text' }, todo, { title: 'Learn duratom', done: true }) // logs: done is now true
stop()

export { result }
