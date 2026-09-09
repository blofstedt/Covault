import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FullScreenLoader from './components/FullScreenLoader';
import './index.css';
import { initErrorReporting } from './lib/errorReporting';

// Only one of the four routes ever renders. The static pages are lazy so
// they stay out of the entry chunk that the app itself loads from.
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const Terms = lazy(() => import('./components/Terms'));
const DeleteAccountRequest = lazy(() => import('./components/DeleteAccountRequest'));

// Before the first render, so an error thrown during mount is still reported.
// Fire and forget: it loads the reporter in the background and a build with no
// DSN does nothing at all here.
initErrorReporting();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Simple path-based routing for static pages
const getPageComponent = () => {
  const path = window.location.pathname;
  if (path === '/privacy') return <PrivacyPolicy />;
  if (path === '/terms') return <Terms />;
  if (path === '/delete') return <DeleteAccountRequest />;
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
