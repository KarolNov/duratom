# duratom todo

A shared todo list in two panes, built on duratom's public API only. Each pane is one person with their own `Y.Doc` and Jotai store; the docs are linked in memory, so edits sync live without a server. Disconnect the link to edit both sides offline, then reconnect to watch them merge.

```sh
pnpm install
pnpm build                                    # builds duratom, which the example imports
pnpm --filter duratom-example-todo dev
```

- [`src/todos.ts`](src/todos.ts): the schema, the `collection` of todos, and a `select` projection counting what's done.
- [`src/App.tsx`](src/App.tsx): one store per person with `docAtom` set, and components reading `todos.ids`, `todos.item(id)` and `useLiveAtom`.
- [`src/link.ts`](src/link.ts): the in-memory link standing in for a sync provider.
