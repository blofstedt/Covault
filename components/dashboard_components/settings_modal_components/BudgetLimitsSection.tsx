import React, { useState } from 'react';
import { BudgetCategory } from '../../../types';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import { formatCurrency } from '../../../lib/formatCurrency';
import {
  allocationTotal,
  allocationTotalWith,
  isAllowedLimitChange,
  remainingToAllocate,
} from '../../../lib/budgetAllocation';

interface BudgetLimitsSectionProps {
  budgets: BudgetCategory[];
  onSaveBudgetLimit: (categoryId: string, newLimit: number) => void;
  hiddenCategories?: string[];
  onToggleHideCategory?: (categoryId: string) => void;
  monthlyIncome?: number;
}

const BudgetLimitsSection: React.FC<BudgetLimitsSectionProps> = ({
  budgets,
  onSaveBudgetLimit,
  hiddenCategories = [],
  onToggleHideCategory,
  monthlyIncome,
}) => {
  const [editingBudgets, setEditingBudgets] = useState<Record<string, string>>({});
  const [overAllocatedMessage, setOverAllocatedMessage] = useState<string | null>(null);

  // What is planned, and what is left — shown at all times rather than only
  // after a save has been refused. See lib/budgetAllocation.ts for why a save
  // is now refused far less often than it was.
  const total = allocationTotal(budgets, hiddenCategories);
  const remaining = remainingToAllocate(monthlyIncome ?? 0, total);
  const hasIncome = (monthlyIncome ?? 0) > 0;

  const handleInputChange = (budgetId: string, value: string) => {
    setOverAllocatedMessage(null);
    setEditingBudgets(prev => ({ ...prev, [budgetId]: value }));
  };

  const handleSave = (budget: BudgetCategory) => {
    const newValue = editingBudgets[budget.id];
    if (newValue !== undefined && newValue !== '') {
      const newLimit = parseFloat(newValue);
      if (!isNaN(newLimit) && newLimit > 0) {
        const nextTotal = allocationTotalWith(budgets, hiddenCategories, budget.id, newLimit);

        // Only a change that pushes FURTHER past the income is refused. One
        // that reduces an already-over total is the user digging themselves
        // out, and refusing it left them with no way to.
        if (!isAllowedLimitChange({ previousTotal: total, nextTotal, income: monthlyIncome ?? 0 })) {
          setOverAllocatedMessage(
            `That would plan ${formatCurrency(nextTotal)} against an income of ${formatCurrency(monthlyIncome ?? 0)}. Lower another category, or raise your monthly income.`
          );
          // Revert input to the previous value
          setEditingBudgets(prev => {
            const updated = { ...prev };
            delete updated[budget.id];
            return updated;
          });
          return;
        }

        setOverAllocatedMessage(null);
        onSaveBudgetLimit(budget.id, newLimit);
        // Clear the editing state for this budget
        setEditingBudgets(prev => {
          const updated = { ...prev };
          delete updated[budget.id];
          return updated;
        });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, budget: BudgetCategory) => {
    if (e.key === 'Enter') {
      handleSave(budget);
    }
  };

  return (
    <SettingsCard id="settings-budget-limits-container" className="space-y-4">
      <SectionHeader
        title="Budget Limits"
        subtitle="Set your monthly budget limit for each category. Tap the eye icon to hide categories you don't use."
      />

      {hasIncome && (
        <div className="flex items-baseline justify-between px-1">
          <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide">
            {remaining < 0 ? 'Over your income by' : 'Left to allocate'}
          </span>
          <span
            className={`text-sm font-black tracking-tight ${
              remaining < 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-600 dark:text-slate-200'
            }`}
          >
            {formatCurrency(Math.abs(remaining))}
          </span>
        </div>
      )}

      {overAllocatedMessage && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl">
          <p className="text-xs font-bold text-red-600 dark:text-red-400 leading-relaxed">
            {overAllocatedMessage}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {budgets.map((budget) => {
          const isHidden = hiddenCategories.includes(budget.id);
          const isEditing = editingBudgets[budget.id] !== undefined;
          const displayValue = isEditing 
            ? editingBudgets[budget.id] 
            : budget.totalLimit.toString();

          return (
            <div
              key={budget.id}
              className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
                isHidden
                  ? 'bg-slate-100/50 dark:bg-slate-800/20 opacity-50'
                  : 'bg-white dark:bg-slate-900/50'
              }`}
            >
              <label
                htmlFor={`budget-${budget.id}`}
                className={`text-xs font-bold truncate flex-1 min-w-0 ${
                  isHidden ? 'text-slate-400 dark:text-slate-600 line-through' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {budget.name}
              </label>

              <div className="flex items-center gap-2 shrink-0">
                {!isHidden ? (
                  <>
                    <span className="text-xs font-bold text-slate-400">$</span>
                    <input
                      id={`budget-${budget.id}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={displayValue}
                      onChange={(e) => handleInputChange(budget.id, e.target.value)}
                      onBlur={() => handleSave(budget)}
                      onKeyDown={(e) => handleKeyDown(e, budget)}
                      className="w-20 px-2 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors"
                    />
                  </>
                ) : (
                  <span className="text-[11px] font-medium text-slate-400 dark:text-slate-600 tracking-wide">Hidden</span>
                )}
                {onToggleHideCategory && (
                  <button
                    type="button"
                    onClick={() => onToggleHideCategory(budget.id)}
                    className={`p-2 rounded-xl transition-all duration-200 active:scale-[0.97] shrink-0 ${
                      isHidden
                        ? 'text-slate-400 dark:text-slate-600 hover:text-emerald-500'
                        : 'text-slate-300 dark:text-slate-600 hover:text-slate-500'
                    }`}
                    title={isHidden ? 'Show category' : 'Hide category'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
};

export default BudgetLimitsSection;
