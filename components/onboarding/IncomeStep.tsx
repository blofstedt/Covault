import React, { useState } from 'react';
import OnboardingStepShell from './OnboardingStepShell';

interface IncomeStepProps {
  isSharedAccount: boolean;
  stepNumber: number;
  stepCount: number;
  onSave: (income: number) => void;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * What comes in each month — the figure everything else on the dashboard is
 * measured against.
 *
 * It has always lived in the settings modal, in a 12px card, which a new user
 * had no reason to go and find. Until they did, the balance at the top of the
 * dashboard counted down from nothing.
 *
 * The field is empty rather than pre-filled with the zero the app holds before
 * settings load: showing a saved-looking 0 is a lie about what the app knows.
 */
const IncomeStep: React.FC<IncomeStepProps> = ({
  isSharedAccount,
  stepNumber,
  stepCount,
  onSave,
  onNext,
  onSkip,
}) => {
  const [value, setValue] = useState('');

  const parsed = parseFloat(value);
  const isValid = !Number.isNaN(parsed) && parsed > 0;

  const commit = () => {
    if (!isValid) return;
    onSave(parsed);
    onNext();
  };

  return (
    <OnboardingStepShell
      title={isSharedAccount ? 'What do you bring in?' : 'What comes in each month?'}
      subtitle={
        isSharedAccount
          ? "Your share. Your partner's is added to it automatically once you're linked."
          : 'Everything on the dashboard is measured against this number.'
      }
      stepNumber={stepNumber}
      stepCount={stepCount}
      primaryLabel="Continue"
      onPrimary={commit}
      primaryDisabled={!isValid}
      onSkip={onSkip}
    >
      <div className="flex items-center justify-center">
        <span className="text-3xl font-black text-slate-300 dark:text-slate-700 select-none mr-1">
          $
        </span>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="bg-transparent border-b-2 border-slate-200 dark:border-slate-800 py-4 text-4xl font-black tracking-tighter text-slate-500 dark:text-slate-100 placeholder-slate-200 dark:placeholder-slate-800 outline-none text-center focus:border-emerald-500 transition-all w-48"
        />
      </div>
    </OnboardingStepShell>
  );
};

export default IncomeStep;
