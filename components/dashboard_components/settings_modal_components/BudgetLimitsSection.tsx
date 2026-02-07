import React, { useState } from 'react';
import { BudgetCategory } from '../../../types';

interface BudgetLimitsSectionProps {
  budgets: BudgetCategory[];
  onSaveBudgetLimit: (categoryId: string, newLimit: number) => void;
  showTutorial?: boolean;
  hiddenCategories?: string[];
  onToggleHideCategory?: (categoryId: string) => void;
}

const BudgetLimitsSection: React.FC<BudgetLimitsSectionProps> = ({
  budgets,
  onSaveBudgetLimit,
  showTutorial,
  hiddenCategories = [],
  onToggleHideCategory,
}) => {
  const [editingBudgets, setEditingBudgets] = useState<Record<string, string>>({});

  const handleInputChange = (budgetId: string, value: string) => {
    setEditingBudgets(prev => ({ ...prev, [budgetId]: value }));
  };

  const handleSave = (budget: BudgetCategory) => {
    const newValue = editingBudgets[budget.id];
    if (newValue !== undefined && newValue !== '') {
      const newLimit = parseFloat(newValue);
      if (!isNaN(newLimit) && newLimit > 0) {
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
    <div id="settings-budget-limits-container" className="border-2 border-slate-100 dark:border-slate-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Budget Limits
        </h3>
      </div>

      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
        Set your monthly budget limit for each category. Tap the eye icon to hide categories you don't use.
      </p>

      <div className="space-y-3">
        {(showTutorial ? budgets.slice(0, 1) : budgets).map((budget) => {
          const isHidden = hiddenCategories.includes(budget.id);
          const isEditing = editingBudgets[budget.id] !== undefined;
          const displayValue = isEditing 
            ? editingBudgets[budget.id] 
            : budget.totalLimit.toString();

          return (
            <div
              key={budget.id}
              className={`flex items-center justify-between gap-4 p-3 rounded-xl transition-all ${
                isHidden
                  ? 'bg-slate-100/50 dark:bg-slate-800/20 opacity-50'
                  : 'bg-slate-50 dark:bg-slate-800/50'
              }`}
            >
              <label
                htmlFor={`budget-${budget.id}`}
                className={`text-xs font-bold flex-1 ${
                  isHidden ? 'text-slate-400 dark:text-slate-600 line-through' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {budget.name}
              </label>
              
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 w-32 justify-end">
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
                        className="w-24 px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors"
                      />
                    </>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider">Hidden</span>
                  )}
                </div>
                {onToggleHideCategory && (
                  <button
                    type="button"
                    onClick={() => onToggleHideCategory(budget.id)}
                    className={`p-1.5 rounded-lg transition-all active:scale-90 ${
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
    </div>
  );
};

export default BudgetLimitsSection;
