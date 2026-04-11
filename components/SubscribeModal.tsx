import React from 'react';
import { PREMIUM_FEATURE_LABELS, type PremiumFeature } from '../lib/entitlement';

interface SubscribeModalProps {
  onClose: () => void;
  onSubscribe: () => void;
}

const PREMIUM_FEATURES: PremiumFeature[] = [
  'custom_notifications',
  'bank_notification_parsing',
  'spending_chart',
  'priority_help',
  'feature_requests',
  'discretionary_shield',
];

const SubscribeModal: React.FC<SubscribeModalProps> = ({ onClose, onSubscribe }) => {
  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/50 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[2rem] p-8 space-y-6 shadow-2xl animate-in zoom-in-95 duration-500 border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.746 3.746 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-slate-700 dark:text-slate-100 tracking-tight text-center">
          Subscribe for More!
        </h2>

        {/* Description */}
        <p className="text-xs text-slate-500 dark:text-slate-400 text-center leading-relaxed">
          Unlock all premium features by subscribing to Covault:
        </p>

        {/* Feature list */}
        <ul className="space-y-2.5">
          {PREMIUM_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center space-x-3">
              <span className="w-5 h-5 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </span>
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {PREMIUM_FEATURE_LABELS[feature]}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="space-y-3 pt-2">
          <button
            onClick={onSubscribe}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-sm font-semibold tracking-wide shadow-lg shadow-emerald-500/30 active:scale-[0.97] transition-all duration-200"
          >
            Upgrade Now!
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 text-slate-400 dark:text-slate-500 text-[11px] font-medium tracking-wide hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubscribeModal;
