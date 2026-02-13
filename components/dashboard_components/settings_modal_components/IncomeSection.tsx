// components/settings_modal_components/IncomeSection.tsx
import React, { useState, useEffect, useRef } from 'react';
import type { DashboardUser } from '../DashboardSettingsModal';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';

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
  // Track if user is currently editing to prevent unwanted resets
  const isEditingRef = useRef(false);

  // Sync UI when user is loaded or updated (but not while actively editing)
  useEffect(() => {
    if (user?.monthlyIncome !== undefined && user?.monthlyIncome !== null && !isEditingRef.current) {
      setInputValue(user.monthlyIncome.toString());
    }
  }, [user?.monthlyIncome]);

  const handleFocus = () => {
    isEditingRef.current = true;
  };

  const handleChange = (val: string) => {
    setInputValue(val);
  };

  const handleBlur = () => {
    isEditingRef.current = false;
    
    // Empty field: restore previous saved value instead of saving 0
    if (inputValue.trim() === '') {
      const currentIncome = user?.monthlyIncome ?? 0;
      setInputValue(currentIncome.toString());
      return;
    } else {
      // Save the current valid numeric value when field loses focus
      const numeric = parseFloat(inputValue);
      if (!isNaN(numeric) && numeric >= 0) {
        onUpdateUserIncome(numeric);
      } else {
        // Invalid value: reset to current saved value
        const currentIncome = user?.monthlyIncome ?? 0;
        setInputValue(currentIncome.toString());
      }
    }
  };

  return (
    <SettingsCard id="settings-income-container">
      <SectionHeader
        title={isSharedAccount ? 'My Monthly Income' : 'Monthly Income'}
        subtitle={isSharedAccount
          ? "Your income contribution. Your partner's income will be added automatically."
          : 'This defines your total cash flow for the month.'}
        className="mb-4"
      />

      {/* Input */}
      <div className="flex items-center space-x-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3">
        <span className="text-slate-400 font-black">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={inputValue}
          onFocus={handleFocus}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          className="bg-transparent w-full outline-none font-black text-slate-600 dark:text-slate-100"
          placeholder="0"
        />
      </div>
    </SettingsCard>
  );
};

export default IncomeSection;
