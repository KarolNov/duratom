# duratom sync

A todo list that works offline and syncs between devices, end to end: the [offline](../../docs/recipes/offline.md) and [sync](../../docs/recipes/sync.md) recipes in one app. The doc is saved in the browser with y-indexeddb and synced through a Cloudflare Durable Object with y-partyserver. The atoms in [`src/todos.ts`](src/todos.ts) know about neither provider.

```sh
pnpm install
pnpm build                                    # builds duratom, which the example imports
pnpm --filter duratom-example-sync dev        # the app and the sync Worker, on one port
```

`vite dev` runs the Worker in workerd through [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/), so the WebSocket to the Durable Object is on the same origin as the app. Open the page in two browsers (or a normal and a private window) to be two devices; `?room=name` picks the room. Then:

- **Edit** in one window and watch the other follow.
- **Go offline**, edit, and reload: the edits come back from IndexedDB and the app starts offline. **Go online** to send them; the other window's edits made meanwhile arrive too.
- **Type in one title from both windows while offline**: it's a `Y.Text`, so both edits are kept.
- **Forget this device** deletes the browser's copy and reloads, so the room comes from the server.

## Deploy

From the repo root, with `wrangler login` done once:

```sh
pnpm example:sync:deploy
```

It builds duratom and the app, then deploys the app's files and the sync Worker as one Worker, `duratom-example-sync`, to your Cloudflare account. Wrangler prints its `workers.dev` URL. The client connects to the host it was loaded from, over `wss` on https, so nothing needs configuring.

## End-to-end tests

```sh
pnpm --filter duratom-example-sync exec playwright install chromium   # once
pnpm --filter duratom-example-sync e2e
```

[`e2e/sync.spec.ts`](e2e/sync.spec.ts) starts `vite dev` and drives the app in Chromium, each browser context a separate device with its own IndexedDB. It checks that edits sync through the server, that offline edits survive a reload and are sent on reconnect, that concurrent offline edits to one title merge, and that a device with nothing saved gets the room from the server.

To run the same tests against a deployed Worker instead of `vite dev`:

```sh
E2E_BASE_URL=https://duratom-example-sync.<your-subdomain>.workers.dev pnpm --filter duratom-example-sync e2e
```

Run them against a deployment too: the concurrent-edits test caught a bug that only shows on Cloudflare. The provider closes its socket with no close code, partyserver 0.5.10 doesn't answer that close, and the browser can't reconnect until the old socket times out. Local workerd answers anyway. `Docs.onClose` in the Worker works around it until [cloudflare/partykit#429](https://github.com/cloudflare/partykit/issues/429) is fixed.

The tests go offline with the app's button, which disconnects the provider. Playwright's `context.setOffline` doesn't close a WebSocket that's already open, so it can't stand in for a dropped connection here.

## Files

- [`worker/index.ts`](worker/index.ts): the Worker, routing `/parties/docs/<room>` to a `YServer` Durable Object that saves the room's doc to its storage.
- [`src/sync.ts`](src/sync.ts): the room's `Y.Doc` with both providers, the Jotai store with `docAtom` set, and the online toggle.
- [`src/todos.ts`](src/todos.ts): the schema, the `collection` of todos and a progress projection.
- [`src/App.tsx`](src/App.tsx): the UI, reading and writing only through duratom atoms.
