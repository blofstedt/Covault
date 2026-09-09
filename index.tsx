import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FullScreenLoader from './components/FullScreenLoader';
import './index.css';
import { initErrorReporting } from './lib/errorReporting';

// Only one of the three routes ever renders. The two static pages are lazy
// so they stay out of the entry chunk that the app itself loads from.
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const Terms = lazy(() => import('./components/Terms'));

// Before the first render, so an error thrown during mount is still reported.
// Fire and forget: it loads the reporter in the background and a build with no
// DSN does nothing at all here.
initErrorReporting();

// TEMPORARY — one-time verification that a real error actually reaches
// Sentry through the deployed bundle, with the scrubbing rules in
// lib/errorReporting.ts genuinely applied rather than inspected as source.
// Fires only on ?sentry-test=1, waits for the dynamic Sentry import to
// finish, then throws for real so Sentry's own global handler catches it —
// not a call to reportError(), which would only prove our wrapper works.
// Remove this block once confirmed. Safe: it is inert on every ordinary URL.
if (typeof window !== 'undefined' && window.location.search.includes('sentry-test=1')) {
  setTimeout(() => {
    throw new Error('Covault Sentry verification test — safe to ignore, no user data');
  }, 4000);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Simple path-based routing for static pages
const getPageComponent = () => {
  const path = window.location.pathname;
  if (path === '/privacy') return <PrivacyPolicy />;
  if (path === '/terms') return <Terms />;
  return <App />;
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Suspense fallback={<FullScreenLoader />}>
      {getPageComponent()}
    </Suspense>
  </React.StrictMode>
);
