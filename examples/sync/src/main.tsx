import { Provider } from 'jotai'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { openRoom } from './sync'
import './styles.css'

// Render once this browser's saved copy is loaded, so the app never flashes an empty list.
const { store, connection, clearLocal } = await openRoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App connection={connection} clearLocal={clearLocal} />
    </Provider>
  </StrictMode>,
)
