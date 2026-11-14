import { docAtom } from 'duratom'
import { createStore } from 'jotai'
import { IndexeddbPersistence } from 'y-indexeddb'
import YProvider from 'y-partyserver/provider'
import * as Y from 'yjs'

/** The room in the page's `?room=`; every device on the same room shares one doc. */
export const room = new URLSearchParams(location.search).get('room') || 'demo'

/** Whether the app should be connected, kept across reloads so it can start offline. */
const ONLINE_KEY = `duratom-sync:online:${room}`
const wantsOnline = () => localStorage.getItem(ONLINE_KEY) !== 'false'

export type Status = 'offline' | 'connecting' | 'connected' | 'synced'

/**
 * The room's doc, with both providers attached: y-indexeddb saves every change in this browser
 * and loads it on start, and y-partyserver syncs it through the Worker's Durable Object for the
 * room. Atoms read the doc in `docAtom` and know about neither.
 */
export async function openRoom() {
  const doc = new Y.Doc()
  // One IndexedDB database per room: two docs saved under one name would be merged.
  const persistence = new IndexeddbPersistence(`duratom-sync:${room}`, doc)
  // `disableBc` keeps tabs of one browser from syncing over BroadcastChannel, so every update
  // goes through the server and "offline" means offline.
  const provider = new YProvider(location.host, room, doc, {
    party: 'docs',
    connect: false,
    disableBc: true,
    protocol: location.protocol === 'https:' ? 'wss' : 'ws',
  })

  const store = createStore()
  store.set(docAtom, doc)

  // Load what this browser saved before connecting, so the app opens with it even offline. Edits
  // made offline are in that state, and connecting sends them to the server.
  await persistence.whenSynced

  let status: Status = 'offline'
  const listeners = new Set<() => void>()
  const setStatus = (next: Status) => {
    if (next === status) return
    status = next
    listeners.forEach((listener) => listener())
  }
  provider.on('status', ({ status: ws }: { status: string }) => {
    if (!provider.shouldConnect) setStatus('offline')
    else if (ws === 'connected') setStatus(provider.synced ? 'synced' : 'connected')
    else setStatus('connecting')
  })
  provider.on('sync', (synced: boolean) => {
    if (provider.wsconnected) setStatus(synced ? 'synced' : 'connected')
  })

  const setOnline = (online: boolean) => {
    localStorage.setItem(ONLINE_KEY, String(online))
    if (online) {
      setStatus('connecting')
      void provider.connect()
    } else {
      provider.disconnect()
      setStatus('offline')
    }
  }
  if (wantsOnline()) setOnline(true)

  return {
    store,
    connection: {
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      status: () => status,
      setOnline,
    },
    /** Forgets this browser's copy of the room, as a new device would start. */
    async clearLocal() {
      provider.destroy()
      await persistence.clearData()
    },
  }
}

export type Connection = Awaited<ReturnType<typeof openRoom>>['connection']
