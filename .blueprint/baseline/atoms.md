## Purpose

Jotai atoms over a `Y.Doc`: live reads that re-render only on change, typed values, validated writes and collections of items.

## Requirements

### Requirement: One doc per store by default

Atoms SHALL read the doc from `docAtom` in the store they are used in, unless given their own doc atom; reading an atom with no doc set SHALL fail with an error naming `docAtom`.

- **Scenario: Two docs in one app**
  - **GIVEN** an atom built with its own doc atom
  - **WHEN** it is read
  - **THEN** it reads that doc, not the one in `docAtom`

### Requirement: Live atom

A live atom SHALL hold the projection of its located node, update when the projection changes, and observe the doc only while mounted.

- **Scenario: Re-render only on change**
  - **GIVEN** a component showing a live atom
  - **WHEN** a peer edits a different node
  - **THEN** the component does not re-render

### Requirement: Typed atom read

A typed atom SHALL read as `undefined` while its node is missing, `{ issues }` while the node does not satisfy the schema, and `{ value }` otherwise.

- **Scenario: Invalid data from a peer**
  - **WHEN** a peer stores a value the schema rejects
  - **THEN** the atom reads `{ issues }`

### Requirement: Typed atom write merges a patch

Setting a typed atom with a patch, or with a function of the current value, SHALL merge it into the node as it is in the doc at write time, keeping fields the patch omits and keys the schema does not know, and SHALL return the schema result; an invalid result SHALL change nothing.

- **Scenario: Concurrent edit survives**
  - **GIVEN** a peer has just changed `title`
  - **WHEN** this client sets `{ priority: 'high' }`
  - **THEN** the doc holds the peer's `title` and the new `priority`
- **Scenario: Invalid patch**
  - **WHEN** a patch makes the value invalid
  - **THEN** the doc is unchanged and the result holds the issues

### Requirement: Typed atom creates a missing node

Setting a typed atom whose node is missing but whose parent map exists SHALL treat the patch as the whole value and create the node when it is valid.

- **Scenario: First write**
  - **WHEN** a valid whole value is set on a missing node
  - **THEN** the node is created and the atom reads `{ value }`

### Requirement: Collection

A collection over a map of items SHALL offer an ids atom that changes only when items are added or removed, a typed atom per item id, `create` that validates a value and adds it under a given or generated id, and `remove`.

- **Scenario: Editing an item**
  - **WHEN** a field of one item changes
  - **THEN** the ids atom does not notify and only that item's atom does
- **Scenario: Create invalid**
  - **WHEN** `create` is called with an invalid value
  - **THEN** nothing is added and the issues are returned

### Requirement: React hook

`useLiveAtom` SHALL return the value of a live atom built from a spec or spec factory, and `useTypedAtom` SHALL return a typed atom's result and its setter, each rebuilding its atom only when its dependency list changes.

- **Scenario: Id changes**
  - **WHEN** the id in the dependency list changes
  - **THEN** the hook reads the node for the new id
