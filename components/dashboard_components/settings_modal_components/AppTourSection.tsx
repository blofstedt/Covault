import React from 'react';

interface AppTourSectionProps {
  onReplayTour: () => void;
}

/**
 * The way back into the walkthrough.
 *
 * The tour is the last step of the intro, and the intro is shown once — so
 * anyone who skipped it, or met it before they had spent anything, had no
 * route back to it at all. It sits beside "Frequently Asked" and is drawn as
 * its own twin rather than as a card, because the two are the same kind of
 * thing: the places you go when you do not know how something works.
 */
const AppTourSection: React.FC<AppTourSectionProps> = ({ onReplayTour }) => (
  <button
    id="app-tour-button"
    type="button"
    onClick={onReplayTour}
    className="w-full py-5 bg-slate-50 dark:bg-slate-800/30 border-2 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-all duration-200 tracking-wide shadow-sm active:scale-[0.98]"
  >
    Show Me Around Again
  </button>
);

export default AppTourSection;
