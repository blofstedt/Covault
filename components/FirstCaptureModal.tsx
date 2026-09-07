import React, { useEffect } from 'react';
import { useEscapeKey } from '../lib/hooks/useEscapeKey';
import Portal from './ui/Portal';

interface FirstCaptureModalProps {
  /** Take me to it. Closes the note and opens Review. */
  onShowMe: () => void;
  /** Dismiss without going anywhere. */
  onDismiss: () => void;
}

/**
 * "We caught one." Shown once, when the first purchase lands.
 *
 * Built to NoticeModal's measurements — same radius, same icon disc, same
 * entrance — because a second dialog shape reads as a second app. The one
 * difference is that this one has somewhere to send you, so it carries a
 * second button; the note is worth nothing if the user has to go and find
 * what it is talking about.
 *
 * The words avoid celebrating and explain instead. What a new user needs at
 * this moment is not congratulations, it is the three facts that make the
 * next tap obvious: it is waiting rather than filed, they say yes to it, and
 * only then does it count against a vial.
 */
const FirstCaptureModal: React.FC<FirstCaptureModalProps> = ({ onShowMe, onDismiss }) => {
  useEscapeKey(onDismiss);

  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onDismiss}
      >
        <div
          className="w-full max-w-[340px] bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-7 shadow-2xl animate-in zoom-in-95 duration-300 border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/30 text-emerald-500">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                <polyline points="8 9 11 12 16 6" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-600 dark:text-slate-100 tracking-tight">
                Covault caught its first purchase
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                It read your bank's alert and put the purchase in Review. Nothing
                counts against a vial until you say it is right — check the shop
                and the vial, tap to accept, and Covault will remember that shop
                next time.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={onShowMe}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-semibold text-sm active:scale-[0.97] transition-all duration-200 tracking-wide shadow-lg shadow-emerald-500/30"
            >
              Show me
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full py-3 text-slate-400 dark:text-slate-500 text-[11px] font-medium tracking-wide hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default FirstCaptureModal;
