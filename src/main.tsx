import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './chat.css'
import './wizard.css'
import './activity.css'
import './mobile-overrides.css'
import './avatar.css'
import './profile-sheet.css'
import './management.css'
import './appearance-picker.css'
import './theme.css'
import './connection-settings.css'
import './edge-swipe.css'
import './transitions.css'

const rootElement = document.getElementById('root')
if (rootElement) {
  const root = createRoot(rootElement)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
