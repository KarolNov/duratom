import { atom } from 'jotai'

// react-scan only sees renders from the moment it loads, and React hooks into it at startup, so it
// is loaded before the first render when enabled. Turning it on later therefore reloads the page;
// turning it off is live.
const KEY = 'duratom-todo:react-scan'

// `?scan` turns it on. Stored here, as the module loads, so `scanOnAtom` below starts from it too.
try {
  if (new URLSearchParams(location.search).has('scan')) localStorage.setItem(KEY, '1')
} catch {}

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let loaded: Promise<typeof import('react-scan')> | undefined
const load = () => (loaded ??= import('react-scan'))

/** Loads react-scan before the first render when it was left on, or when the URL has `?scan`. */
export async function initScan() {
  if (!read()) return
  const { scan } = await load()
  scan({ enabled: true, showToolbar: true, dangerouslyForceRunInProduction: true })
}

/**
 * Whether react-scan is on, for the toggle and for the parts of the page shown only with it. In
 * Jotai's default store, since the app's controls sit outside the panes' own stores.
 */
export const scanOnAtom = atom(read())

export async function setScan(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {}
  if (loaded) {
    const { setOptions } = await loaded
    setOptions({ enabled: on, showToolbar: on })
  } else if (on) {
    location.reload()
  }
}
