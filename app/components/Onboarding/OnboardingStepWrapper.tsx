import type React from 'react';

/** Hoisted to module scope: defining this inside the component body gave it a
 *  new identity every render, so React unmounted and remounted the entire step
 *  subtree on each keystroke — which reset the partner-email input's focus. */
const OnboardingStepWrapper = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
  <div className={`flex-1 flex flex-col p-8 bg-slate-50 dark:bg-slate-950 transition-colors relative overflow-hidden ${className}`}>
    {children}
  </div>
);

export default OnboardingStepWrapper;
