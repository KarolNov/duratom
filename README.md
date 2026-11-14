# duratom

Durable, live Jotai atoms over a Y.Doc: read typed values, write validated patches, and re-render only when what an atom shows changes.

Work in progress; not published yet.

## Entry points

- `duratom`: Jotai atoms over a Y.Doc.
  - `docAtom` holds the doc atoms read by default; set it once per store. Any atom takes `{ docAtom }` to read another doc.
  - `typedAtom(locator, Schema, shape)` is a writable atom over one `Y.Map`, read through any Standard Schema validator: `undefined` while the node is missing, `{ issues }` while it's invalid, `{ value }` otherwise. `set(patch)` or `set(prev => patch)` merges into the node as it is in the doc at write time, so a peer's concurrent edit to another field survives, and returns the schema's result; an invalid one changes nothing. On a node with no valid value the patch is the whole value, which creates a missing node or repairs an invalid one.
  - `liveAtom(spec)` is a read-only atom over one node that updates only when its projection changes. `select` and `at` build specs.
  - Shape builders (`map`, `record`, `array`, `isMap`) name which fields of a node are shared types.
- `duratom/react`: `useLiveAtom`, the hook form of `liveAtom`.
- `duratom/core`: store-agnostic pieces, usable without Jotai.
  - Observation of one node of a Y.Doc: `live`, `observeLocated`, `at`, `select`, `shallowEqual`, `deepEqual`.
  - Typed reads and validated writes through any Standard Schema validator (zod, valibot, arktype): `read`, `reader`, `write`, `create`, and the errors `AsyncValidationUnsupportedError` and `UnsupportedValueError`.
