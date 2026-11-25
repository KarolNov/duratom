import { keyValueAtom, select, typedAtom } from 'duratom'
import { useAtom, useAtomValue } from 'jotai'
import { z } from 'zod'

// The root array `master` holds a y-utility YKeyValue: { key, val } entries, the rightmost wins.
const master = select.keyValue('master')

// One key: re-renders only when `tone` changes, not when another knob moves.
const toneAtom = typedAtom(master.key('tone'), z.number().min(-1).max(1))

export function ToneKnob() {
  const [tone, setTone] = useAtom(toneAtom)
  const value = tone && !tone.issues ? tone.value : 0
  return (
    <input
      type="range"
      min={-1}
      max={1}
      step={0.01}
      value={value}
      // Validated, then written as YKeyValue#set writes it: append, delete the older entry.
      onChange={(e) => setTone(Number(e.target.value))}
    />
  )
}

// Several keys at once, a schema per key; keys it doesn't name are ignored.
const XY = z.object({ x: z.number(), y: z.number() })
const masterAtom = keyValueAtom(master, { tone: z.number(), filter: XY })

export function MasterSummary() {
  const { tone, filter } = useAtomValue(masterAtom)
  return (
    <p>
      tone {tone && !tone.issues ? tone.value : '–'}, filter{' '}
      {filter && !filter.issues ? `${filter.value.x}, ${filter.value.y}` : '–'}
    </p>
  )
}
