import React, { useState } from 'react';
import { BudgetCategory } from '../../../types';

interface BudgetLimitsSectionProps {
  budgets: BudgetCategory[];
  onSaveBudgetLimit: (categoryId: string, newLimit: number) => void;
}

const BudgetLimitsSection: React.FC<BudgetLimitsSectionProps> = ({
  budgets,
  onSaveBudgetLimit,
}) => {
  const [editingBudgets, setEditingBudgets] = useState<Record<string, string>>({});

  const handleInputChange = (budgetId: string, value: string) => {
    setEditingBudgets(prev => ({ ...prev, [budgetId]: value }));
  };

  const handleSave = (budget: BudgetCategory) => {
    const newValue = editingBudgets[budget.id];
    if (newValue !== undefined && newValue !== '') {
      const newLimit = parseFloat(newValue);
      if (!isNaN(newLimit) && newLimit >= 0) {
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
    <div className="border-2 border-slate-100 dark:border-slate-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Budget Limits
        </h3>
      </div>

      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
        Set your monthly budget limit for each category. These values will be saved and synced across your devices.
      </p>

      <div className="space-y-3">
        {budgets.map((budget) => {
          const isEditing = editingBudgets[budget.id] !== undefined;
          const displayValue = isEditing 
            ? editingBudgets[budget.id] 
            : budget.totalLimit.toString();

          return (
            <div
              key={budget.id}
              className="flex items-center justify-between gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl"
            >
              <label
                htmlFor={`budget-${budget.id}`}
                className="text-xs font-bold text-slate-600 dark:text-slate-300 flex-1"
              >
                {budget.name}
              </label>
              
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400">$</span>
                <input
                  id={`budget-${budget.id}`}
                  type="number"
                  min="0"
                  step="1"
                  value={displayValue}
                  onChange={(e) => handleInputChange(budget.id, e.target.value)}
                  onBlur={() => handleSave(budget)}
                  onKeyDown={(e) => handleKeyDown(e, budget)}
                  className="w-24 px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BudgetLimitsSection;
