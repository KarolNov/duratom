export { deepEqual, shallowEqual } from './equality.js'
export { live, type Live, type LiveSpec } from './live.js'
export { at, Locator, type At } from './locator.js'
export { observeLocated, type ObserveOptions } from './observe.js'
export {
  ArrayPath,
  KeyPath,
  KeyValuePath,
  MapPath,
  select,
  type Projection,
  type ProjectOptions,
  type Selector,
} from './select.js'
export {
  AsyncValidationUnsupportedError,
  create,
  keyReader,
  read,
  reader,
  readKey,
  UnsupportedValueError,
  write,
  writeKey,
  type KeyReader,
  type Reader,
} from '../schema/index.js'
