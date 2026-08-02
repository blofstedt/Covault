import React from 'react';
import { BudgetCategory } from '../../types';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { useEscapeKey } from '../../lib/hooks/useEscapeKey';
import Portal from '../ui/Portal';

/** A vendor→category pairing the user has already taught. */
export interface ExistingRule {
  properName: string;
  categoryId: string;
  categoryName: string;
}

interface CategoryPickerSheetProps {
  vendor: string;
  budgets: BudgetCategory[];
  /**
   * Rules already known for this vendor. One is the normal case; two or more
   * means the capture pipeline refused to guess and sent it here to be picked.
   */
  existingRules?: ExistingRule[];
  onPick: (budgetId: string) => void;
  onClose: () => void;
}

const NO_RULES: ExistingRule[] = [];

/**
 * Category chooser for a caught-transaction row.
 *
 * Previously hand-rolled inside AIEnteredRow with its own backdrop (bg-black/40
 * rather than the app's slate backdrop), a 2xl radius rather than the app's
 * 2rem, no Escape handling and no icons. Extracted so it matches the rest of the
 * app's modal language and the budget grid in TransactionForm.
 */
const CategoryPickerSheet: React.FC<CategoryPickerSheetProps> = ({
  vendor,
  budgets,
  existingRules = NO_RULES,
  onPick,
  onClose,
}) => {
  useEscapeKey(onClose);

  const hasConflict = existingRules.length > 1;

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:pb-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[2rem] p-5 shadow-2xl border border-slate-100 dark:border-slate-800/60 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-250">
        <h3 className="text-base font-bold text-slate-600 dark:text-slate-100 tracking-tight">
          {hasConflict ? 'Which rule applies?' : 'Choose a category'}
        </h3>
        <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1 mb-4 leading-snug">
          {hasConflict ? (
            <>
              <span className="font-bold text-slate-500 dark:text-slate-300">{vendor}</span> has
              more than one rule, so this one needs picking.
            </>
          ) : (
            <>
              File <span className="font-bold text-slate-500 dark:text-slate-300">{vendor}</span>{' '}
              here, and remember it next time.
            </>
          )}
        </p>

        {/* Existing rules for this vendor, offered first.
            Picking one of these applies a rule the user already taught; it
            creates nothing new. Everything below is the full category list,
            where a choice teaches a new pairing. */}
        {existingRules.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
              {existingRules.length > 1 ? 'Existing Rules' : 'Existing Rule'}
            </p>
            <div className="space-y-2">
              {existingRules.map((rule) => (
                <button
                  key={`${rule.properName}::${rule.categoryId}`}
                  type="button"
                  onClick={() => {
                    onClose();
                    onPick(rule.categoryId);
                  }}
                  className="w-full min-h-[48px] flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-violet-50/70 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 hover:bg-violet-100 dark:hover:bg-violet-900/40 active:scale-[0.98] transition-all text-left"
                >
                  <span className="w-5 h-5 shrink-0 flex items-center justify-center text-violet-600 dark:text-violet-400">
                    {getBudgetIcon(rule.categoryName)}
                  </span>
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-200 truncate">
                    {rule.properName}
                    <span className="mx-1.5 opacity-40">·</span>
                    {rule.categoryName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {existingRules.length > 0 && (
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            Or file under
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {budgets.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onClose();
                onPick(b.id);
              }}
              className="min-h-[52px] flex items-center gap-2.5 px-3 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-emerald-500/50 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/20 active:scale-[0.97] transition-all text-left"
            >
              <span className="w-5 h-5 shrink-0 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                {getBudgetIcon(b.name)}
              </span>
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-200 truncate">{b.name}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full min-h-[48px] py-3 text-xs font-bold rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-[0.98]"
        >
          Cancel
        </button>
      </div>
    </div>
    </Portal>
  );
};

export default CategoryPickerSheet;
