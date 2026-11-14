import { collection, select } from 'duratom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { z } from 'zod'

const Todo = z.object({ title: z.string().min(1), done: z.boolean() })

// Every todo in the root map `todos`, each one a Y.Map read through `Todo`.
const todos = collection(select.map('todos'), Todo, { title: 'text' })

export function TodoList() {
  // Changes only when a todo is added or removed, not when one is edited.
  const ids = useAtomValue(todos.ids)
  const create = useSetAtom(todos.create)
  const add = () => {
    const result = create({ title: 'New todo', done: false })
    if (result.issues) console.warn(result.issues)
  }
  return (
    <>
      <ul>
        {ids.map((id) => (
          <TodoItem key={id} id={id} />
        ))}
      </ul>
      <button onClick={add}>Add</button>
    </>
  )
}

function TodoItem({ id }: { id: string }) {
  // The same typed atom for the same id; it re-renders this row only.
  const [todo, setTodo] = useAtom(todos.item(id))
  const remove = useSetAtom(todos.remove)
  if (!todo || todo.issues) return <li>Unreadable todo</li>
  return (
    <li>
      <input
        type="checkbox"
        checked={todo.value.done}
        onChange={(e) => setTodo({ done: e.target.checked })}
      />
      {todo.value.title}
      <button onClick={() => remove(id)}>Remove</button>
    </li>
  )
}
