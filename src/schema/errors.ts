/**
 * Thrown by `read` and `write` when the schema's `~standard.validate` returns a Promise. The layer
 * validates synchronously only, so an async schema is a configuration error, not bad data.
 */
export class AsyncValidationUnsupportedError extends Error {
  readonly vendor: string

  constructor(vendor: string) {
    super(
      `The ${vendor} schema validated asynchronously, which duratom doesn't support. ` +
        'Use a schema with no async refinements or transforms.',
    )
    this.name = 'AsyncValidationUnsupportedError'
    this.vendor = vendor
  }
}

/**
 * Thrown by `write` when a plain field or `array()` item holds a value Yjs can't store faithfully: anything but
 * JSON values, `undefined` and `Uint8Array` bytes, a cycle, a `__proto__` key, or a `constructor`
 * key on the field's own object. The schema accepted it, so it's a schema that's too loose, not bad
 * data. Nothing is written.
 */
export class UnsupportedValueError extends Error {
  /** Where the value sits in the written value, starting at the field's key. */
  readonly path: readonly PropertyKey[]

  constructor(path: readonly PropertyKey[]) {
    super(
      `A Y.Map can't store the value written at ${path.map(String).join('.')} as written, so ` +
        'nothing was written. Use a schema that accepts only JSON values and bytes.',
    )
    this.name = 'UnsupportedValueError'
    this.path = path
  }
}
