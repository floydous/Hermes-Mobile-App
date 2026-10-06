import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  onReset?: () => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Session view error:', error, errorInfo)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return (
        <main className="app chat-shell">
          <header className="chat-header">
            <button className="round-control" onClick={this.reset} aria-label="Back">
              <ArrowLeft size={18} />
            </button>
            <div className="chat-title">
              <span><b>Session error</b></span>
            </div>
            <button className="round-control" onClick={this.reset} aria-label="Retry">
              <RefreshCw size={16} />
            </button>
          </header>
          <div className="chat-empty-state" style={{ padding: '32px 24px' }}>
            <h1>COULD NOT DISPLAY SESSION</h1>
            <p style={{ maxWidth: 360, margin: '12px auto', color: '#ff6b6b' }}>
              {this.state.error.message || 'An unexpected rendering error occurred.'}
            </p>
            <button className="primary" style={{ marginTop: 16 }} onClick={this.reset}>
              Return to Sessions
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
