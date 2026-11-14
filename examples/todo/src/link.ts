import * as Y from 'yjs'

/** The origin of updates the link applies, so it doesn't send them back where they came from. */
const fromLink = Symbol('link')

export interface Link {
  /** Cuts or restores the link. Reconnecting exchanges whatever each side missed. */
  setConnected(connected: boolean): void
  destroy(): void
}

/**
 * Links two docs in memory, the way a sync provider would over a network: each update one doc
 * makes is applied to the other while connected.
 */
export function link(a: Y.Doc, b: Y.Doc): Link {
  let connected = true
  const forward = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (connected && origin !== fromLink) Y.applyUpdate(to, update, fromLink)
  }
  const toB = forward(b)
  const toA = forward(a)
  a.on('update', toB)
  b.on('update', toA)

  const exchange = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), fromLink)
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), fromLink)
  }
  exchange()

  return {
    setConnected(next) {
      connected = next
      if (next) exchange()
    },
    destroy() {
      a.off('update', toB)
      b.off('update', toA)
    },
  }
}
