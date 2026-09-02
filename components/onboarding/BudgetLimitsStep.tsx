import React, { useState } from 'react';
import type { BudgetCategory } from '../../types';
import OnboardingStepShell from './OnboardingStepShell';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { getBudgetColor } from '../../lib/budgetColors';
import { formatCurrency } from '../../lib/formatCurrency';
import {
  allocationTotal,
  allocationTotalWith,
  isAllowedLimitChange,
  remainingToAllocate,
} from '../../lib/budgetAllocation';

interface BudgetLimitsStepProps {
  /**
   * The budgets as loaded from the database.
   *
   * Deliberately NOT `SYSTEM_CATEGORIES`. The `budgets` table has no id column,
   * so a loaded row's id is `budget:<name>` while the starter constants carry
   * fixed UUIDs — and `hiddenCategories` stores whichever id was on screen when
   * the eye was tapped. Rendering the constants here would let a user hide a
   * category under one id and have the real load, landing a moment later,
   * un-hide it under another.
   */
  budgets: BudgetCategory[];
  hiddenCategories: string[];
  /** False while the first load is still in flight. */
  budgetsReady: boolean;
  monthlyIncome: number;
  stepNumber: number;
  stepCount: number;
  onSaveLimit: (categoryId: string, limit: number) => void;
  onToggleHide: (categoryId: string, visible: boolean) => void;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * Where the month's money goes.
 *
 * Every limit starts at $500 for everyone, which is nobody's actual budget, and
 * the only place to change it was a settings screen a new user had no reason to
 * open. So the first month was measured against seven numbers the app made up.
 *
 * Each change is written as it is made rather than collected and saved at the
 * end — the end is a moment a user may never reach, since the step after this
 * one sends them out to Android's settings.
 */
const BudgetLimitsStep: React.FC<BudgetLimitsStepProps> = ({
  budgets,
  hiddenCategories,
  budgetsReady,
  monthlyIncome,
  stepNumber,
  stepCount,
  onSaveLimit,
  onToggleHide,
  onNext,
  onSkip,
}) => {
  const [editing, setEditing] = useState<Record<string, string>>({});

  const total = allocationTotal(budgets, hiddenCategories);
  const remaining = remainingToAllocate(monthlyIncome, total);
  const hasIncome = monthlyIncome > 0;

  const commit = (budget: BudgetCategory) => {
    const raw = editing[budget.id];
    setEditing((prev) => {
      const next = { ...prev };
      delete next[budget.id];
      return next;
    });
    if (raw === undefined || raw === '') return;
    const limit = parseFloat(raw);
    if (Number.isNaN(limit) || limit <= 0) return;
    const nextTotal = allocationTotalWith(budgets, hiddenCategories, budget.id, limit);
    // The same rule the settings screen follows: only a change that pushes
    // further past the income is refused, so nobody can be stuck over the line
    // with no way down. See lib/budgetAllocation.ts.
    if (!isAllowedLimitChange({ previousTotal: total, nextTotal, income: monthlyIncome })) return;
    onSaveLimit(budget.id, limit);
  };

  const body = () => {
    if (!budgetsReady) {
      return (
        <p className="text-center text-slate-400 dark:text-slate-500 text-xs font-medium tracking-wide">
          Setting up your categories…
        </p>
      );
    }
    if (budgets.length === 0) {
      // The read failed. Saying so beats an empty screen the user cannot act
      // on, and Settings still has the real list once a read succeeds.
      return (
        <p className="text-center text-slate-400 dark:text-slate-500 text-xs font-medium tracking-wide leading-relaxed">
          We couldn't load your categories just now. You can set your limits in
          Settings once you're in.
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {budgets.map((budget, index) => {
          const isHidden = hiddenCategories.includes(budget.id);
          const value =
            editing[budget.id] !== undefined ? editing[budget.id] : String(budget.totalLimit);

          return (
            <div
              key={budget.id}
              className={`flex items-center gap-3 p-3 rounded-2xl border transition-all duration-200 ${
                isHidden
                  ? 'bg-slate-100/40 dark:bg-slate-900/30 border-transparent opacity-50'
                  : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/60'
              }`}
            >
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${getBudgetColor(budget.name, index)}22` }}
              >
                <span
                  className="w-4 h-4 flex items-center justify-center"
                  style={{ color: getBudgetColor(budget.name, index) }}
                >
                  {getBudgetIcon(budget.name)}
                </span>
              </span>

              <span
                className={`text-sm font-bold flex-1 min-w-0 truncate ${
                  isHidden
                    ? 'text-slate-400 dark:text-slate-600 line-through'
                    : 'text-slate-600 dark:text-slate-200'
                }`}
              >
                {budget.name}
              </span>

              {isHidden ? (
                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-600 tracking-wide">
                  Not using
                </span>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs font-bold text-slate-300 dark:text-slate-600">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={value}
                    onChange={(e) =>
                      setEditing((prev) => ({ ...prev, [budget.id]: e.target.value }))
                    }
                    onBlur={() => commit(budget)}
                    className="w-20 px-2 py-2 text-sm font-bold text-right text-slate-600 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => onToggleHide(budget.id, isHidden)}
                title={isHidden ? 'Use this category' : "I don't use this"}
                className="p-2 rounded-xl text-slate-300 dark:text-slate-600 active:scale-[0.97] transition-all duration-200 shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {isHidden ? (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  ) : (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <OnboardingStepShell
      title="Where does it go?"
      subtitle="Set what you mean to spend on each. Hide the ones you don't use — you can bring them back later."
      stepNumber={stepNumber}
      stepCount={stepCount}
      primaryLabel="Continue"
      onPrimary={onNext}
      onSkip={onSkip}
    >
      {hasIncome && budgetsReady && budgets.length > 0 && (
        <div className="flex items-baseline justify-between px-2 pb-3">
          <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide">
            {remaining < 0 ? 'Over your income by' : 'Left to allocate'}
          </span>
          <span
            className={`text-lg font-black tracking-tight ${
              remaining < 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-600 dark:text-slate-200'
            }`}
          >
            {formatCurrency(Math.abs(remaining))}
          </span>
        </div>
      )}
      {body()}
    </OnboardingStepShell>
  );
};

export default BudgetLimitsStep;
