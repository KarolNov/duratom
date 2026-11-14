## Purpose

Watch one located node of a `Y.Doc` and notify only when a projection of it changes, without depending on any state library.

## Requirements

### Requirement: Locate a node by path

A locator SHALL resolve a path of a root map or array and child map keys to the shared type at that path, or to nothing when any step is missing.

- **Scenario: Node created later**
  - **GIVEN** a subscription to a locator whose node does not exist yet
  - **WHEN** a peer creates the node
  - **THEN** subscribers are notified with the projection of the new node
- **Scenario: Node deleted**
  - **WHEN** the located node is removed from its parent map
  - **THEN** subscribers are notified with the projection of a missing node

### Requirement: Notify only on change

A subscription SHALL notify only after transactions that touch the located node (or, in deep mode, anything under it, or the listed keys when keys are given), and only when the new projection is not equal to the previous one; an equal projection keeps the previous reference.

- **Scenario: Unrelated edit**
  - **WHEN** a transaction changes another node of the doc
  - **THEN** no subscriber is notified
- **Scenario: Equal projection**
  - **WHEN** a transaction changes the node but the projection is equal
  - **THEN** no subscriber is notified and the value keeps its reference

### Requirement: Observe only while subscribed

A live value SHALL observe the doc only while it has subscribers; read without subscribers, it SHALL project the doc as it is now.

- **Scenario: Last subscriber leaves**
  - **WHEN** the last subscriber unsubscribes
  - **THEN** no observer remains on the doc

### Requirement: Filter by origin and event

A subscription SHALL ignore transactions its origin filter rejects and changes its event filter rejects; a skipped change is not remembered, and the value catches up at the next accepted change.

- **Scenario: Own writes ignored**
  - **GIVEN** an origin filter rejecting origin `local`
  - **WHEN** a transaction with origin `local` changes the node
  - **THEN** no subscriber is notified
