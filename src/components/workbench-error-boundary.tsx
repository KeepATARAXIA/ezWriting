import { Component, type ErrorInfo, type ReactNode } from 'react'

interface WorkbenchErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  resetKey: unknown
}

interface WorkbenchErrorBoundaryState {
  failed: boolean
}

export class WorkbenchErrorBoundary extends Component<WorkbenchErrorBoundaryProps, WorkbenchErrorBoundaryState> {
  state: WorkbenchErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): WorkbenchErrorBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previousProps: WorkbenchErrorBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // React reports the original stack; the boundary keeps the rest of the workbench usable.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
