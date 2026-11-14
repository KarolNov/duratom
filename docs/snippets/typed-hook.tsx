import { select } from 'duratom'
import { useTypedAtom } from 'duratom/react'
import { z } from 'zod'

const Card = z.object({ title: z.string(), priority: z.enum(['low', 'high']) })

// The card's path depends on a prop: the hook rebuilds the atom only when `id` changes.
export function CardRow({ id }: { id: string }) {
  const [card, setCard] = useTypedAtom(
    () => select.map('cards').child(id),
    Card,
    { title: 'text' },
    [id],
  )
  if (!card) return <button onClick={() => setCard({ title: 'New', priority: 'low' })}>Add</button>
  if (card.issues) return <span>Unreadable card</span>
  return (
    <label>
      {card.value.title}
      <input
        type="checkbox"
        checked={card.value.priority === 'high'}
        onChange={(e) => setCard({ priority: e.target.checked ? 'high' : 'low' })}
      />
    </label>
  )
}
