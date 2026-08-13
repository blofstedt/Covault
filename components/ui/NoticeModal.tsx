import React, { useEffect } from 'react';
import { useEscapeKey } from '../../lib/hooks/useEscapeKey';
import Portal from './Portal';

interface NoticeModalProps {
  title: string;
  message: string;
  /** Text on the single button. Defaults to a plain acknowledgement. */
  dismissLabel?: string;
  /** Accent for the icon disc. Any CSS colour — pass a category colour to make
   *  the notice read as part of the vault it came from. */
  accentColor?: string;
  icon?: React.ReactNode;
  onDismiss: () => void;
}

/**
 * A modal that tells the user something and asks nothing.
 *
 * ConfirmModal's twin, deliberately built to the same measurements — same
 * radius, same icon disc, same type scale, same entrance — because they appear
 * in the same app and a second dialog shape would read as a second app. What it
 * drops is the choice: one button, and a backdrop that dismisses, because there
 * is nothing here to get wrong.
 *
 * Portalled. These are raised from inside a budget card, which is
 * `overflow-hidden` and sits under a fixed bottom bar; rendered in place, the
 * dialog would be clipped by its own card.
 */
const NoticeModal: React.FC<NoticeModalProps> = ({
  title,
  message,
  dismissLabel = 'Got it',
  accentColor,
  icon,
  onDismiss,
}) => {
  useEscapeKey(onDismiss);

  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const defaultIcon = (
    <svg
      className="w-8 h-8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M9 16h6" />
    </svg>
  );

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onDismiss}
      >
        <div
          className="w-full max-w-[320px] bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-8 shadow-2xl animate-in zoom-in-95 duration-300 border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center space-y-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center bg-slate-100 dark:bg-slate-800/60"
              style={
                accentColor
                  ? { backgroundColor: `${accentColor}1f`, color: accentColor }
                  : undefined
              }
            >
              <span className={accentColor ? undefined : 'text-slate-400 dark:text-slate-500'}>
                {icon || defaultIcon}
              </span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-600 dark:text-slate-100 tracking-tight">
                {title}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                {message}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            className="w-full py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-semibold text-sm active:scale-[0.97] transition-all duration-200 tracking-wide"
          >
            {dismissLabel}
          </button>
        </div>
      </div>
    </Portal>
  );
};

export default NoticeModal;
