## Purpose

Documentation that gets a person or an AI agent from install to a working synced app without reading the source.

## Requirements

### Requirement: Quick start

The README SHALL open with a quick start that goes from install to a typed, writable, live atom shown in a React component, in one runnable snippet.

- **Scenario: Copy and run**
  - **WHEN** the snippet is pasted into a new Vite React app with duratom installed
  - **THEN** it compiles and shows the value

### Requirement: Agent-readable docs

The repo and the published package SHALL include `llms.txt`, `llms-full.txt` and an agent skill describing the API, its rules (one doc per store, patches merge, results not exceptions) and common recipes.

- **Scenario: Agent installs the package**
  - **WHEN** an agent looks inside `node_modules/duratom`
  - **THEN** it finds the skill and `llms-full.txt`

### Requirement: Snippets stay correct

Every code snippet in the docs SHALL be type-checked in CI against the current source.

- **Scenario: API renamed**
  - **WHEN** an export is renamed without updating the docs
  - **THEN** CI fails

### Requirement: Persistence and sync recipes

The docs SHALL show how to persist a doc offline and sync it between devices with existing providers (y-indexeddb, y-partyserver), with duratom atoms unchanged.

- **Scenario: Adding sync**
  - **WHEN** a reader follows the sync recipe
  - **THEN** their atoms work as before with the doc now synced
