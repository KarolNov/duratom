import type { StandardSchemaV1 } from '@standard-schema/spec'
import { useAtom, useAtomValue } from 'jotai'
import { useMemo, type DependencyList } from 'react'
import type * as Y from 'yjs'
import { liveAtom, type AtomOptions, type LiveSpec } from '../atoms/live-atom.js'
import { typedAtom, type Patch } from '../atoms/typed-atom.js'
import type { Locator, MapPath } from '../core/index.js'
import type { Exact } from '../schema/shape.js'

type SpecOptions<N extends Y.AbstractType<any>, T> = Omit<LiveSpec<N, T>, 'locate' | 'project'> &
  AtomOptions

/**
 * Hook form of `liveAtom`, taking a whole spec, such as a selector from `select`, or a function
 * that builds it: `useLiveAtom(() => select..., [id])` builds it only when `deps` change, rather
 * than on every render. The atom is rebuilt only when `deps` change, so list whatever the spec
 * closes over (an id, say), as with useMemo. `deps` is required: a spec built inline from props
 * would otherwise keep its first value. `options.docAtom` reads another doc than `docAtom`.
 *
 * @example
 * const title = useLiveAtom(() => select.map('cards').child(id).get('title', ''), [id])
 */
export function useLiveAtom<N extends Y.AbstractType<any>, T>(
  spec: LiveSpec<N, T> | (() => LiveSpec<N, T>),
  deps: DependencyList,
  options?: AtomOptions,
): T
/**
 * Hook form of `liveAtom`. The atom is rebuilt only when `deps` change, so list whatever
 * `locate` and `project` close over (an id, say), as with useMemo. `options.docAtom` reads
 * another doc than `docAtom`.
 *
 * @example
 * const title = useLiveAtom(
 *   (at) => at.map('cards').child(id),
 *   (card: Y.Map<unknown> | undefined) => String(card?.get('title') ?? ''),
 *   { keys: ['title'] },
 *   [id],
 * )
 */
export function useLiveAtom<N extends Y.AbstractType<any>, T>(
  locate: LiveSpec<N, T>['locate'],
  project: LiveSpec<N, T>['project'],
  options?: SpecOptions<N, T>,
  deps?: DependencyList,
): T
export function useLiveAtom<N extends Y.AbstractType<any>, T>(
  ...args:
    | [spec: LiveSpec<N, T> | (() => LiveSpec<N, T>), deps: DependencyList, options?: AtomOptions]
    | [
        locate: LiveSpec<N, T>['locate'],
        project: LiveSpec<N, T>['project'],
        options?: SpecOptions<N, T>,
        deps?: DependencyList,
      ]
): T {
  let spec: LiveSpec<N, T> | (() => LiveSpec<N, T>)
  let deps: DependencyList
  let docAtom: AtomOptions['docAtom']
  // Only the positional form has a function second.
  if (typeof args[1] === 'function') {
    const { docAtom: own, ...rest } = (args[2] ?? {}) as SpecOptions<N, T>
    spec = { locate: args[0], project: args[1], ...rest } as LiveSpec<N, T>
    deps = (args[3] as DependencyList | undefined) ?? []
    docAtom = own
  } else {
    spec = args[0] as LiveSpec<N, T> | (() => LiveSpec<N, T>)
    deps = args[1] as DependencyList
    docAtom = (args[2] as AtomOptions | undefined)?.docAtom
  }
  const a = useMemo(
    () => liveAtom(typeof spec === 'function' ? spec() : spec, { docAtom }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, docAtom],
  )
  return useAtomValue(a)
}

/**
 * Hook form of `typedAtom`, returning `[result, set]` as `useAtom` does: `result` is `undefined`
 * while the node is missing, `{ issues }` while it's invalid and `{ value }` otherwise, and
 * `set(patch)` merges a patch and returns the schema's result. `locator` can be a function that
 * builds it, so it's built only when `deps` change. The atom is rebuilt only when `deps` change,
 * so list whatever the locator closes over (an id, say), as with useMemo; `schema` and `shape`
 * are taken from the render that built it. `options.docAtom` reads another doc than `docAtom`.
 *
 * @example
 * const [card, setCard] = useTypedAtom(() => select.map('cards').child(id), Card, { title: 'text' }, [id])
 * if (card?.value) setCard({ priority: 'high' })
 */
export function useTypedAtom<Schema extends StandardSchemaV1, const S extends object>(
  locator: Locator<any> | MapPath<any> | (() => Locator<any> | MapPath<any>),
  schema: Schema,
  shape: Exact<S, StandardSchemaV1.InferOutput<Schema>>,
  deps: DependencyList,
  options?: AtomOptions,
): [
  result: StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>> | undefined,
  set: (
    patch: Patch<StandardSchemaV1.InferOutput<Schema>>,
  ) => StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>>,
] {
  const docAtom = options?.docAtom
  const a = useMemo(
    () =>
      typedAtom(typeof locator === 'function' ? locator() : locator, schema, shape, { docAtom }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, docAtom],
  )
  return useAtom(a)
}
