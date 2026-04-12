import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div className="max-w-sm text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-lg font-bold text-slate-700 dark:text-slate-200">Something went wrong</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The app hit an unexpected error. Try refreshing the page.
            </p>
            <pre className="text-[10px] text-left bg-slate-100 dark:bg-slate-800 p-3 rounded-xl overflow-auto max-h-32 text-rose-500">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-2xl text-xs font-semibold tracking-wide"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
