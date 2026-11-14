# duratom

Durable, live Jotai atoms over a Y.Doc: read typed values, write validated patches, and re-render only when what an atom shows changes.

Work in progress; not published yet.

## Entry points

- `duratom`: shape builders (`map`, `record`, `array`, `isMap`) that name which fields of a node are shared types.
- `duratom/core`: store-agnostic pieces, usable without Jotai.
  - Observation of one node of a Y.Doc: `live`, `observeLocated`, `at`, `select`, `shallowEqual`, `deepEqual`.
  - Typed reads and validated writes through any Standard Schema validator (zod, valibot, arktype): `read`, `reader`, `write`, and the errors `AsyncValidationUnsupportedError` and `UnsupportedValueError`.
