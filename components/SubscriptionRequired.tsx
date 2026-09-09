import React from 'react';
import PageShell from './ui/PageShell';

interface SubscriptionRequiredProps {
  /** Whether this is a first-time trial ending vs. a lapsed subscription — changes only the headline. */
  reason: 'trial_ended' | 'subscription_ended';
  onSubscribe: () => void;
  onSignOut: () => Promise<void>;
}

const COPY: Record<SubscriptionRequiredProps['reason'], { title: string; body: string }> = {
  trial_ended: {
    title: 'Your free month is up',
    body: 'Covault tracked your spending and captured your purchases automatically for the last month. Keep it going for $6.99/month.',
  },
  subscription_ended: {
    title: 'Your subscription has ended',
    body: 'Covault has paused — your budgets and past transactions are safe, but capture is off until you resubscribe.',
  },
};

/**
 * The whole-app lock screen. Nothing behind this renders — see
 * lib/entitlement.ts for the rule that decides whether this shows at all,
 * and App.tsx for where it sits in the render tree, in place of Dashboard.
 */
const SubscriptionRequired: React.FC<SubscriptionRequiredProps> = ({ reason, onSubscribe, onSignOut }) => {
  const copy = COPY[reason];

  return (
    <PageShell>
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[2rem] p-8 space-y-6 shadow-2xl border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          </div>

          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold text-slate-700 dark:text-slate-100 tracking-tight">{copy.title}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{copy.body}</p>
          </div>

          <div className="text-center">
            <span className="text-3xl font-bold text-slate-700 dark:text-slate-100 tracking-tight">$6.99</span>
            <span className="text-sm text-slate-400 dark:text-slate-500"> / month</span>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={onSubscribe}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-sm font-semibold tracking-wide shadow-lg shadow-emerald-500/30 active:scale-[0.97] transition-all duration-200"
            >
              Subscribe
            </button>
            <button
              onClick={() => { onSignOut(); }}
              className="w-full py-3 text-slate-400 dark:text-slate-500 text-[11px] font-medium tracking-wide hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Sign out
            </button>
          </div>

          <p className="text-center text-[10px] text-slate-400 dark:text-slate-500">
            Questions? <a href="mailto:itsjustmyemail@gmail.com?subject=Covault: Subscription" className="underline">itsjustmyemail@gmail.com</a>
          </p>
        </div>
      </div>
    </PageShell>
  );
};

export default SubscriptionRequired;
