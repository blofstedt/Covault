import type React from 'react';

/** Pump icon, shared by both panels so they read as one feature. */
const PumpIcon: React.FC = () => (
  <svg
    className="w-4 h-4 mt-0.5 shrink-0 text-amber-500 dark:text-amber-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 22h12V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v18z" />
    <path d="M6 8h6" />
    <path d="M15 9h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2" />
  </svg>
);


export default PumpIcon;
