import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Crash location:', info.componentStack);
    console.error('Error:', error.message, error);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      const firstStackLine = e.stack?.split('\n')[1]?.trim() ?? '';
      return (
        <div
          style={{
            minHeight: '40vh',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#0f172a',
            color: '#f8fafc',
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12, color: '#fca5a5' }}>Component crashed</h1>
          <p style={{ color: '#94a3b8', marginBottom: 16 }}>
            Check the browser console for the full component stack.
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
            {firstStackLine ? `\n${firstStackLine}` : ''}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
