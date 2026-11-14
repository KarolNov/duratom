# Sync between devices

Connect the doc in `docAtom` to a sync server with y-partyserver on Cloudflare; every atom then shows and edits the shared state, with no change to the atoms.

duratom atoms read whatever is in their doc, and a Yjs provider keeps a doc the same on every device. So sync is a provider attached to the doc you put in `docAtom`: atoms, components and schemas stay as they are. This recipe uses [y-partyserver](https://github.com/cloudflare/partykit/tree/main/packages/y-partyserver), which runs one Durable Object per room on Cloudflare Workers; any Yjs provider, such as y-websocket, plugs in the same way.

## Client

```bash
npm install y-partyserver
```

<!-- snippet: docs/snippets/sync-client.ts -->

```ts
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
```

<!-- /snippet -->

Pass `store` to Jotai's `<Provider store={store}>`. Edits made before the provider connects, or while it's offline, are sent when it connects.

## Server

```bash
npm install partyserver y-partyserver yjs
```

<!-- snippet: docs/snippets/server/sync-server.ts -->

```ts
// src/index.ts of a Cloudflare Worker.
import { routePartykitRequest } from 'partyserver'
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'

interface Env {
  // The binding's name, in kebab case, is the `party` the client connects to: `docs`.
  Docs: DurableObjectNamespace<Docs>
}

/** One Durable Object per room, holding that room's doc and saving it to its own storage. */
export class Docs extends YServer<Env> {
  override async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>('doc')
    if (saved) Y.applyUpdate(this.document, saved)
  }

  // Called a few seconds after edits, and when the last client leaves.
  override async onSave() {
    await this.ctx.storage.put('doc', Y.encodeStateAsUpdate(this.document))
  }
}

export default {
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
```

<!-- /snippet -->

Bind the class as a Durable Object in `wrangler.jsonc`, then run `npx wrangler dev`, or `npx wrangler deploy` and point the client at the Worker's host:

```jsonc
{
  "name": "my-app-sync",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "durable_objects": { "bindings": [{ "name": "Docs", "class_name": "Docs" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Docs"] }],
}
```

Without `onLoad` and `onSave`, a room keeps its doc only while someone is connected. Durable Object storage limits the size of one value, so store a doc that grows past it in R2, or as several updates.

## Offline as well

Sync and [offline storage](offline.md) work together: attach both providers to the same doc. Edits made offline are saved locally and sent when the connection comes back.
