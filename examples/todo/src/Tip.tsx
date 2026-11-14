import { useId, type ReactNode } from 'react'

interface TipProps {
  /** What the bubble says. */
  text: ReactNode
  /**
   * Renders what the tip explains, given the bubble's id for `aria-describedby`, so screen
   * readers read the tip along with the control.
   */
  children: (describedBy: string) => ReactNode
  /** Where the bubble lines up: centered on the control, or ending at its right edge. */
  align?: 'center' | 'end'
  /** Shows the bubble without hover or focus, as for an error. */
  open?: boolean
  /** `danger` for an error. */
  tone?: 'info' | 'danger'
  /** Stretches the tip to fill a flex row, for an input. */
  grow?: boolean
}

/**
 * A tooltip above a control. It appears after a short hover, at once on keyboard focus, or
 * whenever `open` is set, and never takes pointer events, so it can't get in the way.
 */
export function Tip({ text, children, align = 'center', open, tone = 'info', grow }: TipProps) {
  const id = useId()
  const className = ['tip', `tip-${align}`, tone === 'danger' && 'tip-danger', grow && 'tip-grow']
    .filter(Boolean)
    .join(' ')
  return (
    <span className={className} data-open={open || undefined}>
      {children(id)}
      <span role="tooltip" id={id} className="tip-bubble">
        {text}
      </span>
    </span>
  )
}
