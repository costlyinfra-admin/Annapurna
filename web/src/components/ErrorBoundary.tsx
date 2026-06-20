/** Catches render errors so a bug shows a friendly message, not a white screen. */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-center">
          <div className="auth-card">
            <h2>Something went wrong</h2>
            <p className="muted">The page hit an unexpected error. Reloading usually fixes it.</p>
            <button onClick={() => window.location.assign("/")}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
