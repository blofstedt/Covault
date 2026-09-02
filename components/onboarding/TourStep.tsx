import React, { useState } from 'react';
import OnboardingStepShell from './OnboardingStepShell';

interface TourStepProps {
  stepNumber: number;
  stepCount: number;
  onFinish: () => void;
}

/**
 * The three screens, before the user meets them.
 *
 * Drawn rather than pointed at. A spotlight tour over the live dashboard would
 * need an overlay system the app does not have, would have to open a real entry
 * form over a real vault where a stray tap writes a real transaction, and —
 * worst of all — would be circling an empty dashboard, because a brand-new user
 * has no spending in it yet. A sketch can show the app as it looks once it has
 * been used, which is the thing worth showing. Same reasoning as the App info
 * sketch in NotificationAccessGuide.
 */
const CARDS: Array<{ title: string; body: string; art: React.ReactNode }> = [
  {
    title: 'Your month, at a glance',
    body: "Each vial is one category, filling as you spend. Tap one to see what's in it.",
    art: (
      <div className="w-full max-w-[15rem] space-y-2">
        {[
          { w: '78%', c: '#6366f1' },
          { w: '46%', c: '#10b981' },
          { w: '92%', c: '#f59e0b' },
        ].map((bar, i) => (
          <div
            key={i}
            className="h-9 rounded-2xl bg-slate-100 dark:bg-slate-800/60 overflow-hidden relative"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-2xl opacity-70"
              style={{ width: bar.w, backgroundColor: bar.c }}
            />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Add anything by hand',
    body: 'Cash, or a purchase your bank never announced. Amount, who you paid, which vial.',
    art: (
      <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl shadow-emerald-500/30">
        <svg
          className="w-10 h-10 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={3}
          strokeLinecap="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    ),
  },
  {
    title: 'Check what was caught',
    body: "Captured purchases wait here for a nod. The number is how many haven't been looked at.",
    art: (
      <div className="relative">
        <svg
          className="w-20 h-20 text-slate-300 dark:text-slate-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
        <span className="absolute -top-1 -right-1 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-emerald-500 text-white text-xs font-black flex items-center justify-center">
          3
        </span>
      </div>
    ),
  },
];

const TourStep: React.FC<TourStepProps> = ({ stepNumber, stepCount, onFinish }) => {
  const [card, setCard] = useState(0);
  const isLast = card === CARDS.length - 1;

  return (
    <OnboardingStepShell
      title={CARDS[card].title}
      subtitle={CARDS[card].body}
      stepNumber={stepNumber}
      stepCount={stepCount}
      primaryLabel={isLast ? "Let's go" : 'Next'}
      onPrimary={() => (isLast ? onFinish() : setCard(card + 1))}
      onSkip={isLast ? undefined : onFinish}
      skipLabel="Skip the tour"
    >
      <div className="flex flex-col items-center justify-center min-h-[13rem]">
        <div
          key={card}
          className="w-full flex items-center justify-center animate-in fade-in duration-300"
        >
          {CARDS[card].art}
        </div>

        <div className="flex space-x-2 mt-8">
          {CARDS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === card ? 'w-6 bg-slate-300 dark:bg-slate-700' : 'w-1.5 bg-slate-200 dark:bg-slate-800'
              }`}
            />
          ))}
        </div>
      </div>
    </OnboardingStepShell>
  );
};

export default TourStep;
