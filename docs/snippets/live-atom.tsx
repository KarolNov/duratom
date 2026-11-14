import { liveAtom, select } from 'duratom'
import { useLiveAtom } from 'duratom/react'
import { useAtomValue } from 'jotai'
import * as Y from 'yjs'

// One field, with a fallback for a missing map, a missing key or a value of another type.
const boardName = liveAtom(select.map('board').get('name', 'Untitled'))

// Your own projection: re-renders only when the counts change, not on every edit to a todo.
const progress = liveAtom(
  select.map('todos').project((todos) => {
    let done = 0
    todos?.forEach((todo) => {
      if (todo instanceof Y.Map && todo.get('done') === true) done++
    })
    return { done, total: todos?.size ?? 0 }
  }),
)

export function Header() {
  const name = useAtomValue(boardName)
  const { done, total } = useAtomValue(progress)
  return (
    <h1>
      {name}: {done} of {total} done
    </h1>
  )
}

// A selector that depends on props: the hook rebuilds the atom only when `id` changes.
export function Title({ id }: { id: string }) {
  const title = useLiveAtom(() => select.map('todos').child(id).text('title'), [id])
  return <span>{title}</span>
}
