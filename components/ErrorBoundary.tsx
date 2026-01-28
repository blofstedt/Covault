// src/components/ErrorBoundary.tsx
import React from 'react';

export class ErrorBoundary extends React.Component<{children:any}, {hasError:boolean, error?:any}> {
  constructor(props:any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error:any) { return { hasError: true, error }; }
  componentDidCatch(error:any, info:any) { console.error('ErrorBoundary caught', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding:20, fontFamily:'system-ui,Segoe UI,Roboto'}}>
          <h2>Something went wrong</h2>
          <pre style={{whiteSpace:'pre-wrap', background:'#f8f8f8', padding:12, borderRadius:6}}>
            {String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
