# duratom

Durable, live Jotai atoms over a Y.Doc: read typed values, write validated patches, and re-render only when what an atom shows changes.

Work in progress; not published yet.

Peer dependencies: `yjs`, `jotai` 2.9 or later (`jotai-family` needs it), `jotai-family` and `react`.

## Entry points

- `duratom`: Jotai atoms over a Y.Doc.
  - `docAtom` holds the doc atoms read by default; set it once per store. Any atom takes `{ docAtom }` to read another doc.
  - `typedAtom(locator, Schema, shape)` is a writable atom over one `Y.Map`, read through any Standard Schema validator: `undefined` while the node is missing, `{ issues }` while it's invalid, `{ value }` otherwise. `set(patch)` or `set(prev => patch)` merges into the node as it is in the doc at write time, so a peer's concurrent edit to another field survives, and returns the schema's result; an invalid one changes nothing. On a node with no valid value the patch is the whole value, which creates a missing node or repairs an invalid one.
  - `liveAtom(spec)` is a read-only atom over one node that updates only when its projection changes. `select` and `at` build specs.
  - `collection(locator, Schema, shape)` covers a `Y.Map` of items. `ids` lists the item ids, sorted the same on every peer, and notifies only when an id is added or removed. `item(id)` is a `typedAtom` per item, from a `jotai-family` atom family. `create(value, id?)` validates a whole value and adds it under `id` or a random UUID, returning `{ value, id }` or `{ issues }`. `remove(id)` deletes an item and returns whether there was one.
  - Atoms follow the doc while subscribed (a component reading them, or `store.sub`). Read with `store.get` while nothing is subscribed, a `liveAtom` or `typedAtom` can be stale: Jotai keeps an unmounted atom's value until another atom it reads changes, and a doc edit isn't an atom change. A `typedAtom` does see its own writes. Use `live` from `duratom/core` to read the doc as it is now outside Jotai.
  - Shape builders (`map`, `record`, `array`, `isMap`) name which fields of a node are shared types.
- `duratom/react`: `useLiveAtom`, the hook form of `liveAtom`.
- `duratom/core`: store-agnostic pieces, usable without Jotai.
  - Observation of one node of a Y.Doc: `live`, `observeLocated`, `at`, `select`, `shallowEqual`, `deepEqual`.
  - Typed reads and validated writes through any Standard Schema validator (zod, valibot, arktype): `read`, `reader`, `write`, `create`, and the errors `AsyncValidationUnsupportedError` and `UnsupportedValueError`.
