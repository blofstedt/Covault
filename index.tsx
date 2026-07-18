import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PrivacyPolicy from './components/PrivacyPolicy';
import Terms from './components/Terms';
import './index.css';

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
    {getPageComponent()}
  </React.StrictMode>
);