import { docAtom } from 'duratom'
import { createStore } from 'jotai'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'

const doc = new Y.Doc()
// Saves every change to IndexedDB under this name, and loads what was saved last time.
const persistence = new IndexeddbPersistence('my-app', doc)

export const store = createStore()
store.set(docAtom, doc)

// Atoms read the doc as soon as it's set; this resolves once the saved state is loaded into it.
export const loaded = persistence.whenSynced
