import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl">
            <h1 className="text-xl font-bold text-red-500 mb-4">Something went wrong</h1>
            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 mb-4 overflow-auto max-h-48">
              <p className="text-sm font-mono text-slate-700 dark:text-slate-300">
                {this.state.error?.message || 'Unknown error'}
              </p>
            </div>
            {this.state.errorInfo && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer mb-2">Stack trace</summary>
                <pre className="overflow-auto max-h-48 bg-slate-100 dark:bg-slate-800 p-2 rounded">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-4 w-full py-2 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
