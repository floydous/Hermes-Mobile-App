import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/600.css'
import '@fontsource/geist-mono/700.css'
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
