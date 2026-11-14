import { routePartykitRequest, type Connection } from 'partyserver'
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'

interface Env {
  // The binding's name, in kebab case, is the `party` the client connects to: `docs`.
  Docs: DurableObjectNamespace<Docs>
}

/**
 * One Durable Object per room, holding that room's doc and saving it to its own storage, so a
 * device that has never opened the room, or has cleared its storage, gets the doc from here.
 */
export class Docs extends YServer<Env> {
  // Save a second after edits stop, and at least every five seconds while they don't.
  static override callbackOptions = { debounceWait: 1000, debounceMaxWait: 5000 }

  override async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>('doc')
    if (saved) Y.applyUpdate(this.document, saved)
  }

  override async onSave() {
    await this.ctx.storage.put('doc', Y.encodeStateAsUpdate(this.document))
  }

  /**
   * The Yjs provider's `disconnect()` closes its socket with no code, which arrives as 1005.
   * partyserver 0.5.10 takes 1005 to mean no Close frame was sent and doesn't answer it, so on
   * Cloudflare the browser's socket stays closing and the provider can't reconnect until it times
   * out. Answering the close here completes the handshake.
   */
  override onClose(connection: Connection, code: number, reason: string, wasClean: boolean) {
    super.onClose(connection, code, reason, wasClean)
    if (code === 1005) {
      try {
        connection.close(1000, 'Closed by client')
      } catch {
        // Already closed.
      }
    }
  }
}

export default {
  // `/parties/docs/<room>` reaches the room's Durable Object; the app's files are static assets,
  // served before the Worker runs.
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
