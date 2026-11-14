import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Short name shown in the fallback, e.g. "Map". */
  name: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps one broken panel from taking the whole page down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app-crash" role="alert">
        <strong>{this.props.name}</strong>
        <span className="muted">{this.state.error.message}</span>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    )
  }
}
