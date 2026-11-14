# Offline storage

Save the doc in the browser with y-indexeddb, so the app opens with the last state and works offline; atoms don't change.

A Yjs provider that stores the doc locally is all it takes: [y-indexeddb](https://github.com/yjs/y-indexeddb) writes every change to IndexedDB and loads it back when the app starts.

```bash
npm install y-indexeddb
```

<!-- snippet: docs/snippets/offline.ts -->

```ts
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
```

<!-- /snippet -->

Atoms can be read before `loaded` resolves: a typed atom reads `undefined` for a node that isn't loaded yet, then its value once it is, like a node a peer creates. To avoid showing an empty app for a moment, wait for `loaded` before rendering.

Use a name per doc: two docs saved under one name are merged into one. To share the doc between devices as well, add a [sync provider](sync.md) to the same doc.
