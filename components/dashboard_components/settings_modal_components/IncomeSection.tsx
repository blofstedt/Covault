// components/settings_modal_components/IncomeSection.tsx
import React, { useState, useEffect } from 'react';
import type { DashboardUser } from '../DashboardSettingsModal';

interface IncomeSectionProps {
  isSharedAccount: boolean;
  user: DashboardUser | null | undefined;
  onUpdateUserIncome: (income: number) => void;
}

const IncomeSection: React.FC<IncomeSectionProps> = ({
  isSharedAccount,
  user,
  onUpdateUserIncome,
}) => {
  // Local input state so the field behaves normally
  const [inputValue, setInputValue] = useState('');

  // Sync UI when user is loaded or updated
  useEffect(() => {
    if (user?.monthlyIncome !== undefined && user?.monthlyIncome !== null) {
      setInputValue(user.monthlyIncome.toString());
    }
  }, [user?.monthlyIncome]);

  const handleChange = (val: string) => {
    setInputValue(val);

    // Convert cleanly
    const numeric = parseFloat(val);
    if (!isNaN(numeric) && numeric >= 0) {
      onUpdateUserIncome(numeric);
    }
  };

  const handleBlur = () => {
    // Empty field becomes 0
    if (inputValue.trim() === '') {
      setInputValue('0');
      onUpdateUserIncome(0);
    }
  };

  return (
    <div
      id="settings-income-container"
      className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
    >
      <div className="flex flex-col mb-4">
        <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
          {isSharedAccount ? 'My Monthly Income' : 'Monthly Income'}
        </span>
        <p className="text-[11px] text-slate-500 font-medium mt-1">
          {isSharedAccount
            ? "Your income contribution. Your partner's income will be added automatically."
            : 'This defines your total cash flow for the month.'}
        </p>
      </div>

      {/* Input */}
      <div className="flex items-center space-x-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3">
        <span className="text-slate-400 font-black">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={inputValue}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          className="bg-transparent w-full outline-none font-black text-slate-600 dark:text-slate-100"
          placeholder="0"
        />
      </div>
    </div>
  );
};

export default IncomeSection;
