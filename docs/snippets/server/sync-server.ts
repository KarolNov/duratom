// src/index.ts of a Cloudflare Worker.
import { routePartykitRequest } from 'partyserver'
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'

interface Env {
  // The binding's name, in kebab case, is the `party` the client connects to: `docs`.
  Docs: DurableObjectNamespace<Docs>
}

/** One Durable Object per room, holding that room's doc and saving it to its own storage. */
export class Docs extends YServer<Env> {
  override async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>('doc')
    if (saved) Y.applyUpdate(this.document, saved)
  }

  // Called a few seconds after edits, and when the last client leaves.
  override async onSave() {
    await this.ctx.storage.put('doc', Y.encodeStateAsUpdate(this.document))
  }
}

export default {
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
