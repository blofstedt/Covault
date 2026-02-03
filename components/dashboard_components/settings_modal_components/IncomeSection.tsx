// components/settings_modal_components/IncomeSection.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  // Track if user is actively editing to prevent sync-back flickering
  const isEditingRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync UI only on initial load or when user changes externally (not during editing)
  useEffect(() => {
    if (user?.monthlyIncome !== undefined && user?.monthlyIncome !== null) {
      // Only sync if not currently editing and either initial sync or value changed externally
      if (!isEditingRef.current) {
        setInputValue(user.monthlyIncome.toString());
        initialSyncDoneRef.current = true;
      }
    }
  }, [user?.monthlyIncome]);

  // Debounced save to prevent excessive updates
  const debouncedSave = useCallback((value: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onUpdateUserIncome(value);
    }, 300);
  }, [onUpdateUserIncome]);

  const handleChange = (val: string) => {
    isEditingRef.current = true;
    setInputValue(val);

    // Convert cleanly and debounce the update
    const numeric = parseFloat(val);
    if (!isNaN(numeric) && numeric >= 0) {
      debouncedSave(numeric);
    }
  };

  const handleBlur = () => {
    isEditingRef.current = false;

    // Clear any pending debounce and save immediately
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Empty field becomes 0
    if (inputValue.trim() === '') {
      setInputValue('0');
      onUpdateUserIncome(0);
    } else {
      const numeric = parseFloat(inputValue);
      if (!isNaN(numeric) && numeric >= 0) {
        onUpdateUserIncome(numeric);
      }
    }
  };

  return (
    <div
      id="settings-income-container"
      className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
    >
      <div className="flex flex-col mb-4">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {isSharedAccount ? 'My Monthly Income' : 'Monthly Income'}
        </span>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-1 leading-relaxed">
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
