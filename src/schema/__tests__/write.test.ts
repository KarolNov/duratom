import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as Y from 'yjs'
import { z } from 'zod'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  array,
  AsyncValidationUnsupportedError,
  map,
  read,
  record,
  UnsupportedValueError,
  write,
} from '../index.js'

const Card = z.object({ title: z.string(), done: z.boolean(), meta: z.object({ n: z.number() }) })

const freshNode = () => new Y.Doc().getMap<unknown>('card')

describe('a valid write', () => {
  it('stores plain fields and returns the schema’s result', () => {
    const node = freshNode()
    const value = { title: 'hi', done: false, meta: { n: 1 } }
    expect(write(Card, {}, node, value)).toEqual({ value })
    expect(node.toJSON()).toEqual(value)
  })
})

describe('an invalid write', () => {
  it('returns the schema’s { issues } and changes nothing in the doc', () => {
    const node = freshNode()
    node.set('title', 'kept')
    const before = Y.encodeStateVector(node.doc!)
    const value = { title: 5, done: 'no', meta: {} } as never
    expect(write(Card, {}, node, value)).toEqual(Card['~standard'].validate(value))
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
    expect(node.toJSON()).toEqual({ title: 'kept' })
  })
})

describe('transactions', () => {
  it('apply a valid write in a single transaction', () => {
    const node = freshNode()
    let transactions = 0
    node.doc!.on('afterTransaction', () => transactions++)
    write(Card, {}, node, { title: 'hi', done: false, meta: { n: 1 } })
    expect(transactions).toBe(1)
  })

  it('take their origin from an outer doc.transact', () => {
    const node = freshNode()
    const origins: unknown[] = []
    node.doc!.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin))
    node.doc!.transact(
      () => write(Card, {}, node, { title: 'hi', done: false, meta: { n: 1 } }),
      'form',
    )
    expect(origins).toEqual(['form'])
  })
})

describe('a Y.Map not yet in a doc', () => {
  it('throws a TypeError, since its keys cannot be read to merge into', () => {
    const node = new Y.Map<unknown>()
    expect(() => write(Card, {}, node, { title: 'hi', done: false, meta: { n: 1 } })).toThrow(
      TypeError,
    )
  })
})

describe('a located node that is not a Y.Map', () => {
  const value = { title: 'hi', done: false, meta: { n: 1 } }

  it('throws a TypeError and writes nothing, since only its parent can replace it', () => {
    const doc = new Y.Doc()
    const text = new Y.Text('x')
    doc.getMap('root').set('node', text)
    expect(() => write(Card, {}, text as never, value)).toThrow(
      new TypeError(
        'write needs a Y.Map, not another shared type (a Y.XmlHook is one); write its parent to repair it.',
      ),
    )
    expect(text.toString()).toBe('x')
  })

  it('throws for a Y.XmlHook, which extends Y.Map but is decoded as its own type', () => {
    const doc = new Y.Doc()
    const hook = new Y.XmlHook('hook')
    doc.getMap('root').set('node', hook)
    const before = Y.encodeStateVector(doc)
    expect(() => write(Card, {}, hook, value)).toThrow(/write needs a Y.Map/)
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it('throws a TypeError naming a missing node for one that is not a shared type', () => {
    expect(() => write(Card, {}, undefined as never, value)).toThrow(
      new TypeError('write needs a located Y.Map; write its parent to create a missing one.'),
    )
  })
})

describe('a valid value that is not a field object', () => {
  it.each([
    ['null', null],
    ['a string', 'str'],
    ['an array', ['a']],
  ])('throws a TypeError for %s and writes nothing', (_, value) => {
    const node = freshNode()
    node.set('title', 'kept')
    expect(() => write(z.any(), {}, node, value)).toThrow(TypeError)
    expect(node.toJSON()).toEqual({ title: 'kept' })
  })
})

/** Exchanges updates both ways, so both docs hold every change either made. */
const syncDocs = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
}

describe('plain fields', () => {
  it('are left alone when deep-equal to the stored value', () => {
    const node = freshNode()
    write(Card, {}, node, { title: 'hi', done: false, meta: { n: 1 } })
    const before = Y.encodeStateVector(node.doc!)
    write(Card, {}, node, { meta: { n: 1 }, done: false, title: 'hi' })
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
  })

  it('keep a peer’s concurrent change to an unrelated field', () => {
    const a = freshNode()
    write(Card, {}, a, { title: 'hi', done: false, meta: { n: 1 } })
    const b = new Y.Doc().getMap<unknown>('card')
    // Of two concurrent sets of one key, the higher client id wins: a would, had it set `done`.
    a.doc!.clientID = 2
    b.doc!.clientID = 1
    syncDocs(a.doc!, b.doc!)
    b.set('done', true)
    write(Card, {}, a, { title: 'renamed', done: false, meta: { n: 1 } })
    syncDocs(a.doc!, b.doc!)
    expect(a.toJSON()).toEqual({ title: 'renamed', done: true, meta: { n: 1 } })
    expect(b.toJSON()).toEqual(a.toJSON())
  })
})

const Anything = z.object({ field: z.unknown() })

/** An object without a prototype, like `Object.groupBy` returns. */
const bare = (entries: Record<string, unknown>) => Object.assign(Object.create(null), entries)

/** Stores `stored` under `field`, writes `written` there, and says whether the doc changed. */
const changes = (stored: unknown, written: unknown) => {
  const node = freshNode()
  node.set('field', stored)
  const before = Y.encodeStateVector(node.doc!)
  expect(() => write(Anything, {}, node, { field: written })).not.toThrow()
  return !deepEqualBytes(Y.encodeStateVector(node.doc!), before)
}

const deepEqualBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, n) => byte === b[n])

describe.each([
  ['arrays', [1, { a: [2] }], [1, { a: [2] }]],
  ['bytes', new Uint8Array([1, 2]), new Uint8Array([1, 2])],
])('equal %s', (_, stored, written) => {
  it('are left alone', () => expect(changes(stored, written)).toBe(false))
})

describe.each([
  ['a nested number', { a: { n: 1 } }, { a: { n: 2 } }],
  ['a renamed key', { a: 1, b: undefined }, { a: 1, c: undefined }],
  ['an extra key', { a: 1 }, { a: 1, b: 2 }],
  ['a longer array', [1, 2], [1, 2, 3]],
  ['an array item', [1, 2], [1, 3]],
  ['different bytes', new Uint8Array([1, 2]), new Uint8Array([1, 3])],
  ['shorter bytes', new Uint8Array([1, 2]), new Uint8Array([1])],
  ['longer bytes', new Uint8Array([1]), new Uint8Array([1, 2])],
  ['a string for a number', 0, '0'],
  ['an object for null', null, {}],
  ['an array for an object', {}, []],
  ['bytes for an array', [1], new Uint8Array([1])],
])('%s', (_, stored, written) => {
  it('is written', () => expect(changes(stored, written)).toBe(true))
})

describe('a plain field', () => {
  it('equal to undefined is written when the key is missing', () => {
    const node = freshNode()
    write(Anything, {}, node, { field: undefined })
    expect(node.has('field')).toBe(true)
  })
})

/** A value nested `depth` levels deep, which recursion would overflow on. */
const nested = (depth: number) => {
  const root: { n?: object } = {}
  let at = root
  for (let level = 0; level < depth; level++) at = at.n = {}
  return root
}

describe('a deeply nested plain field', () => {
  it('compares without throwing', () => {
    let changed: boolean | undefined
    expect(() => (changed = changes(nested(20_000), nested(20_000)))).not.toThrow()
    expect(changed).toBe(false)
  })
})

describe('a cyclic plain field', () => {
  it('compares to an equal cycle without hanging', () => {
    const cycle = () => {
      const value: Record<string, unknown> = { a: 1 }
      value.self = value
      return value
    }
    expect(changes(cycle(), cycle())).toBe(false)
  }, 1000)
})

describe('keys absent from the value', () => {
  it('are deleted', () => {
    const Note = z.object({ title: z.string(), note: z.string().optional() })
    const node = freshNode()
    write(Note, {}, node, { title: 'hi', note: 'old' })
    write(Note, {}, node, { title: 'hi' })
    expect(node.toJSON()).toEqual({ title: 'hi' })
  })
})

const Doc = z.object({ title: z.string(), body: z.string() })
const docShape = { title: 'text' } as const

describe("'text' fields", () => {
  it('are created as a Y.Text when missing', () => {
    const node = freshNode()
    write(Doc, docShape, node, { title: 'hello', body: 'plain' })
    const title = node.get('title')
    expect(title).toBeInstanceOf(Y.Text)
    expect(String(title)).toBe('hello')
    expect(node.get('body')).toBe('plain')
  })
})

describe("an existing 'text' field", () => {
  const withTitle = (text: string) => {
    const node = freshNode()
    write(Doc, docShape, node, { title: text, body: '' })
    return { node, title: node.get('title') as Y.Text }
  }

  it('keeps its Y.Text and splices only the changed middle', () => {
    const { node, title } = withTitle('hello world, bye')
    const deltas: unknown[] = []
    title.observe((event) => deltas.push(event.delta))
    write(Doc, docShape, node, { title: 'hello Yjs, bye', body: '' })
    expect(node.get('title')).toBe(title)
    expect(title.toString()).toBe('hello Yjs, bye')
    expect(deltas).toEqual([[{ retain: 6 }, { delete: 5 }, { insert: 'Yjs' }]])
  })

  it('is left alone when its string is unchanged', () => {
    const { node } = withTitle('same')
    const before = Y.encodeStateVector(node.doc!)
    write(Doc, docShape, node, { title: 'same', body: '' })
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
  })

  it.each([
    ['grows at the end', 'abc', 'abcdef', [{ retain: 3 }, { insert: 'def' }]],
    ['shrinks at the start', 'abcdef', 'def', [{ delete: 3 }]],
    ['drops a letter', 'abcd', 'abd', [{ retain: 2 }, { delete: 1 }]],
    ['repeats a letter', 'aa', 'aaa', [{ retain: 2 }, { insert: 'a' }]],
    ['changes entirely', 'abc', 'xy', [{ delete: 3 }, { insert: 'xy' }]],
    ['empties', 'abc', '', [{ delete: 3 }]],
  ])('changes only what differs when it %s', (_, from, to, delta) => {
    const { node, title } = withTitle(from)
    const deltas: unknown[] = []
    title.observe((event) => deltas.push(event.delta))
    write(Doc, docShape, node, { title: to, body: '' })
    expect(node.get('title')).toBe(title)
    expect(title.toString()).toBe(to)
    expect(deltas).toEqual([delta])
  })

  it('keeps a peer’s concurrent typing elsewhere in the text', () => {
    const { node: a } = withTitle('hello world')
    const b = new Y.Doc().getMap<unknown>('card')
    syncDocs(a.doc!, b.doc!)
    ;(b.get('title') as Y.Text).insert(0, '>> ')
    write(Doc, docShape, a, { title: 'hello world!', body: '' })
    syncDocs(a.doc!, b.doc!)
    expect(String(a.get('title'))).toBe('>> hello world!')
    expect(String(b.get('title'))).toBe('>> hello world!')
  })

  it.each([
    ['the low half of a pair', 'a😀b', 'a😃b'],
    ['the high half of a pair', 'a😀b', 'a🈀b'],
    ['the low half of a pair that starts the text', '😀b', '😃b'],
    ['the high half of a pair that ends the text', 'a😀', 'a🈀'],
    ['the low half after the lowest high surrogate', 'a\u{10000}b', 'a\u{10001}b'],
    ['the low half after the highest high surrogate', 'a\u{10FC00}b', 'a\u{10FC01}b'],
    ['the high half before the lowest low surrogate', 'a\u{10000}b', 'a\u{10400}b'],
    ['the high half before the highest low surrogate', 'a\u{103FF}b', 'a\u{107FF}b'],
  ])('syncs intact when the change is only %s', (_, from, to) => {
    const { node: a } = withTitle(from)
    const b = new Y.Doc().getMap<unknown>('card')
    syncDocs(a.doc!, b.doc!)
    write(Doc, docShape, a, { title: to, body: '' })
    syncDocs(a.doc!, b.doc!)
    expect(String(a.get('title'))).toBe(to)
    expect(String(b.get('title'))).toBe(to)
  })
})

describe("a 'text' field holding an embed", () => {
  const withEmbed = (text: string, at: number) => {
    const node = freshNode()
    write(Doc, docShape, node, { title: text, body: '' })
    const title = node.get('title') as Y.Text
    title.insertEmbed(at, { image: 'x.png' })
    return { node, title }
  }

  it('keeps the embed when the string is unchanged', () => {
    const { node, title } = withEmbed('hello world', 5)
    let events = 0
    title.observe(() => events++)
    write(Doc, docShape, node, { title: 'hello world', body: 'changed' })
    expect(events).toBe(0)
    expect(title.toDelta()).toEqual([
      { insert: 'hello' },
      { insert: { image: 'x.png' } },
      { insert: ' world' },
    ])
  })

  it.each([
    [
      'after the change',
      'abcdef',
      5,
      'aXcdef',
      [{ insert: 'aXcde' }, { insert: { image: 'x.png' } }, { insert: 'f' }],
    ],
    [
      'before the change',
      'abcdef',
      1,
      'abcdXf',
      [{ insert: 'a' }, { insert: { image: 'x.png' } }, { insert: 'bcdXf' }],
    ],
    [
      'right before the changed middle',
      'abcdef',
      2,
      'abXdef',
      [{ insert: 'ab' }, { insert: { image: 'x.png' } }, { insert: 'Xdef' }],
    ],
    [
      'right after the changed middle',
      'abcdef',
      3,
      'abXdef',
      [{ insert: 'abX' }, { insert: { image: 'x.png' } }, { insert: 'def' }],
    ],
  ])('keeps an embed %s, splicing only the middle', (_, from, at, to, delta) => {
    const { node, title } = withEmbed(from, at)
    write(Doc, docShape, node, { title: to, body: '' })
    expect(title.toDelta()).toEqual(delta)
  })

  it('drops an embed inside the replaced middle', () => {
    const { node, title } = withEmbed('abcdef', 3)
    write(Doc, docShape, node, { title: 'abXYef', body: '' })
    expect(title.toDelta()).toEqual([{ insert: 'abXYef' }])
  })

  it('reads back what was written', () => {
    const node = freshNode()
    write(Doc, docShape, node, { title: 'ab', body: '' })
    const title = node.get('title') as Y.Text
    title.insertEmbed(1, { image: 'x.png' })
    write(Doc, docShape, node, { title: 'abc', body: '' })
    expect(node.get('title')).toBe(title)
    expect(title.toString()).toBe('abc')
  })
})

describe("a 'text' field written with a value that isn't a string", () => {
  it('throws a TypeError and writes nothing, since it would read back as a shape mismatch', () => {
    const Loose = z.object({ title: z.union([z.string(), z.number()]), done: z.boolean() })
    const node = freshNode()
    node.set('title', new Y.Text('old'))
    expect(() => write(Loose, { title: 'text' }, node, { title: 7, done: true })).toThrow(TypeError)
    expect((node.get('title') as Y.Text).toString()).toBe('old')
    expect(node.has('done')).toBe(false)
  })

  it('is deleted when the value is null, so it reads back as empty', () => {
    const Nullable = z.object({ title: z.string().nullable() })
    const node = freshNode()
    node.set('title', new Y.Text('old'))
    write(Nullable, { title: 'text' }, node, { title: null })
    expect(node.has('title')).toBe(false)
    expect(read(z.object({ title: z.string() }), { title: 'text' }, node)).toEqual({
      value: { title: '' },
    })
  })

  it('is deleted when the value is undefined, so it reads back as empty', () => {
    const Optional = z.object({ title: z.string().optional() })
    const node = freshNode()
    node.set('title', new Y.Text('old'))
    write(Optional, { title: 'text' }, node, { title: undefined })
    expect(node.has('title')).toBe(false)
    expect(read(Optional, { title: 'text' }, node)).toEqual({ value: { title: '' } })
  })

  it('changes nothing when the value is undefined and the field is missing', () => {
    const Optional = z.object({ title: z.string().optional() })
    const node = freshNode()
    let updates = 0
    node.doc!.on('update', () => updates++)
    write(Optional, { title: 'text' }, node, { title: undefined })
    expect(node.has('title')).toBe(false)
    expect(updates).toBe(0)
  })

  it('repairs a plain undefined already stored, when the value is undefined', () => {
    const Optional = z.object({ title: z.string().optional() })
    const node = freshNode()
    node.set('title', undefined)
    write(Optional, { title: 'text' }, node, { title: undefined })
    expect(node.has('title')).toBe(false)
    expect(read(Optional, { title: 'text' }, node)).toEqual({ value: { title: '' } })
  })
})

describe('a schema that transforms', () => {
  it('has the value stored as given, not its output', () => {
    const Dated = z.object({ at: z.string().transform((at) => new Date(at)) })
    const node = freshNode()
    const result = write(Dated, {}, node, { at: '2026-01-01' } as never)
    expect(result).toEqual({ value: { at: new Date('2026-01-01') } })
    expect(node.get('at')).toBe('2026-01-01')
  })
})

describe('a schema that validates asynchronously', () => {
  it('throws the async-unsupported error naming the vendor and writes nothing', async () => {
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'slowlib',
        validate: () => Promise.reject(new Error('x')),
      },
    }
    const node = freshNode()
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', listener)
    try {
      expect(() => write(schema, {}, node, { title: 'x' })).toThrow(
        new AsyncValidationUnsupportedError('slowlib'),
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', listener)
    }
    expect(unhandled).toEqual([])
    expect(node.size).toBe(0)
  })
})

describe('types', () => {
  it('accept the read’s output as the written value', () => {
    const node = freshNode()
    const result = read(Doc, docShape, node)
    if (result && 'value' in result) write(Doc, docShape, node, result.value)
    expectTypeOf(write<typeof Doc, typeof docShape>)
      .parameter(3)
      .toEqualTypeOf<{ title: string; body: string }>()
  })

  it('reject a shape key not in the schema’s output', () => {
    // @ts-expect-error `titel` is not a field of the schema's output
    write(Doc, { titel: 'text' }, freshNode(), { title: '', body: '' })
    const typoOnly = { titel: 'text' } as const
    // @ts-expect-error a shape whose only key is a typo, declared apart from the call
    write(Doc, typoOnly, freshNode(), { title: '', body: '' })
  })

  it('return the schema’s result', () => {
    expectTypeOf(write(Doc, docShape, freshNode(), { title: '', body: '' })).toEqualTypeOf<
      StandardSchemaV1.Result<{ title: string; body: string }>
    >()
  })
})

describe('a written value mutated in place', () => {
  it('reaches peers when written again', () => {
    const a = freshNode()
    const b = new Y.Doc().getMap<unknown>('card')
    const value = { title: 'hi', done: false, meta: { n: 1 } }
    write(Card, {}, a, value)
    syncDocs(a.doc!, b.doc!)
    value.meta.n = 2
    write(Card, {}, a, value)
    syncDocs(a.doc!, b.doc!)
    expect(b.toJSON()).toEqual({ title: 'hi', done: false, meta: { n: 2 } })
  })
})

describe('a plain field a Y.Map cannot store faithfully', () => {
  class Point {
    x = 1
  }
  const cyclic = () => {
    const value: Record<string, unknown> = { a: 1 }
    value.self = value
    return value
  }

  it.each([
    ['a Date', new Date(0), ['field']],
    ['a Date nested in an object', { at: new Date(0) }, ['field', 'at']],
    ['a class instance in an array', [1, new Point()], ['field', 1]],
    ['a Map', new Map(), ['field']],
    ['a function', () => 1, ['field']],
    ['a symbol', Symbol('s'), ['field']],
    ['a bigint', 1n, ['field']],
    ['a shared type it does not already hold', new Y.Map(), ['field']],
    ['a cycle', cyclic(), ['field', 'self']],
    ['an own constructor key', { constructor: 'c' }, ['field', 'constructor']],
    [
      'an own constructor key without a prototype',
      bare({ constructor: 'c' }),
      ['field', 'constructor'],
    ],
    [
      'an own __proto__ key',
      JSON.parse('{"a":{"__proto__":{"evil":1}}}'),
      ['field', 'a', '__proto__'],
    ],
    [
      'an own __proto__ key without a prototype',
      Object.defineProperty(Object.create(null), '__proto__', { value: 1, enumerable: true }),
      ['field', '__proto__'],
    ],
  ])('throws for %s, naming its path, and writes nothing', (_, field, path) => {
    const node = freshNode()
    node.set('title', 'kept')
    node.set('gone', 1)
    const before = Y.encodeStateAsUpdate(node.doc!)
    let thrown: unknown
    try {
      write(z.object({ title: z.string(), field: z.any() }), {}, node, { title: 'changed', field })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(UnsupportedValueError)
    expect((thrown as UnsupportedValueError).path).toEqual(path)
    expect(Y.encodeStateAsUpdate(node.doc!)).toEqual(before)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['nested JSON with bytes', { a: [true, 'x', 1.5, null, new Uint8Array([1])], b: {} }],
    ['a sparse array', [1, , 3]],
    ['a nested constructor key', { a: { constructor: 'c' } }],
    ['an object reused twice', ((shared) => ({ a: shared, b: shared }))({ n: 1 })],
  ])('stores %s', (_, field) => {
    const node = freshNode()
    expect(() => write(Anything, {}, node, { field })).not.toThrow()
    expect(node.has('field')).toBe(true)
    expect(node.get('field')).toEqual(field)
  })

  it('is left alone when it is the shared type already stored', () => {
    const node = freshNode()
    const inner = new Y.Map<unknown>()
    node.set('field', inner)
    expect(() => write(Anything, {}, node, { field: inner })).not.toThrow()
    expect(node.get('field')).toBe(inner)
  })
})

describe('a deeply nested plain field that changed', () => {
  it('is written without throwing', () => {
    const node = freshNode()
    expect(() => write(Anything, {}, node, { field: nested(20_000) })).not.toThrow()
    expect(node.has('field')).toBe(true)
  }, 2000)
})

describe("a missing 'text' field written as ''", () => {
  it('stays missing, since it already reads as empty', () => {
    const node = freshNode()
    write(Doc, docShape, node, { title: '', body: 'x' })
    expect(node.has('title')).toBe(false)
    expect(read(Doc, docShape, node)).toEqual({ value: { title: '', body: 'x' } })
  })

  it('still replaces a plain value stored there', () => {
    const node = freshNode()
    node.set('title', 'plain')
    write(Doc, docShape, node, { title: '', body: '' })
    expect(read(Doc, docShape, node)).toEqual({ value: { title: '', body: '' } })
  })

  it('leaves a peer’s concurrent first text in place', () => {
    const a = freshNode()
    const b = new Y.Doc().getMap<unknown>('card')
    a.doc!.clientID = 1
    b.doc!.clientID = 2
    write(Doc, docShape, a, { title: 'hello', body: '' })
    write(Doc, docShape, b, { title: '', body: 'from b' })
    syncDocs(a.doc!, b.doc!)
    expect(read(Doc, docShape, b)).toEqual({ value: { title: 'hello', body: 'from b' } })
  })
})

describe('an object without a prototype', () => {
  it('is stored and synced when nested in a plain field', () => {
    const a = freshNode()
    const b = new Y.Doc().getMap<unknown>('card')
    expect(() => write(Anything, {}, a, { field: { groups: bare({ open: [1] }) } })).not.toThrow()
    syncDocs(a.doc!, b.doc!)
    expect(b.toJSON()).toEqual({ field: { groups: { open: [1] } } })
  })

  it('is stored when it is a plain field', () => {
    const node = freshNode()
    expect(() => write(Anything, {}, node, { field: bare({ a: 1 }) })).not.toThrow()
    expect(node.toJSON()).toEqual({ field: { a: 1 } })
  })

  it('equals the same plain object, so rewriting it changes nothing', () =>
    expect(changes({ a: { b: 1 } }, bare({ a: bare({ b: 1 }) }))).toBe(false))

  it('is merged when it is the whole value', () => {
    const node = freshNode()
    expect(() => write(Anything, {}, node, bare({ field: 1 }))).not.toThrow()
    expect(node.toJSON()).toEqual({ field: 1 })
  })
})

const Board = z.object({
  title: z.string(),
  settings: z.object({ theme: z.string(), caption: z.string() }),
  cards: z.record(z.string(), z.object({ title: z.string(), done: z.boolean() })),
  tags: z.array(z.string()),
  notes: z.instanceof(Y.XmlFragment).optional(),
})
type Board = z.infer<typeof Board>

const boardShape = {
  title: 'text',
  settings: map({ caption: 'text' }),
  cards: record({ title: 'text' }),
  tags: array(),
  notes: 'xml',
} as const

const board = (changes: Partial<Board> = {}): Board => ({
  title: 'Board',
  settings: { theme: 'dark', caption: 'Hello' },
  cards: { a: { title: 'Card a', done: false }, b: { title: 'Card b', done: true } },
  tags: ['x', 'y'],
  ...changes,
})

/** Reads `node` as a board, without its 'xml' field, which reads as the fragment itself. */
const readBoard = (node: Y.Map<unknown>) => {
  const result = read(Board, boardShape, node)
  if (!result || result.issues) throw new Error(`unexpected read: ${JSON.stringify(result)}`)
  const { notes: _, ...rest } = result.value
  return rest
}

describe('a first write of a nested value', () => {
  it('creates each missing Shared field with its declared kind', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    const settings = node.get('settings') as Y.Map<unknown>
    const cards = node.get('cards') as Y.Map<Y.Map<unknown>>
    expect(settings).toBeInstanceOf(Y.Map)
    expect(settings.get('caption')).toBeInstanceOf(Y.Text)
    expect(cards).toBeInstanceOf(Y.Map)
    expect(cards.get('a')).toBeInstanceOf(Y.Map)
    expect(cards.get('a')!.get('title')).toBeInstanceOf(Y.Text)
    expect(node.get('tags')).toBeInstanceOf(Y.Array)
    expect(node.get('notes')).toBeInstanceOf(Y.XmlFragment)
    expect(readBoard(node)).toEqual(board())
  })

  it('leaves out a missing map, record or array() written as its empty value, as it reads', () => {
    const Empty = z.object({
      settings: z.object({ caption: z.string() }),
      cards: z.record(z.string(), z.object({})),
      tags: z.array(z.string()),
    })
    const shape = { settings: map({ caption: 'text' }), cards: record({}), tags: array() }
    const node = freshNode()
    write(Empty, shape, node, { settings: { caption: '' }, cards: {}, tags: [] })
    expect([...node.keys()]).toEqual([])
    expect(read(Empty, shape, node)).toEqual({
      value: { settings: { caption: '' }, cards: {}, tags: [] },
    })
  })
})

describe('an existing map field', () => {
  it('keeps its Y.Map and the nested Y.Text of an unchanged field', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    const settings = node.get('settings') as Y.Map<unknown>
    const caption = settings.get('caption')
    write(Board, boardShape, node, board({ settings: { theme: 'light', caption: 'Hello' } }))
    expect(node.get('settings')).toBe(settings)
    expect(settings.get('caption')).toBe(caption)
    expect(readBoard(node).settings).toEqual({ theme: 'light', caption: 'Hello' })
  })

  it('changes nothing when written with an equal value', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    const before = Y.encodeStateVector(node.doc!)
    write(Board, boardShape, node, board())
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
  })

  it('has a key absent from the written value deleted', () => {
    const node = freshNode()
    const Settings = z.object({ settings: z.object({ theme: z.string().optional() }) })
    const shape = { settings: map({}) }
    write(Settings, shape, node, { settings: { theme: 'dark' } })
    write(Settings, shape, node, { settings: {} })
    expect((node.get('settings') as Y.Map<unknown>).has('theme')).toBe(false)
  })

  it('keeps a peer’s concurrent change to another of its keys', () => {
    const a = freshNode()
    write(Board, boardShape, a, board())
    const b = new Y.Doc().getMap<unknown>('card')
    syncDocs(a.doc!, b.doc!)
    ;(b.get('settings') as Y.Map<unknown>).set('theme', 'light')
    write(Board, boardShape, a, board({ settings: { theme: 'dark', caption: 'Hello there' } }))
    syncDocs(a.doc!, b.doc!)
    expect(readBoard(a).settings).toEqual({ theme: 'light', caption: 'Hello there' })
    expect(readBoard(b)).toEqual(readBoard(a))
  })
})

describe('an existing record field', () => {
  it('keeps the Y.Map of each item and of each unchanged nested field', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    const cards = node.get('cards') as Y.Map<Y.Map<unknown>>
    const a = cards.get('a')!
    const title = a.get('title')
    write(
      Board,
      boardShape,
      node,
      board({ cards: { ...board().cards, a: { title: 'Card a', done: true } } }),
    )
    expect(node.get('cards')).toBe(cards)
    expect(cards.get('a')).toBe(a)
    expect(a.get('title')).toBe(title)
    expect(readBoard(node).cards.a).toEqual({ title: 'Card a', done: true })
  })

  it('deletes an item the written value doesn’t have', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    write(Board, boardShape, node, board({ cards: { a: board().cards.a! } }))
    expect((node.get('cards') as Y.Map<unknown>).has('b')).toBe(false)
    expect(Object.keys(readBoard(node).cards)).toEqual(['a'])
  })

  it('creates a new item as a Y.Map following the item shape', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    write(
      Board,
      boardShape,
      node,
      board({ cards: { ...board().cards, c: { title: 'New', done: false } } }),
    )
    const c = (node.get('cards') as Y.Map<Y.Map<unknown>>).get('c')!
    expect(c).toBeInstanceOf(Y.Map)
    expect(c.get('title')).toBeInstanceOf(Y.Text)
    expect(c.get('done')).toBe(false)
  })

  it('creates a new item whose fields are all empty, since the item itself exists', () => {
    const node = freshNode()
    const Items = z.object({ items: z.record(z.string(), z.object({ title: z.string() })) })
    write(Items, { items: record({ title: 'text' }) }, node, { items: { a: { title: '' } } })
    expect((node.get('items') as Y.Map<unknown>).get('a')).toBeInstanceOf(Y.Map)
    expect(read(Items, { items: record({ title: 'text' }) }, node)).toEqual({
      value: { items: { a: { title: '' } } },
    })
  })

  it('keeps a peer’s concurrent edit to another item', () => {
    const a = freshNode()
    write(Board, boardShape, a, board())
    const b = new Y.Doc().getMap<unknown>('card')
    syncDocs(a.doc!, b.doc!)
    const cardB = (b.get('cards') as Y.Map<Y.Map<unknown>>).get('b')!
    ;(cardB.get('title') as Y.Text).insert(6, ' (edited)')
    write(
      Board,
      boardShape,
      a,
      board({ cards: { ...board().cards, a: { title: 'Card a!', done: false } } }),
    )
    syncDocs(a.doc!, b.doc!)
    expect(readBoard(a).cards).toEqual({
      a: { title: 'Card a!', done: false },
      b: { title: 'Card b (edited)', done: true },
    })
    expect(readBoard(b)).toEqual(readBoard(a))
  })
})

describe('a plain field written as undefined in a missing map', () => {
  it('leaves the map missing', () => {
    const node = freshNode()
    write(z.any(), { meta: map({}) }, node, { meta: { note: undefined } })
    expect(node.has('meta')).toBe(false)
  })
})

describe('a record item written as null or undefined', () => {
  it.each([null, undefined])('is deleted when written as %s', (item) => {
    const node = freshNode()
    const shape = { cards: record({}) }
    write(z.any(), shape, node, { cards: { a: { n: 1 }, b: { n: 2 } } })
    write(z.any(), shape, node, { cards: { a: item, b: { n: 2 } } })
    expect(node.toJSON()).toEqual({ cards: { b: { n: 2 } } })
  })
})

describe('a map, record or array() field written as null or undefined', () => {
  it.each([
    ['map', map({}), { theme: 'dark' }],
    ['record', record({}), { a: {} }],
    ['array', array(), [1]],
  ])('is deleted for %s, so it reads back as empty', (_, kind, value) => {
    const node = freshNode()
    write(Anything, { field: kind } as never, node, { field: value })
    expect(node.has('field')).toBe(true)
    write(Anything, { field: kind } as never, node, { field: undefined })
    expect(node.has('field')).toBe(false)
    write(Anything, { field: kind } as never, node, { field: value })
    write(Anything, { field: kind } as never, node, { field: null })
    expect(node.has('field')).toBe(false)
  })
})

describe('a Shared field written with a value it cannot be stored from', () => {
  it.each([
    ['a map from a string', { field: map({}) }, { field: 'x' }, ['field']],
    ['a map from an array', { field: map({}) }, { field: [] }, ['field']],
    ['a record from a number', { field: record({}) }, { field: 1 }, ['field']],
    ['a record item from a string', { field: record({}) }, { field: { a: 'x' } }, ['field', 'a']],
    ['an array() from an object', { field: array() }, { field: { a: 1 } }, ['field']],
    [
      'a nested text from a number',
      { field: map({ t: 'text' }) },
      { field: { t: 1 } },
      ['field', 't'],
    ],
  ])('throws a TypeError for %s and writes nothing', (_, shape, value, path) => {
    const node = freshNode()
    node.set('kept', 1)
    const before = Y.encodeStateAsUpdate(node.doc!)
    expect(() => write(z.any(), shape as never, node, { ...value, other: 2 })).toThrow(
      `store ${JSON.stringify(path)} `,
    )
    expect(Y.encodeStateAsUpdate(node.doc!)).toEqual(before)
  })

  it.each([
    ['a nested plain field', { field: map({}) }, { field: { at: new Date(0) } }, ['field', 'at']],
    ['an array() item', { field: array() }, { field: [1, new Date(0)] }, ['field', 1]],
    [
      'a record item’s field',
      { field: record({}) },
      { field: { a: { n: 1n } } },
      ['field', 'a', 'n'],
    ],
    [
      'an array() item’s own constructor key',
      { field: array() },
      { field: [{ constructor: 'c' }] },
      ['field', 0, 'constructor'],
    ],
    ['an undefined array() item', { field: array() }, { field: [1, undefined] }, ['field', 1]],
    ['a hole in an array() field', { field: array() }, { field: [1, , 2] }, ['field', 1]],
  ])(
    'throws UnsupportedValueError for %s, naming its path, and writes nothing',
    (_, shape, value, path) => {
      const node = freshNode()
      const before = Y.encodeStateAsUpdate(node.doc!)
      let thrown: unknown
      try {
        write(z.any(), shape as never, node, { ...value, other: 2 })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(UnsupportedValueError)
      expect((thrown as UnsupportedValueError).path).toEqual(path)
      expect(Y.encodeStateAsUpdate(node.doc!)).toEqual(before)
    },
  )
})

describe('an existing array() field', () => {
  const Tags = z.object({ tags: z.array(z.unknown()) })
  const tagsShape = { tags: array() }

  it('keeps its Y.Array and changes nothing when written with an equal value', () => {
    const node = freshNode()
    write(Tags, tagsShape, node, { tags: [{ n: 1 }, [2], 'x'] })
    const tags = node.get('tags')
    const before = Y.encodeStateVector(node.doc!)
    write(Tags, tagsShape, node, { tags: [{ n: 1 }, [2], 'x'] })
    expect(node.get('tags')).toBe(tags)
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
  })

  it('splices only the changed middle, comparing items by deep equality', () => {
    const node = freshNode()
    write(Tags, tagsShape, node, { tags: [{ n: 1 }, 'b', 'c', { n: 4 }] })
    const tags = node.get('tags') as Y.Array<unknown>
    const deleted: number[] = []
    const inserted: unknown[] = []
    tags.observe((event) => {
      for (const change of event.changes.delta) {
        if (change.delete) deleted.push(change.delete)
        if (change.insert) inserted.push(...(change.insert as unknown[]))
      }
    })
    write(Tags, tagsShape, node, { tags: [{ n: 1 }, 'B', { n: 4 }] })
    expect(deleted).toEqual([2])
    expect(inserted).toEqual(['B'])
    expect(tags.toArray()).toEqual([{ n: 1 }, 'B', { n: 4 }])
  })

  it('stores a copy of each inserted item', () => {
    const node = freshNode()
    const item = { n: 1 }
    write(Tags, tagsShape, node, { tags: [item] })
    item.n = 2
    expect(read(Tags, tagsShape, node)).toEqual({ value: { tags: [{ n: 1 }] } })
  })

  it('merges two peers’ concurrent appends, with both items and no duplicates', () => {
    const a = freshNode()
    write(Tags, tagsShape, a, { tags: ['x'] })
    const b = new Y.Doc().getMap<unknown>('card')
    syncDocs(a.doc!, b.doc!)
    write(Tags, tagsShape, a, { tags: ['x', 'from a'] })
    write(Tags, tagsShape, b, { tags: ['x', 'from b'] })
    syncDocs(a.doc!, b.doc!)
    const tags = (read(Tags, tagsShape, a) as { value: { tags: unknown[] } }).value.tags
    expect(tags).toHaveLength(3)
    expect(new Set(tags)).toEqual(new Set(['x', 'from a', 'from b']))
    expect(read(Tags, tagsShape, b)).toEqual(read(Tags, tagsShape, a))
  })

  it('doesn’t resurrect items two peers remove concurrently', () => {
    const a = freshNode()
    write(Tags, tagsShape, a, { tags: ['w', 'x', 'y', 'z'] })
    const b = new Y.Doc().getMap<unknown>('card')
    syncDocs(a.doc!, b.doc!)
    write(Tags, tagsShape, a, { tags: ['w', 'y', 'z'] })
    write(Tags, tagsShape, b, { tags: ['w', 'x', 'z'] })
    syncDocs(a.doc!, b.doc!)
    expect(read(Tags, tagsShape, a)).toEqual({ value: { tags: ['w', 'z'] } })
    expect(read(Tags, tagsShape, b)).toEqual({ value: { tags: ['w', 'z'] } })
  })
})

describe("an 'xml' field", () => {
  const Notes = z.object({ notes: z.unknown().optional() })
  const notesShape = { notes: 'xml' } as const

  it('is created empty when missing, whatever the value holds for it', () => {
    for (const value of [{ notes: 'text' }, { notes: undefined }, {}]) {
      const node = freshNode()
      write(Notes, notesShape, node, value)
      const notes = node.get('notes') as Y.XmlFragment
      expect(notes).toBeInstanceOf(Y.XmlFragment)
      expect(notes.length).toBe(0)
    }
  })

  it.each([
    ['its own fragment', (notes: Y.XmlFragment) => ({ notes })],
    ['another fragment', () => ({ notes: new Y.XmlFragment() })],
    ['a string', () => ({ notes: '<p>replaced</p>' })],
    ['undefined', () => ({ notes: undefined })],
    ['no key', () => ({})],
  ])('keeps the same instance and content when the value holds %s', (_, valueOf) => {
    const node = freshNode()
    write(Notes, notesShape, node, {})
    const notes = node.get('notes') as Y.XmlFragment
    const paragraph = new Y.XmlElement('p')
    paragraph.insert(0, [new Y.XmlText('editor content')])
    notes.insert(0, [paragraph])
    const before = Y.encodeStateVector(node.doc!)
    write(Notes, notesShape, node, valueOf(notes))
    expect(node.get('notes')).toBe(notes)
    expect(notes.toString()).toBe('<p>editor content</p>')
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
  })

  it('leaves the missing map it is declared in missing when nothing else is stored in it', () => {
    const node = freshNode()
    const shape = { meta: map({ notes: 'xml' }) }
    write(
      z.object({ meta: z.object({ notes: z.instanceof(Y.XmlFragment).optional() }) }),
      shape,
      node,
      { meta: {} },
    )
    expect(node.has('meta')).toBe(false)
  })

  it('is created in the missing map it is declared in when the map is created', () => {
    const node = freshNode()
    const shape = { meta: map({ notes: 'xml' }) }
    write(
      z.object({
        meta: z.object({ n: z.number(), notes: z.instanceof(Y.XmlFragment).optional() }),
      }),
      shape,
      node,
      { meta: { n: 1 } },
    )
    expect((node.get('meta') as Y.Map<unknown>).get('notes')).toBeInstanceOf(Y.XmlFragment)
  })
})

describe('a nested write', () => {
  it('applies in a single transaction', () => {
    const node = freshNode()
    let transactions = 0
    node.doc!.on('afterTransaction', () => transactions++)
    write(Board, boardShape, node, board())
    expect(transactions).toBe(1)
  })

  it('round-trips the read’s value without changing the doc', () => {
    const node = freshNode()
    write(Board, boardShape, node, board())
    const before = Y.encodeStateVector(node.doc!)
    const value = read(Board, boardShape, node) as { value: Board }
    write(Board, boardShape, node, value.value)
    expect(Y.encodeStateVector(node.doc!)).toEqual(before)
  })

  it('writes nesting as deep as a self-referential shape allows without overflowing', () => {
    const tree: { name: string; child?: unknown } = { name: 'text' }
    tree.child = map(tree as never)
    let value: Record<string, unknown> = { name: 'leaf' }
    for (let depth = 0; depth < 20_000; depth++) value = { name: 'n', child: value }
    const node = freshNode()
    expect(() => write(z.any(), tree as never, node, value)).not.toThrow()
    let inner = node
    for (let depth = 0; depth < 20_000; depth++) inner = inner.get('child') as Y.Map<unknown>
    expect((inner.get('name') as Y.Text).toString()).toBe('leaf')
  }, 5000)
})

describe('types', () => {
  it('accept a nested value typed as the read’s output', () => {
    const node = freshNode()
    const result = read(Board, boardShape, node)
    if (result && !result.issues) write(Board, boardShape, node, result.value)
    expectTypeOf(write(Board, boardShape, node, board())).toEqualTypeOf<
      StandardSchemaV1.Result<Board>
    >()
  })
})

describe('a write over a Shape mismatch', () => {
  // A wrong kind for every declared kind but the one it is stored under.
  const wrong = {
    plain: () => 'plain',
    'a Y.Text': () => new Y.Text('wrong'),
    'a Y.XmlText': () => new Y.XmlText('wrong'),
    'a Y.Map': () => new Y.Map(),
    'a Y.Array': () => new Y.Array(),
    'a Y.XmlFragment': () => new Y.XmlFragment(),
    'a Y.XmlElement': () => new Y.XmlElement('p'),
    'a Y.XmlHook': () => new Y.XmlHook('hook'),
    'a Y.Doc': () => new Y.Doc(),
  }
  type Wrong = keyof typeof wrong
  const all = Object.keys(wrong) as Wrong[]
  const except = (...right: Wrong[]) => all.filter((name) => !right.includes(name))

  it.each(
    except('a Y.Text').flatMap((name) => [
      [name, 'written'],
      [name, ''],
    ]) as [Wrong, string][],
  )("replaces %s under a 'text' field with a Y.Text, written as %j", (name, value) => {
    const node = freshNode()
    node.set('field', wrong[name]())
    write(Anything, { field: 'text' }, node, { field: value })
    const stored = node.get('field')
    expect(stored).toBeInstanceOf(Y.Text)
    expect(stored).not.toBeInstanceOf(Y.XmlText)
    expect(read(Anything, { field: 'text' }, node)).toEqual({
      value: { field: value },
    })
  })

  // Each kind with the type it's stored as, its written content, and its empty value with how
  // that reads back.
  type SharedType = typeof Y.Map | typeof Y.Array
  const sharedKinds: [string, unknown, SharedType, unknown, unknown, unknown][] = [
    ['map', map({ title: 'text' }), Y.Map, { title: 't' }, {}, { title: '' }],
    ['record', record({ title: 'text' }), Y.Map, { a: { title: 't' } }, {}, {}],
    ['array()', array(), Y.Array, [1, 2], [], []],
  ]
  type SharedRow = [string, Wrong, string, unknown, SharedType, unknown, unknown]
  it.each(
    sharedKinds.flatMap(([kindName, kind, type, value, empty, emptyRead]) =>
      except(type === Y.Map ? 'a Y.Map' : 'a Y.Array').flatMap((name): SharedRow[] => [
        [kindName, name, 'its content', kind, type, value, value],
        [kindName, name, 'its empty value', kind, type, empty, emptyRead],
      ]),
    ),
  )(
    'replaces under a %s field %s written as %s with the declared kind',
    (_, name, __, kind, type, value, expected) => {
      const node = freshNode()
      node.set('field', wrong[name]())
      write(Anything, { field: kind } as never, node, { field: value })
      expect(node.get('field')).toBeInstanceOf(type)
      expect(read(Anything, { field: kind } as never, node)).toEqual({
        value: { field: expected },
      })
    },
  )

  it.each(except('a Y.Map'))('replaces a record item stored as %s with a Y.Map', (name) => {
    const Items = z.object({ items: z.record(z.string(), z.object({ title: z.string() })) })
    const shape = { items: record({ title: 'text' }) }
    const node = freshNode()
    write(Items, shape, node, { items: { a: { title: 'x' } } })
    const items = node.get('items') as Y.Map<unknown>
    items.set('a', wrong[name]())
    write(Items, shape, node, { items: { a: { title: 'y' } } })
    expect(node.get('items')).toBe(items)
    expect(read(Items, shape, node)).toEqual({ value: { items: { a: { title: 'y' } } } })
  })

  it.each(except('plain'))('replaces an array() item stored as %s', (name) => {
    const node = freshNode()
    const tags = new Y.Array<unknown>()
    node.set('tags', tags)
    tags.insert(0, ['a', wrong[name](), 'c'])
    write(z.object({ tags: z.array(z.string()) }), { tags: array() }, node, {
      tags: ['a', 'b', 'c'],
    })
    expect(node.get('tags')).toBe(tags)
    expect(tags.toArray()).toEqual(['a', 'b', 'c'])
  })

  it.each(except('a Y.XmlFragment'))(
    "replaces %s under an 'xml' field with an empty Y.XmlFragment",
    (name) => {
      const node = freshNode()
      node.set('field', wrong[name]())
      write(Anything, { field: 'xml' }, node, { field: 'ignored' })
      const stored = node.get('field') as Y.XmlFragment
      expect(stored).toBeInstanceOf(Y.XmlFragment)
      expect(stored).not.toBeInstanceOf(Y.XmlElement)
      expect(stored.length).toBe(0)
      expect(read(Anything, { field: 'xml' }, node)).toEqual({
        value: { field: stored },
      })
    },
  )

  it.each(except('plain'))(
    'replaces %s under an undeclared key with the written plain value',
    (name) => {
      const node = freshNode()
      node.set('field', wrong[name]())
      write(Anything, {}, node, { field: { n: 1 } })
      expect(node.get('field')).toEqual({ n: 1 })
      expect(read(Anything, {}, node)).toEqual({ value: { field: { n: 1 } } })
    },
  )

  it.each(except('plain'))('deletes %s under an undeclared key the value doesn’t have', (name) => {
    const node = freshNode()
    const Optional = z.object({ field: z.unknown().optional() })
    node.set('field', wrong[name]())
    expect(write(Optional, {}, node, {})).toEqual({ value: {} })
    expect(node.has('field')).toBe(false)
    expect(read(Optional, {}, node)).toEqual({ value: {} })
  })

  it('repairs mismatches at any depth, inside map fields and record items', () => {
    const Deep = z.object({
      cards: z.record(
        z.string(),
        z.object({
          title: z.string(),
          meta: z.object({ caption: z.string(), n: z.number() }),
        }),
      ),
    })
    const shape = {
      cards: record({ title: 'text', meta: map({ caption: 'text' }) }),
    }
    const value = {
      cards: { a: { title: 'A', meta: { caption: 'c', n: 1 } } },
    }
    const node = freshNode()
    write(Deep, shape, node, value)
    const item = (node.get('cards') as Y.Map<unknown>).get('a') as Y.Map<unknown>
    const meta = item.get('meta') as Y.Map<unknown>
    item.set('title', 'plain')
    item.set('extra', new Y.Map())
    meta.set('caption', new Y.Array())
    meta.set('n', new Y.Text('1'))
    expect(read(Deep, shape, node)?.issues).toHaveLength(4)
    expect(write(Deep, shape, node, value)).toEqual({ value })
    expect(read(Deep, shape, node)).toEqual({ value })
    expect(item.get('meta')).toBe(meta)
    expect(item.get('title')).toBeInstanceOf(Y.Text)
    expect(item.has('extra')).toBe(false)
    expect(meta.get('caption')).toBeInstanceOf(Y.Text)
    expect(meta.get('n')).toBe(1)
  })

  it('replaces a wrong-kind map with one holding the whole written content', () => {
    const shape = {
      field: map({ title: 'text', inner: map({ notes: 'xml' }) }),
    }
    const node = freshNode()
    node.set('field', new Y.Array())
    write(Anything, shape as never, node, {
      field: { title: 't', inner: { n: 1 } },
    })
    const field = node.get('field') as Y.Map<unknown>
    expect(field.get('title')).toBeInstanceOf(Y.Text)
    expect((field.get('title') as Y.Text).toString()).toBe('t')
    const inner = field.get('inner') as Y.Map<unknown>
    expect(inner.get('n')).toBe(1)
    expect(inner.get('notes')).toBeInstanceOf(Y.XmlFragment)
    expect(read(Anything, shape as never, node)).toEqual({
      value: { field: { title: 't', inner: { n: 1, notes: inner.get('notes') } } },
    })
  })

  it('repairs in the write’s single transaction', () => {
    const node = freshNode()
    node.set('title', 'plain')
    node.set('extra', new Y.Map())
    node.set('meta', new Y.Text())
    let transactions = 0
    node.doc!.on('afterTransaction', () => transactions++)
    write(Card, { title: 'text' }, node, {
      title: 't',
      done: true,
      meta: { n: 1 },
    })
    expect(transactions).toBe(1)
    expect(read(Card, { title: 'text' }, node)).toEqual({
      value: { title: 't', done: true, meta: { n: 1 } },
    })
  })

  it('reaches a peer, which reads the schema’s success result', () => {
    const shape = { title: 'text', meta: map({}) } as const
    const value = { title: 't', done: true, meta: { n: 1 } }
    const a = freshNode()
    const b = new Y.Doc().getMap<unknown>('card')
    a.set('title', new Y.Map())
    a.set('meta', 'plain')
    a.set('extra', new Y.Array())
    syncDocs(a.doc!, b.doc!)
    expect(read(Card, shape, b)?.issues).toHaveLength(3)
    write(Card, shape, a, value)
    syncDocs(a.doc!, b.doc!)
    expect(read(Card, shape, b)).toEqual({ value })
  })
})
