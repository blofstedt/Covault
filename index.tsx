import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FullScreenLoader from './components/FullScreenLoader';
import './index.css';

// Only one of the three routes ever renders. The two static pages are lazy
// so they stay out of the entry chunk that the app itself loads from.
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const Terms = lazy(() => import('./components/Terms'));

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
