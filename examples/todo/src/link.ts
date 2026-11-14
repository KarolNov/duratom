import * as Y from 'yjs'

/** The origin of updates the link applies, so it doesn't send them back where they came from. */
const fromLink = Symbol('link')

export interface Link {
  /** Cuts or restores the link. Reconnecting exchanges whatever each side missed. */
  setConnected(connected: boolean): void
  /** How long an update takes to reach the other doc, in milliseconds; 0 delivers it at once. */
  setLatency(ms: number): void
  destroy(): void
}

/**
 * Links two docs in memory, the way a sync provider would over a network: each update one doc
 * makes is applied to the other while connected, after the link's latency. An update still in
 * flight when the link is cut is lost, as on a network, and the exchange on reconnect makes up
 * for it.
 */
export function link(a: Y.Doc, b: Y.Doc): Link {
  let connected = true
  let latency = 0
  const inFlight = new Set<ReturnType<typeof setTimeout>>()

  const deliver = (to: Y.Doc, update: Uint8Array) => {
    if (latency === 0) return Y.applyUpdate(to, update, fromLink)
    const timer = setTimeout(() => {
      inFlight.delete(timer)
      // Yjs holds an update that arrives before one it depends on until the other arrives.
      if (connected) Y.applyUpdate(to, update, fromLink)
    }, latency)
    inFlight.add(timer)
  }

  const forward = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (connected && origin !== fromLink) deliver(to, update)
  }
  const toB = forward(b)
  const toA = forward(a)
  a.on('update', toB)
  b.on('update', toA)

  const exchange = () => {
    deliver(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    deliver(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  }
  exchange()

  return {
    setConnected(next) {
      connected = next
      if (next) exchange()
    },
    setLatency(ms) {
      latency = Math.max(0, ms)
    },
    destroy() {
      a.off('update', toB)
      b.off('update', toA)
      for (const timer of inFlight) clearTimeout(timer)
      inFlight.clear()
    },
  }
}
