import React from 'react';

interface DashboardBalanceSectionProps {
  isSharedAccount: boolean;
  remainingMoney: number;
}

const DashboardBalanceSection: React.FC<DashboardBalanceSectionProps> = ({
  isSharedAccount,
  remainingMoney,
}) => {
  return (
    <div
      id="balance-header"
      className="flex flex-col items-center justify-center pt-0 pb-2 shrink-0 relative"
    >
      <div className="text-center z-10 animate-nest">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] mb-1 block transition-colors duration-700 text-slate-400 dark:text-slate-500">
          {isSharedAccount ? 'Our Remaining Balance' : 'My Remaining Balance'}
        </span>
        <div className="flex items-baseline justify-center space-x-1 transition-colors duration-700">
          <span className="text-sm font-bold opacity-30 text-slate-500 dark:text-slate-50">
            $
          </span>
          <span
            className={`text-4xl font-black tracking-tighter leading-none transition-colors duration-700 ${
              remainingMoney < 0
                ? 'text-rose-500'
                : 'text-slate-500 dark:text-slate-50'
            }`}
          >
            {remainingMoney.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default DashboardBalanceSection;
