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
import { ErrorBoundary } from './components/ErrorBoundary'
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

try {
  const savedTheme = localStorage.getItem('hermes-mobile-theme') || 'light'
  document.documentElement.setAttribute('data-theme', savedTheme)

  const savedScale = localStorage.getItem('hermes-mobile-ui-scale')
  const parsed = savedScale ? parseFloat(savedScale) : 1.15
  if (!isNaN(parsed) && parsed >= 0.75 && parsed <= 1.5) {
    document.documentElement.style.zoom = String(parsed)
    document.documentElement.style.setProperty('--ui-scale', String(parsed))
  }
} catch {}

const rootElement = document.getElementById('root')
if (rootElement) {
  const root = createRoot(rootElement)
  root.render(
    <StrictMode>
      <ErrorBoundary onReset={() => window.location.reload()}>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}
