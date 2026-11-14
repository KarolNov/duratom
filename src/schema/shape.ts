import * as Y from 'yjs'

/**
 * Which fields of a node are Shared fields, and of what kind. Every key it doesn't mention is a
 * Plain field. Keys are constrained to the fields of `T`, the schema's output, in any member of a
 * union, and each kind to fields its read value can fill.
 */
export type Shape<T> = {
  readonly [K in KeyOf<T>]?: KindOf<FieldOf<T, K>>
}

/** A `map(shape)` field: a `Y.Map` with the fixed keys `shape` describes. */
export interface MapKind<S> {
  readonly kind: 'map'
  readonly shape: S
}

/** A `record(itemShape)` field: a `Y.Map` of item `Y.Map`s, each following `itemShape`. */
export interface RecordKind<S> {
  readonly kind: 'record'
  readonly shape: S
}

/** An `array()` field: a Shared array of plain values. */
export interface ArrayKind {
  readonly kind: 'array'
}

/** Any field object, the form every shape and nested shape takes. */
export type AnyShape = { readonly [key: string]: Kind | undefined }

export type Kind = 'text' | 'xml' | MapKind<AnyShape> | RecordKind<AnyShape> | ArrayKind

/** A nested `Y.Map` with the fixed keys `shape` describes, read as a plain object. */
export const map = <const S extends AnyShape>(shape: S): MapKind<S> =>
  Object.freeze({ kind: 'map', shape })

/** A `Y.Map` with dynamic keys whose every value is a `Y.Map` following `itemShape`. */
export const record = <const S extends AnyShape>(itemShape: S): RecordKind<S> =>
  Object.freeze({ kind: 'record', shape: itemShape })

const arrayKind: ArrayKind = Object.freeze({ kind: 'array' })

/** A `Y.Array` of plain values, read as a plain array. */
export const array = (): ArrayKind => arrayKind

/** The kinds a field of type `F` can be declared as. */
type KindOf<F> =
  | (string extends F ? 'text' : never)
  | (Y.XmlFragment extends F ? 'xml' : never)
  | ([ObjectOf<F>] extends [never] ? never : MapKind<Shape<ObjectOf<F>>>)
  | ([ItemOf<F>] extends [never] ? never : RecordKind<Shape<ItemOf<F>>>)
  | (unknown extends F
      ? ArrayKind
      : [Extract<F, readonly unknown[]>] extends [never]
        ? never
        : ArrayKind)

/** The plain-object members of `F`, which a `map` or `record` field reads as. */
type ObjectOf<F> = unknown extends F
  ? Record<string, unknown>
  : Exclude<
      Extract<F, object>,
      | readonly unknown[]
      | Y.AbstractType<any>
      | Uint8Array
      | ((...args: never) => unknown)
      | Date
      | RegExp
      | ReadonlyMap<any, any>
      | ReadonlySet<any>
      | WeakMap<any, any>
      | WeakSet<any>
      | PromiseLike<unknown>
    >

/** The plain-object items of the plain-object members of `F`, read as a `record`. */
type ItemOf<F> = ObjectOf<ObjectOf<F>[keyof ObjectOf<F>]>

/** The keys of every member of a union, not only the keys they share. `unknown` has any key. */
type KeyOf<T> = unknown extends T ? string : T extends unknown ? keyof T : never

/** The type of field `K` across the members of `T` that have it. */
type FieldOf<T, K> = unknown extends T
  ? unknown
  : T extends unknown
    ? K extends keyof T
      ? T[K]
      : never
    : never

/**
 * Rejects keys of `S` that `T` doesn't have, at every depth of nested `map` and `record` shapes,
 * also when the shape is declared apart from the call. `S` is constrained to `object` only:
 * against the all-optional `Shape<T>`, a shape with no key of `T` wouldn't infer as itself, and
 * its typo keys would go unchecked.
 */
export type Exact<S, T> = S &
  Shape<T> & {
    readonly [K in keyof S]: K extends KeyOf<T> ? ExactKind<S[K], FieldOf<T, K>> : never
  }

type ExactKind<V, F> =
  V extends MapKind<infer N>
    ? MapKind<Exact<N, ObjectOf<F>>>
    : V extends RecordKind<infer N>
      ? RecordKind<Exact<N, ItemOf<F>>>
      : V

/**
 * Whether a stored value is the `Y.Text` a `'text'` field holds. A Y.XmlText is a Y.Text whose
 * string is XML markup, and peers decode it as its own type, so it isn't one.
 */
export const isText = (stored: unknown): stored is Y.Text =>
  stored instanceof Y.Text && !(stored instanceof Y.XmlText)

/**
 * The shared type a `map`, `record` and `'xml'` kind is stored as. The Y.Xml types extend the
 * others but are decoded as their own types, so they match no kind but `'xml'`, which takes a
 * `Y.XmlFragment` only. `isText` does the same for `'text'`.
 */
export const isMap = (value: unknown): value is Y.Map<unknown> =>
  value instanceof Y.Map && !(value instanceof Y.XmlHook)
export const isXml = (value: unknown): value is Y.XmlFragment =>
  value instanceof Y.XmlFragment && !(value instanceof Y.XmlElement)

/**
 * The kind `read` and `write` take a declared shape value as, or `undefined` for one they take as a plain
 * field: `undefined`, and anything an untyped caller passes that isn't a kind.
 */
export function kindOf(declared: unknown): Kind | undefined {
  if (declared === 'text' || declared === 'xml') return declared
  if (declared === null || typeof declared !== 'object') return undefined
  const { kind, shape } = declared as { kind?: unknown; shape?: unknown }
  if (kind === 'array') return declared as ArrayKind
  if ((kind === 'map' || kind === 'record') && shape !== null && typeof shape === 'object')
    return declared as MapKind<AnyShape> | RecordKind<AnyShape>
  return undefined
}
