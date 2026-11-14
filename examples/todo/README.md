# duratom todo

A shared todo list in two panes, built on duratom's public API only. Each pane is one person with their own `Y.Doc` and Jotai store; the docs are linked in memory, so edits sync live without a server. Raise the latency slider to watch updates arrive late and edits made in the meantime merge. Disconnect the link to edit both sides offline, then reconnect to watch them merge. Tick "Show re-renders" (or open the page with `?scan`) to outline components with [react-scan](https://github.com/aidenybai/react-scan) as they re-render. Each component reads only what it shows: adding a todo re-renders the list and the new row, ticking one re-renders its checkbox and the counts, and typing re-renders only that title.

```sh
pnpm install
pnpm build                                    # builds duratom, which the example imports
pnpm --filter duratom-example-todo dev
```

- [`src/todos.ts`](src/todos.ts): the schema, the `collection` of todos, `select` selectors for one todo's title and done, a derived atom for whether a todo is readable, and a projection counting what's done.
- [`src/App.tsx`](src/App.tsx): one store per person with `docAtom` set, and components reading `todos.ids`, the selectors through `useLiveAtom`, and writing through `todos.item(id)`.
- [`src/link.ts`](src/link.ts): the in-memory link standing in for a sync provider.
