import type { StandardSchemaV1 } from '@standard-schema/spec'
import { AsyncValidationUnsupportedError } from './errors.js'

export function validate<Schema extends StandardSchemaV1>(
  schema: Schema,
  value: unknown,
): StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>> {
  const result = schema['~standard'].validate(value)
  if (isThenable(result)) {
    Promise.resolve(result).catch(() => {})
    throw new AsyncValidationUnsupportedError(schema['~standard'].vendor)
  }
  return result
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function'
