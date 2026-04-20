import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#0f172a',
            color: '#f8fafc',
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: '#94a3b8', marginBottom: 16 }}>
            The UI crashed while rendering. Details below (check the browser console for the full stack).
          </p>
          <pre
            style={{
              background: '#020617',
              padding: 16,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
              color: '#fca5a5',
              whiteSpace: 'pre-wrap',
            }}
          >
            {e.name}: {e.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
