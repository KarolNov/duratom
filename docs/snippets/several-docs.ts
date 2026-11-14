import { select, typedAtom } from 'duratom'
import { atom, createStore } from 'jotai'
import * as Y from 'yjs'
import { z } from 'zod'

// A second doc, beside the one in `docAtom`: settings kept apart from the shared board, say.
const settingsDocAtom = atom<Y.Doc | null>(null)

const Settings = z.object({ theme: z.enum(['light', 'dark']) })
const settingsAtom = typedAtom(
  select.map('settings').child('user'),
  Settings,
  {},
  {
    docAtom: settingsDocAtom,
  },
)

const store = createStore()
store.set(settingsDocAtom, new Y.Doc())
store.set(settingsAtom, { theme: 'dark' })
