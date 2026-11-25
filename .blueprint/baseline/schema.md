## Purpose

Read a `Y.Map` as a typed value and write a value into it through any Standard Schema validator, changing only what differs.

## Requirements

### Requirement: Shape names the shared fields

A shape SHALL declare which fields are shared types (text, xml, nested map, record of maps, array); every other field SHALL be a plain value where the last writer wins.

- **Scenario: Text field**
  - **GIVEN** a shape declaring `title` as text
  - **WHEN** two peers type into `title` at once
  - **THEN** both edits are kept

### Requirement: Read validates

Reading a located node SHALL return nothing for a missing node, the layer's own issues for a node whose stored types do not match the shape, and otherwise the validator's own result for the projected value.

- **Scenario: Peer stored an invalid value**
  - **WHEN** a field holds a value the schema rejects
  - **THEN** the read returns the schema's issues and no value

### Requirement: Write validates before changing anything

Writing a value SHALL validate it first; an invalid value SHALL change nothing and return the issues; a valid one SHALL be applied in one transaction, changing only fields whose value differs.

- **Scenario: One field changed**
  - **WHEN** a value equal to the stored one except for `priority` is written
  - **THEN** only `priority` changes in the doc
- **Scenario: Invalid value**
  - **WHEN** a value the schema rejects is written
  - **THEN** the doc is unchanged and the issues are returned

### Requirement: Unsupported input is an error

Writing a value the doc cannot hold, or validating with a schema that validates asynchronously, SHALL throw a named error before anything is written.

- **Scenario: Async schema**
  - **WHEN** a schema returns a promise from validation
  - **THEN** an `AsyncValidationUnsupportedError` is thrown and the doc is unchanged

### Requirement: Read a key-value entry

Reading a key of a key-value array SHALL return nothing for a missing array or a key with no entry, the layer's own issue when the current value holds a shared type, and otherwise the validator's own result for the current value; a current value the schema rejects SHALL NOT fall back to an older entry.

- **Scenario: Invalid current value**
  - **GIVEN** the current entry for `tone` holds a value the schema rejects and an older entry holds a valid one
  - **WHEN** `tone` is read
  - **THEN** the read returns the schema's issues and no value

### Requirement: Write a key-value entry

Writing a key of a key-value array SHALL validate the value first; an invalid value SHALL change nothing and return the issues; a valid one SHALL be written as `YKeyValue#set` does, in one transaction: push `{ key, val }` and delete the key's older entries, leaving the array unchanged when its only entry for the key already holds an equal value.

- **Scenario: Shared with YKeyValue**
  - **GIVEN** a `YKeyValue` over the same array
  - **WHEN** `tone` is written
  - **THEN** the `YKeyValue` reads the new value and the array holds one entry for `tone`
- **Scenario: Equal value**
  - **WHEN** a value equal to the current one is written
  - **THEN** the doc is unchanged
