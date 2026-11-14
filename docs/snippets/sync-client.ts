import { docAtom } from 'duratom'
import { createStore } from 'jotai'
import YProvider from 'y-partyserver/provider'
import * as Y from 'yjs'

const doc = new Y.Doc()
// Connects the doc to the room `my-board` of the `Docs` server, and keeps it in sync both ways.
// The host is the Worker's: localhost:8787 under `wrangler dev`.
const provider = new YProvider('localhost:8787', 'my-board', doc, { party: 'docs' })

export const store = createStore()
store.set(docAtom, doc)

// Before closing the app, or when the doc is no longer needed:
export const disconnect = () => provider.destroy()
