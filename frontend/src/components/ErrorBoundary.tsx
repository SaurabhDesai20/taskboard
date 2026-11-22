import { Component, type ErrorInfo, type ReactNode } from 'react'
import { MAIN_CONTENT_ID } from '../lib/focus'
import { ErrorFallback } from './ErrorFallback'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * The app's last line of defence: a render error anywhere below it (outside the router's own
 * route error pages) shows `ErrorFallback` instead of a blank screen. "Try again" renders the
 * children again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Kept in the console for debugging; React logs the error itself as well.
    console.error('Unhandled render error', error, info.componentStack)
  }

  private readonly retry = () => this.setState({ failed: false })

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="app-main" id={MAIN_CONTENT_ID} tabIndex={-1}>
          <ErrorFallback onRetry={this.retry} />
        </main>
      )
    }
    return this.props.children
  }
}
