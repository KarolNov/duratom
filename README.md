# duratom

Durable, live Jotai atoms over a Y.Doc: read typed values, write validated patches, and re-render only when what an atom shows changes.

Work in progress; not published yet.

## Entry points

- `duratom/core`: store-agnostic observation of one node of a Y.Doc (`live`, `observeLocated`, `at`, `select`, `shallowEqual`, `deepEqual`). Use it without Jotai.
