import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type } from 'arktype'
import * as v from 'valibot'
import * as Y from 'yjs'
import { z } from 'zod'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { array, AsyncValidationUnsupportedError, map, read, record } from '../index.js'

/** A hand-written Standard Schema that accepts anything and records what it validated. */
function anySchema<T = Record<string, unknown>>(vendor = 'test') {
  const validate = vi.fn((value: unknown): StandardSchemaV1.Result<T> => ({
    value: value as T,
  }))
  const schema: StandardSchemaV1<T> = {
    '~standard': { version: 1, vendor, validate },
  }
  return Object.assign(schema, { validate })
}

/** The paths of a result's issues, or `undefined` when it has none. */
const issuePaths = (result: StandardSchemaV1.Result<unknown> | undefined) =>
  result?.issues?.map((issue) => issue.path)

/** Issue paths in a fixed order, for reads whose issue order the tests don't pin. */
const sorted = (paths: unknown[] | undefined) =>
  paths && [...paths].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))

describe('an absent node', () => {
  it('reads as undefined without validating', () => {
    const schema = anySchema()
    expect(read(schema, {}, undefined)).toBeUndefined()
    expect(schema.validate).not.toHaveBeenCalled()
  })
})

const mapWith = (entries: Record<string, unknown>) => {
  const node = new Y.Doc().getMap<unknown>('root')
  for (const [key, value] of Object.entries(entries)) node.set(key, value)
  return node
}

describe('plain fields', () => {
  it('read as their stored JSON values, nested objects included', () => {
    const node = mapWith({
      title: 'hello',
      done: false,
      meta: { tags: ['a'], size: { w: 2 } },
    })
    expect(read(anySchema(), {}, node)).toEqual({
      value: {
        title: 'hello',
        done: false,
        meta: { tags: ['a'], size: { w: 2 } },
      },
    })
  })

  it('read as a fresh copy, so mutating the result leaves the doc alone', () => {
    const node = mapWith({ meta: { tags: ['a'], size: { w: 2 } } })
    const result = read(anySchema<{ meta: { tags: string[]; size: { w: number } } }>(), {}, node)
    const meta = result && 'value' in result ? result.value.meta : undefined
    meta?.tags.push('local-only')
    if (meta) meta.size.w = 99
    expect(node.toJSON()).toEqual({ meta: { tags: ['a'], size: { w: 2 } } })
  })

  it('read binary values as bytes', () => {
    const node = mapWith({
      blob: new Uint8Array([1, 2]),
      nested: { blob: new Uint8Array([3]) },
    })
    expect(read(anySchema(), {}, node)).toEqual({
      value: {
        blob: new Uint8Array([1, 2]),
        nested: { blob: new Uint8Array([3]) },
      },
    })
  })

  it('read objects inside arrays as fresh copies', () => {
    const node = mapWith({ items: [{ n: 1 }] })
    const result = read(anySchema<{ items: { n: number }[] }>(), {}, node)
    const item = result && 'value' in result ? result.value.items[0] : undefined
    if (item) item.n = 2
    expect(node.toJSON()).toEqual({ items: [{ n: 1 }] })
  })

  it('read binary values as fresh bytes', () => {
    const node = mapWith({ blob: new Uint8Array([1, 2]) })
    const result = read(anySchema<{ blob: Uint8Array }>(), {}, node)
    if (result && 'value' in result) result.value.blob[0] = 9
    expect(node.get('blob')).toEqual(new Uint8Array([1, 2]))
  })

  it('read deeply nested values without throwing', () => {
    const root: { n?: object } = {}
    let at = root
    for (let depth = 0; depth < 20_000; depth++) at = at.n = {}
    // Neither anySchema nor toBe: vitest formats the 20,000-deep value and overflows itself.
    const schema: StandardSchemaV1<{ root: object }> = {
      '~standard': {
        version: 1,
        vendor: 'x',
        validate: (value) => ({ value: value as never }),
      },
    }
    let result: StandardSchemaV1.Result<{ root: object }> | undefined
    expect(() => (result = read(schema, {}, mapWith({ root })))).not.toThrow()
    expect(result && 'value' in result && result.value.root !== root).toBe(true)
  })

  it('keep the stored key order', () => {
    const result = read(anySchema(), {}, mapWith({ meta: { b: 1, a: { d: 1, c: 2 } } }))
    const meta = (result as { value: { meta: { a: object } } }).value.meta
    expect(JSON.stringify(meta)).toBe('{"b":1,"a":{"d":1,"c":2}}')
  })

  it('read a nested Node Buffer as fresh bytes', () => {
    const node = mapWith({ file: { blob: Buffer.from([1, 2]) } })
    const result = read(anySchema<{ file: { blob: Uint8Array } }>(), {}, node)
    if (result && 'value' in result) result.value.file.blob[0] = 9
    expect([...(node.get('file') as { blob: Uint8Array }).blob]).toEqual([1, 2])
  })

  it('read an object stored twice in one value as two copies, as a peer decodes it', () => {
    const shared = { n: 1 }
    const result = read(
      anySchema<{ pair: { a: { n: number }; b: { n: number } } }>(),
      {},
      mapWith({ pair: { a: shared, b: shared } }),
    )
    const pair = result && 'value' in result ? result.value.pair : undefined
    if (pair) pair.a.n = 2
    expect(pair?.b).toEqual({ n: 1 })
  })

  it('read a cyclic value without throwing, keeping its cycle', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    const node = mapWith({ cyclic })
    const result = read(anySchema<{ cyclic: Record<string, unknown> }>(), {}, node)
    const copied = result && 'value' in result ? result.value.cyclic : undefined
    expect(copied).not.toBe(cyclic)
    expect(copied?.self).toBe(copied)
  })

  it('read a key named __proto__ as an ordinary field', () => {
    const node = mapWith({ ['__proto__']: { title: 'injected' } })
    const value = (read(anySchema(), {}, node) as { value: Record<string, unknown> }).value
    expect(Object.keys(value)).toEqual(['__proto__'])
    expect(value.title).toBeUndefined()
  })

  it('read as undefined when missing', () => {
    const result = read(anySchema<{ note?: string }>(), {}, mapWith({ title: 'x' }))
    expect(result).toEqual({ value: { title: 'x' } })
    expect((result as { value: { note?: string } }).value.note).toBeUndefined()
  })
})

describe("'text' fields", () => {
  it('read as their string', () => {
    const node = mapWith({ title: new Y.Text('hello') })
    expect(read(anySchema(), { title: 'text' }, node)).toEqual({
      value: { title: 'hello' },
    })
  })

  it('ignore a shape key whose kind is undefined', () => {
    const shape: { title?: 'text' } = { title: undefined }
    expect(read(anySchema<{ title?: string }>(), shape, mapWith({}))).toEqual({
      value: {},
    })
  })

  it("read as '' when missing", () => {
    expect(read(anySchema(), { title: 'text' }, mapWith({}))).toEqual({
      value: { title: '' },
    })
  })

  it('read a stored undefined as a shape mismatch, not as missing', () => {
    expect(issuePaths(read(anySchema(), { title: 'text' }, mapWith({ title: undefined })))).toEqual(
      [['title']],
    )
  })

  it('read a Y.XmlText as a shape mismatch, not as its markup', () => {
    const xml = new Y.XmlText('hi')
    const node = mapWith({ title: xml })
    xml.format(0, 2, { bold: true })
    expect(issuePaths(read(anySchema(), { title: 'text' }, node))).toEqual([['title']])
  })
})

const ymap = (entries: Record<string, unknown>) => {
  const node = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(entries)) node.set(key, value)
  return node
}

const yarray = (items: unknown[]) => Y.Array.from(items as never[])

describe('map fields', () => {
  it('read as a plain object, recursing into their shape', () => {
    const node = mapWith({
      meta: ymap({
        title: new Y.Text('hi'),
        size: { w: 2 },
        inner: ymap({ body: new Y.Text('b') }),
      }),
    })
    const shape = {
      meta: map({ title: 'text', inner: map({ body: 'text' }) }),
    }
    expect(read(anySchema(), shape, node)).toEqual({
      value: { meta: { title: 'hi', size: { w: 2 }, inner: { body: 'b' } } },
    })
  })

  it('read as their shape’s empty values when missing, the same as an empty map', () => {
    const shape = { meta: map({ title: 'text', inner: map({ tags: array() }) }) }
    const expected = { value: { meta: { title: '', inner: { tags: [] } } } }
    expect(read(anySchema(), shape, mapWith({}))).toEqual(expected)
    expect(read(anySchema(), shape, mapWith({ meta: ymap({}) }))).toEqual(expected)
  })

  it('read a missing self-referential map one level deep, without looping', () => {
    const node: { name: string; child?: unknown } = { name: 'text' }
    node.child = map(node as never)
    expect(read(anySchema(), node as never, mapWith({}))).toEqual({
      value: { name: '', child: { name: '', child: {} } },
    })
  })

  it('read a missing field of their shape as its empty value', () => {
    const shape = { meta: map({ title: 'text', tags: array(), body: 'xml' }) }
    expect(read(anySchema(), shape, mapWith({ meta: ymap({}) }))).toEqual({
      value: { meta: { title: '', tags: [] } },
    })
  })
})

describe('record fields', () => {
  it('read as a plain object of items, each following the item shape', () => {
    const node = mapWith({
      cards: ymap({
        a: ymap({ title: new Y.Text('one'), done: false }),
        b: ymap({ title: new Y.Text('two'), done: true }),
      }),
    })
    expect(read(anySchema(), { cards: record({ title: 'text' }) }, node)).toEqual({
      value: {
        cards: {
          a: { title: 'one', done: false },
          b: { title: 'two', done: true },
        },
      },
    })
  })

  it('read as {} when missing', () => {
    const shape = { cards: record({ title: 'text' }) }
    expect(read(anySchema(), shape, mapWith({}))).toEqual({
      value: { cards: {} },
    })
  })

  it('read an item key named __proto__ as an ordinary item', () => {
    const node = mapWith({
      cards: ymap({ ['__proto__']: ymap({ title: new Y.Text('x') }) }),
    })
    const result = read(anySchema(), { cards: record({ title: 'text' }) }, node)
    const cards = (result as { value: { cards: Record<string, unknown> } }).value.cards
    expect(Object.keys(cards)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(cards)).toBe(Object.prototype)
  })
})

describe('a self-referential record shape', () => {
  it('reads nesting as deep as a peer can sync without overflowing', () => {
    const tree: { name: string; children?: unknown } = { name: 'text' }
    tree.children = record(tree as never)
    const doc = new Y.Doc()
    const root = doc.getMap('root')
    // One transaction, since Yjs integrates a nested map set outside one in time quadratic in depth.
    doc.transact(() => {
      let parent = root
      for (let depth = 0; depth < 20_000; depth++) {
        const children = new Y.Map()
        parent.set('children', children)
        const child = new Y.Map()
        children.set('c', child)
        parent = child
      }
    })
    let result: ReturnType<typeof read> | undefined
    expect(() => (result = read(anySchema(), tree as never, root))).not.toThrow()
    expect((result as { value: { name: string } }).value.name).toBe('')
  })
})

describe('array() fields', () => {
  it('read as a plain array of their stored values', () => {
    const node = mapWith({ tags: yarray(['a', { n: 1 }, [2]]) })
    expect(read(anySchema(), { tags: array() }, node)).toEqual({
      value: { tags: ['a', { n: 1 }, [2]] },
    })
  })

  it('read as [] when missing', () => {
    expect(read(anySchema(), { tags: array() }, mapWith({}))).toEqual({
      value: { tags: [] },
    })
  })

  it('read their items as fresh copies', () => {
    const node = mapWith({ items: yarray([{ n: 1 }]) })
    const result = read(anySchema<{ items: { n: number }[] }>(), { items: array() }, node)
    if (result && 'value' in result) result.value.items[0]!.n = 2
    expect(node.toJSON()).toEqual({ items: [{ n: 1 }] })
  })

  it('make the whole read invalid when one item is invalid', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const result = read(schema, { tags: array() }, mapWith({ tags: yarray(['a', 2, 'c']) }))
    expect(result).toEqual(schema['~standard'].validate({ tags: ['a', 2, 'c'] }))
    expect(result?.issues).toHaveLength(1)
    expect(result && 'value' in result).toBe(false)
  })
})

describe("'xml' fields", () => {
  it('read as the Y.XmlFragment instance itself', () => {
    const body = new Y.XmlFragment()
    const node = mapWith({ body })
    const schema = z.object({ body: z.instanceof(Y.XmlFragment) })
    const result = read(schema, { body: 'xml' }, node)
    expect(result && 'value' in result && result.value.body).toBe(body)
  })

  it('read as undefined when missing', () => {
    const result = read(anySchema(), { body: 'xml' }, mapWith({}))
    expect(result).toEqual({ value: {} })
  })

  it('read inside a record item as that item’s fragment', () => {
    const body = new Y.XmlFragment()
    const node = mapWith({ cards: ymap({ a: ymap({ body }) }) })
    const result = read(anySchema(), { cards: record({ body: 'xml' }) }, node)
    const cards = (result as { value: { cards: { a: { body: unknown } } } }).value.cards
    expect(cards.a.body).toBe(body)
  })
})

describe('a record item read on its own', () => {
  const Card = z.object({ title: z.string(), done: z.boolean() })
  const Board = z.object({ cards: z.record(z.string(), Card) })
  const node = mapWith({
    cards: ymap({
      good: ymap({ title: new Y.Text('ok'), done: true }),
      bad: ymap({ title: new Y.Text('broken'), done: 'yes' }),
    }),
  })
  const cards = node.get('cards') as Y.Map<unknown>

  it('has its own validity while a sibling item is invalid', () => {
    expect(read(Card, { title: 'text' }, cards.get('good') as Y.Map<unknown>)).toEqual({
      value: { title: 'ok', done: true },
    })
    expect(read(Card, { title: 'text' }, cards.get('bad') as Y.Map<unknown>)?.issues).toHaveLength(
      1,
    )
  })

  it('while reading the parent is invalid as a whole', () => {
    const result = read(Board, { cards: record({ title: 'text' }) }, node)
    expect(result?.issues).toHaveLength(1)
  })
})

describe('each read', () => {
  it('returns a fresh tree, sharing nothing with the previous read', () => {
    const node = mapWith({
      meta: ymap({ size: { w: 1 } }),
      cards: ymap({ a: ymap({ tags: ['x'] }) }),
      list: yarray([{ n: 1 }]),
    })
    const shape = { meta: map({}), cards: record({}), list: array() }
    type Value = {
      meta: { size: object }
      cards: { a: { tags: string[] } }
      list: { n: number }[]
    }
    const first = (read(anySchema<Value>(), shape, node) as { value: Value }).value
    const second = (read(anySchema<Value>(), shape, node) as { value: Value }).value
    expect(second).toEqual(first)
    expect(second.meta).not.toBe(first.meta)
    expect(second.meta.size).not.toBe(first.meta.size)
    expect(second.cards).not.toBe(first.cards)
    expect(second.cards.a).not.toBe(first.cards.a)
    expect(second.cards.a.tags).not.toBe(first.cards.a.tags)
    expect(second.list).not.toBe(first.list)
    expect(second.list[0]).not.toBe(first.list[0])
  })
})

describe.each(
  Object.entries({
    zod: z.object({
      meta: z.object({ title: z.string() }),
      cards: z.record(z.string(), z.object({ title: z.string(), done: z.boolean() })),
      tags: z.array(z.string()),
    }),
    valibot: v.object({
      meta: v.object({ title: v.string() }),
      cards: v.record(v.string(), v.object({ title: v.string(), done: v.boolean() })),
      tags: v.array(v.string()),
    }),
    arktype: type({
      meta: { title: 'string' },
      cards: { '[string]': { title: 'string', done: 'boolean' } },
      tags: 'string[]',
    }),
  }),
)('nested kinds through %s', (_, schema) => {
  const shape = {
    meta: map({ title: 'text' }),
    cards: record({ title: 'text' }),
    tags: array(),
  } as const

  it('read as the schema’s own { value }', () => {
    const node = mapWith({
      meta: ymap({ title: new Y.Text('board') }),
      cards: ymap({ a: ymap({ title: new Y.Text('one'), done: false }) }),
      tags: yarray(['x']),
    })
    const value = {
      meta: { title: 'board' },
      cards: { a: { title: 'one', done: false } },
      tags: ['x'],
    }
    expect(read(schema, shape, node)).toEqual(schema['~standard'].validate(value))
    expect((read(schema, shape, node) as { value: unknown }).value).toEqual(value)
  })

  it('read a fresh doc as empty values the schema accepts where it can', () => {
    const result = read(schema, shape, mapWith({}))
    expect(result).toEqual(
      schema['~standard'].validate({ meta: { title: '' }, cards: {}, tags: [] }),
    )
  })
})

describe('the result', () => {
  it('is the object validate returned, unchanged', () => {
    const issues = { issues: [{ message: 'nope', path: ['title'] }] }
    const schema: StandardSchemaV1 = {
      '~standard': { version: 1, vendor: 'x', validate: () => issues },
    }
    expect(read(schema, {}, mapWith({}))).toBe(issues)
  })
})

const vendors = {
  zod: z.object({ title: z.string(), count: z.number() }),
  valibot: v.object({ title: v.string(), count: v.number() }),
  arktype: type({ title: 'string', count: 'number' }),
}

describe.each(Object.entries(vendors))('the result of %s', (_, schema) => {
  it('is the schema’s own { value } on valid data', () => {
    const node = mapWith({ count: 2 })
    node.set('title', new Y.Text('hi'))
    const result = read(schema, { title: 'text' }, node)
    expect(result).toEqual(schema['~standard'].validate({ title: 'hi', count: 2 }))
    expect(result && 'value' in result && result.value).toEqual({
      title: 'hi',
      count: 2,
    })
  })

  it('is the schema’s own { issues } on invalid data', () => {
    const result = read(schema, { title: 'text' }, mapWith({ count: 'two' }))
    expect(result).toEqual(schema['~standard'].validate({ title: '', count: 'two' }))
    const paths = result?.issues?.map((issue) =>
      [...(issue.path ?? [])].map((p) => (typeof p === 'object' ? p.key : p)),
    )
    expect(paths).toEqual([['count']])
  })
})

/** Runs `act`, lets pending rejections surface, and returns the reasons Node saw as unhandled. */
async function unhandledDuring(act: () => void) {
  const seen: unknown[] = []
  const listener = (reason: unknown) => seen.push(reason)
  process.on('unhandledRejection', listener)
  try {
    act()
    await new Promise((resolve) => setTimeout(resolve, 10))
  } finally {
    process.off('unhandledRejection', listener)
  }
  return seen
}

const asyncSchema = (
  result: () => Promise<StandardSchemaV1.Result<unknown>>,
): StandardSchemaV1 => ({
  '~standard': { version: 1, vendor: 'slowlib', validate: result },
})

describe('bad data', () => {
  it('never makes a read throw', () => {
    const schema = z.object({
      title: z.string(),
      meta: z.object({ size: z.number() }),
    })
    const node = mapWith({ title: 5, meta: null, count: 'x' })
    let result: ReturnType<typeof read> | undefined
    expect(() => (result = read(schema, {}, node))).not.toThrow()
    expect(result?.issues).not.toHaveLength(0)
  })

  it('reads a shape value that is not a kind as a plain field, never throwing', () => {
    const node = mapWith({ a: 1, b: 'x', c: 2, d: 3 })
    const shape = { a: null, b: 'Text', c: { kind: 'map' }, d: { kind: 'other' } }
    expect(read(anySchema(), shape as never, node)).toEqual({
      value: { a: 1, b: 'x', c: 2, d: 3 },
    })
  })
})

describe('a located node that is not a Y.Map', () => {
  it.each([
    ['a Y.Text', new Y.Text('x')],
    ['a Y.Array', new Y.Array()],
    ['a Y.XmlFragment', new Y.XmlFragment()],
    ['a Y.XmlHook', new Y.XmlHook('hook')],
  ])('reads %s as one layer issue at the node, without validating', (found, node) => {
    new Y.Doc().getMap('root').set('node', node)
    const schema = anySchema()
    expect(read(schema, { title: 'text' }, node)).toEqual({
      issues: [{ message: `Shape mismatch: expected a Y.Map, found ${found}`, path: [] }],
    })
    expect(schema.validate).not.toHaveBeenCalled()
  })

  it('takes whatever a locator resolves, so it needs no guard', () => {
    expectTypeOf<Y.AbstractType<any> | undefined>().toMatchTypeOf<Parameters<typeof read>[2]>()
  })
})

describe('a Y.Map not yet in a doc', () => {
  it('throws a TypeError, since its keys cannot be read', () => {
    const schema = anySchema()
    expect(() => read(schema, {}, new Y.Map([['title', 'x']]))).toThrow(TypeError)
    expect(schema.validate).not.toHaveBeenCalled()
  })
})

describe('a shape mismatch', () => {
  it('reads a plain value under a text field as a layer issue at its path, without validating', () => {
    const schema = anySchema()
    const result = read(schema, { title: 'text' }, mapWith({ title: 'plain' }))
    expect(result).toEqual({ issues: [{ message: expect.any(String), path: ['title'] }] })
    expect(schema.validate).not.toHaveBeenCalled()
  })

  it('reads a shared type of the wrong kind under a text field as a layer issue', () => {
    const result = read(anySchema(), { title: 'text' }, mapWith({ title: new Y.Map() }))
    expect(issuePaths(result)).toEqual([['title']])
  })

  it('reads a plain value or the wrong shared type under a map field as a layer issue', () => {
    const shape = { a: map({}), b: map({}), c: map({}) }
    const node = mapWith({ a: { x: 1 }, b: new Y.Array(), c: new Y.XmlHook('hook') })
    expect(issuePaths(read(anySchema(), shape, node))).toEqual([['a'], ['b'], ['c']])
  })

  it('reads a shared type under an undeclared key as a layer issue, never flattening it', () => {
    const inner = ymap({ a: 1 })
    const toJSON = vi.spyOn(inner, 'toJSON')
    const schema = anySchema()
    const result = read(schema, {}, mapWith({ title: 'x', other: inner }))
    expect(issuePaths(result)).toEqual([['other']])
    expect(toJSON).not.toHaveBeenCalled()
    expect(schema.validate).not.toHaveBeenCalled()
  })

  it('reads a shared type under a shape value that is not a kind as a layer issue', () => {
    const result = read(anySchema(), { b: 'Text' } as never, mapWith({ b: ymap({}) }))
    expect(issuePaths(result)).toEqual([['b']])
  })

  it('reads anything but a Y.Array under an array() field as a layer issue', () => {
    const shape = { a: array(), b: array() }
    const result = read(anySchema(), shape, mapWith({ a: ['x'], b: ymap({}) }))
    expect(issuePaths(result)).toEqual([['a'], ['b']])
  })

  it('reads a shared type stored as an array() item as a layer issue at its index', () => {
    const result = read(anySchema(), { tags: array() }, mapWith({ tags: yarray(['a', ymap({})]) }))
    expect(issuePaths(result)).toEqual([['tags', 1]])
  })

  it('reads anything but a Y.Map under a record field as a layer issue', () => {
    const shape = { a: record({}), b: record({}) }
    const result = read(anySchema(), shape, mapWith({ a: { x: {} }, b: new Y.Array() }))
    expect(issuePaths(result)).toEqual([['a'], ['b']])
  })

  it('reads a record item that is not a Y.Map as a layer issue at its id', () => {
    const cards = ymap({ a: ymap({}), b: null, c: { title: 'x' }, d: new Y.Text('t') })
    const result = read(anySchema(), { cards: record({}) }, mapWith({ cards }))
    expect(issuePaths(result)).toEqual([
      ['cards', 'b'],
      ['cards', 'c'],
      ['cards', 'd'],
    ])
  })

  it('reads anything but a Y.XmlFragment under an xml field as a layer issue', () => {
    const shape = { a: 'xml', b: 'xml', c: 'xml', d: 'xml' } as const
    const node = mapWith({ a: 'x', b: new Y.Text(), c: new Y.XmlElement('p'), d: undefined })
    expect(issuePaths(read(anySchema(), shape, node))).toEqual([['a'], ['b'], ['c'], ['d']])
  })
})

describe('many shape mismatches', () => {
  const withMismatches = (count: number) =>
    mapWith(Object.fromEntries(Array.from({ length: count }, (_, n) => [`k${n}`, new Y.Map()])))

  it('are all reported up to 100', () => {
    const issues = read(anySchema(), {}, withMismatches(100))?.issues
    expect(issues).toHaveLength(100)
    expect(issues?.every((issue) => issue.path?.length === 1)).toBe(true)
  })

  it('past 100 are reported as the first 100, then one issue saying the rest were left out', () => {
    const issues = read(anySchema(), {}, withMismatches(150))?.issues
    expect(issues).toHaveLength(101)
    expect(issues?.slice(0, 100).every((issue) => issue.path?.length === 1)).toBe(true)
    expect(issues?.[100]).toEqual({ message: expect.stringMatching(/more than 100/) })
  })

  it('past 100 inside a plain value are cut off the same way', () => {
    const list = Array.from({ length: 150 }, () => new Y.Map())
    expect(read(anySchema(), {}, mapWith({ list }))?.issues).toHaveLength(101)
  })

  it('nested as deep as a peer can sync stop at 100 too', () => {
    const tree: { child?: unknown } = {}
    tree.child = map(tree as never)
    const doc = new Y.Doc()
    const root = doc.getMap('root')
    doc.transact(() => {
      let parent = root
      for (let depth = 0; depth < 20_000; depth++) {
        const child = new Y.Map()
        parent.set('junk', new Y.Text())
        parent.set('child', child)
        parent = child
      }
    })
    const issues = read(anySchema(), tree as never, root)?.issues
    expect(issues).toHaveLength(101)
  })
})

describe('a shape mismatch’s message', () => {
  it.each([
    ['a Y.Doc', new Y.Doc()],
    ['a Y.XmlElement', new Y.XmlElement('p')],
    ['a Y.XmlFragment', new Y.XmlFragment()],
    ['a Y.XmlText', new Y.XmlText()],
    ['a Y.XmlHook', new Y.XmlHook('hook')],
    ['a Y.Text', new Y.Text()],
    ['a Y.Map', new Y.Map()],
    ['a Y.Array', new Y.Array()],
    ['a shared type', new (class extends Y.AbstractType<unknown> {})()],
    ['null', null],
    ['an array', [1]],
    ['bytes', new Uint8Array([1])],
    ['an object', { a: 1 }],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 1],
    ['a boolean', true],
  ])('names %s as what it found', (found, stored) => {
    // A Y.Array is the one value an array() field takes, so it's read under a text field.
    const kind = stored instanceof Y.Array ? 'text' : array()
    const [issue] = read(anySchema(), { field: kind }, mapWith({ field: stored }))?.issues ?? []
    expect(issue?.message).toMatch(new RegExp(`found ${found}$`))
  })

  it.each([
    ['a Y.Text', 'text'],
    ['a Y.XmlFragment', 'xml'],
    ['a Y.Map', map({})],
    ['a Y.Map', record({})],
    ['a Y.Array', array()],
  ] as const)('names %s as what the kind expects', (expected, kind) => {
    const [issue] = read(anySchema(), { field: kind }, mapWith({ field: 1 }))?.issues ?? []
    expect(issue?.message).toContain(`expected ${expected}, found a number`)
  })

  it('names a plain value as what an undeclared key expects', () => {
    const [issue] = read(anySchema(), {}, mapWith({ field: new Y.Map() }))?.issues ?? []
    expect(issue?.message).toContain('expected a plain value, found a Y.Map')
  })

  it('names a Y.Map as what a record item expects', () => {
    const node = mapWith({ cards: ymap({ a: 1 }) })
    const [issue] = read(anySchema(), { cards: record({}) }, node)?.issues ?? []
    expect(issue?.message).toContain('expected a Y.Map, found a number')
  })
})

describe('a shape mismatch nested in the node', () => {
  it('is found inside a map field, at its full path', () => {
    const shape = { meta: map({ title: 'text', inner: map({ body: 'text' }) }) }
    const node = mapWith({
      meta: ymap({ title: 'plain', inner: ymap({ body: 1, extra: new Y.Array() }) }),
    })
    expect(sorted(issuePaths(read(anySchema(), shape, node)))).toEqual([
      ['meta', 'inner', 'body'],
      ['meta', 'inner', 'extra'],
      ['meta', 'title'],
    ])
  })

  it('is found inside a record item, at its full path', () => {
    const shape = { cards: record({ title: 'text', tags: array() }) }
    const node = mapWith({
      cards: ymap({
        good: ymap({ title: new Y.Text('ok') }),
        bad: ymap({ title: 'plain', tags: yarray([new Y.Text()]), other: ymap({}) }),
      }),
    })
    expect(sorted(issuePaths(read(anySchema(), shape, node)))).toEqual([
      ['cards', 'bad', 'other'],
      ['cards', 'bad', 'tags', 0],
      ['cards', 'bad', 'title'],
    ])
  })

  it('is found inside a plain value, at its full path', () => {
    const node = mapWith({ meta: { list: [1, { inner: ymap({}) }] } })
    expect(issuePaths(read(anySchema(), {}, node))).toEqual([['meta', 'list', 1, 'inner']])
  })

  it('is found inside an array() item, at its full path', () => {
    const node = mapWith({ tags: yarray([{ inner: new Y.Text() }]) })
    expect(issuePaths(read(anySchema(), { tags: array() }, node))).toEqual([['tags', 0, 'inner']])
  })

  it('reads a subdocument under an undeclared key as a layer issue', () => {
    expect(issuePaths(read(anySchema(), {}, mapWith({ sub: new Y.Doc() })))).toEqual([['sub']])
  })
})

describe.each(Object.entries(vendors))('a shape mismatch read with %s', (_, schema) => {
  it('is the layer’s { issues } in Standard Schema format, without running the schema', () => {
    const validate = vi.spyOn(schema['~standard'], 'validate')
    const node = mapWith({ title: 'plain', count: 2 })
    const result = read(schema, { title: 'text' }, node)
    expect(result).toEqual({
      issues: [{ message: expect.stringContaining('Y.Text'), path: ['title'] }],
    })
    expect(validate).not.toHaveBeenCalled()
    validate.mockRestore()
  })
})

describe('a schema that validates asynchronously', () => {
  it('throws the async-unsupported error naming the vendor when validate resolves', () => {
    const schema = asyncSchema(async () => ({ value: {} }))
    expect(() => read(schema, {}, mapWith({}))).toThrow(AsyncValidationUnsupportedError)
    expect(() => read(schema, {}, mapWith({}))).toThrow(/slowlib/)
  })

  it('throws the async-unsupported error when validate rejects, leaving no unhandled rejection', async () => {
    const schema = asyncSchema(() => Promise.reject(new Error('boom')))
    const unhandled = await unhandledDuring(() =>
      expect(() => read(schema, {}, mapWith({}))).toThrow(AsyncValidationUnsupportedError),
    )
    expect(unhandled).toEqual([])
  })

  it('throws for a zod schema whose sync check throws, leaving no unhandled rejection', async () => {
    const schema = z.object({
      title: z.string().refine(() => {
        throw new Error('check blew up')
      }),
    })
    const unhandled = await unhandledDuring(() =>
      expect(() => read(schema, {}, mapWith({ title: 'x' }))).toThrow(
        new AsyncValidationUnsupportedError('zod'),
      ),
    )
    expect(unhandled).toEqual([])
  })

  it('throws for a thenable that is not a native Promise, and subscribes to its rejection', async () => {
    const then = vi.fn()
    const thenable = { then }
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'thenlib',
        validate: () => thenable as never,
      },
    }
    expect(() => read(schema, {}, mapWith({}))).toThrow(AsyncValidationUnsupportedError)
    await Promise.resolve()
    expect(then).toHaveBeenCalledWith(expect.any(Function), expect.any(Function))
  })

  it('cannot detect an async arktype .narrow(), which reads as valid', () => {
    // arktype's types reject an async predicate, but nothing stops one at runtime: the Promise it
    // returns is truthy, so the narrow passes.
    const asyncPredicate = (async () => false) as unknown as () => boolean
    const schema = type({ title: 'string' }).narrow(asyncPredicate)
    expect(read(schema, {}, mapWith({ title: 'x' }))).toEqual({
      value: { title: 'x' },
    })
  })
})

describe('types', () => {
  const schema = z.object({ title: z.string(), count: z.number() })
  const node = mapWith({})

  it('reject a shape key not in the schema’s output', () => {
    // @ts-expect-error `titel` is not a field of the schema's output
    read(schema, { titel: 'text' }, node)
    const shape = { title: 'text', titel: 'text' } as const
    // @ts-expect-error a shape declared apart from the call is checked too
    read(schema, shape, node)
    const typoOnly = { titel: 'text' } as const
    // @ts-expect-error a shape whose only key is a typo is checked too
    read(schema, typoOnly, node)
    read(schema, { title: 'text' }, node)
  })

  it('reject text on a field a string cannot fill', () => {
    // @ts-expect-error `count` is a number
    read(schema, { count: 'text' }, node)
  })

  it('accept a key of any member of a union output', () => {
    const union = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), title: z.string() }),
      z.object({ kind: z.literal('b'), count: z.number() }),
    ])
    read(union, { title: 'text' }, node)
    // @ts-expect-error `count` is a number in the member that has it
    read(union, { count: 'text' }, node)
  })

  it('reject a shape key not in the output at any depth', () => {
    const nested = z.object({
      meta: z.object({ title: z.string() }),
      cards: z.record(z.string(), z.object({ title: z.string() })),
    })
    read(nested, { meta: map({ title: 'text' }), cards: record({ title: 'text' }) }, node)
    // @ts-expect-error `titel` is not a field of `meta`
    read(nested, { meta: map({ titel: 'text' }) }, node)
    // @ts-expect-error `titel` is not a field of a card
    read(nested, { cards: record({ titel: 'text' }) }, node)
    const shape = { meta: map({ title: 'text', titel: 'text' }) }
    // @ts-expect-error a nested shape declared apart from the call is checked too
    read(nested, shape, node)
  })

  it('reject a kind on a field its read value cannot fill', () => {
    const fields = z.object({
      meta: z.object({ title: z.string() }),
      tags: z.array(z.string()),
      body: z.instanceof(Y.XmlFragment).optional(),
      count: z.number(),
    })
    read(fields, { meta: map({}), tags: array(), body: 'xml' }, node)
    // @ts-expect-error `count` is a number, not an object
    read(fields, { count: map({}) }, node)
    // @ts-expect-error `count` is a number, not an array
    read(fields, { count: array() }, node)
    // @ts-expect-error `count` is a number, not a fragment
    read(fields, { count: 'xml' }, node)
    // @ts-expect-error `meta` is an object, not an array
    read(fields, { meta: array() }, node)
    // @ts-expect-error `tags` is an array, not an object
    read(fields, { tags: map({}) }, node)
    // @ts-expect-error `title` is a string in `meta`, not an array
    read(fields, { meta: map({ title: array() }) }, node)
  })

  it('reject map and record on a class-instance field', () => {
    const instances = z.object({ when: z.date(), lookup: z.map(z.string(), z.string()) })
    // @ts-expect-error a Date reads as a Date, not a plain object
    read(instances, { when: map({}) }, node)
    // @ts-expect-error a Map reads as a Map, not a plain object
    read(instances, { lookup: record({}) }, node)
  })

  it('reject record on an object field whose values are not objects', () => {
    const fields = z.object({
      meta: z.object({ theme: z.string(), caption: z.string() }),
      cards: z.record(z.string(), z.object({ title: z.string() }).optional()),
    })
    read(fields, { meta: map({}), cards: record({ title: 'text' }) }, node)
    // @ts-expect-error `meta` has string values, not items
    read(fields, { meta: record({}) }, node)
  })

  it('return the schema’s result, or undefined', () => {
    expectTypeOf(read(schema, { title: 'text' }, node)).toEqualTypeOf<
      StandardSchemaV1.Result<{ title: string; count: number }> | undefined
    >()
  })
})
