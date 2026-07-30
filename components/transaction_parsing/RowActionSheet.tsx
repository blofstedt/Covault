import React from 'react';
import { useEscapeKey } from '../../lib/hooks/useEscapeKey';
import Portal from '../ui/Portal';

export interface RowAction {
  label: string;
  /** Optional second line explaining what the action does. */
  hint?: string;
  tone?: 'default' | 'danger';
  icon?: React.ReactNode;
  onSelect: () => void;
}

interface RowActionSheetProps {
  title: string;
  actions: RowAction[];
  onClose: () => void;
}

/**
 * Compact action sheet for the secondary actions on a caught-transaction row.
 *
 * The row used to show up to five ~24px chips side by side, all of which had to
 * stopPropagation because the row itself was a tap target. Moving everything but
 * the primary action in here lets each option be a full-width, comfortably-sized
 * target, and lets the labels say what they actually do.
 *
 * Rendered as a centered sheet rather than an anchored popover on purpose: the
 * row lives inside a scrolling container, and an absolutely-positioned menu
 * would clip at the container's edge.
 *
 * Portalled to <body> because the Review page's <main> is `relative z-10` and
 * so caps everything inside it below the `z-40` bottom nav bar — which used to
 * paint over this sheet's Cancel button. The bottom padding clears Android's
 * gesture bar as well, so the last action isn't sitting under it.
 */
const RowActionSheet: React.FC<RowActionSheetProps> = ({ title, actions, onClose }) => {
  useEscapeKey(onClose);

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:pb-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[2rem] p-4 shadow-2xl border border-slate-100 dark:border-slate-800/60 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-250">
        <p className="text-[11px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 px-2 pb-2 truncate">
          {title}
        </p>

        <div className="flex flex-col gap-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className={`w-full min-h-[52px] flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors active:scale-[0.98] ${
                action.tone === 'danger'
                  ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              {action.icon && <span className="w-5 h-5 shrink-0 flex items-center justify-center">{action.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold leading-tight">{action.label}</span>
                {action.hint && (
                  <span className="block text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                    {action.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full min-h-[48px] py-3 text-xs font-bold rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-[0.98]"
        >
          Cancel
        </button>
      </div>
    </div>
    </Portal>
  );
};

export default RowActionSheet;
