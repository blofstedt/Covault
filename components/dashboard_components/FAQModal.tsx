import React, { useState, useMemo } from 'react';
import { CloseButton } from '../shared';

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQModalProps {
  onClose: () => void;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "How do I link to a partner?",
    answer: "Open the gear icon to access Vault Settings, then scroll to 'Vault Sharing.' Tap 'Generate Code' to create a link code and share it with your partner, or enter a code they've shared with you."
  },
  {
    question: "How do I edit rules for parsing transactions?",
    answer: "Go to the transaction parsing view by tapping the angle-brackets icon on the bottom bar. From there, you can configure how bank notifications are parsed into transactions."
  },
  {
    question: "How do I add a transaction?",
    answer: "Tap the + button in the center of the bottom bar. Fill in the amount, vendor name, and choose a budget category, then tap Save."
  },
  {
    question: "How do I delete a transaction?",
    answer: "Tap on any transaction in the budget list to open the action menu, then tap 'Delete.' You'll be asked to confirm before it's removed."
  },
  {
    question: "How do I edit a transaction?",
    answer: "Tap on the transaction in the budget list. An action modal will appear where you can edit the amount, vendor, category, or date."
  },
  {
    question: "How do I change my monthly income?",
    answer: "Open Vault Settings via the gear icon and look for the 'Monthly Income' section at the top. Tap the amount to edit it."
  },
  {
    question: "How do I set budget limits?",
    answer: "In Vault Settings, find the 'Budget Limits' section. Tap on any category's limit to change how much you want to allocate."
  },
  {
    question: "How do I hide a budget category?",
    answer: "In Vault Settings under 'Budget Limits,' tap the eye icon next to any category to hide it from your dashboard and chart."
  },
  {
    question: "How do I enable dark mode?",
    answer: "Open Vault Settings and find the 'Dark Interface' toggle. Tap it to switch between light and dark themes."
  },
  {
    question: "What is the Discretionary Shield?",
    answer: "When enabled, your Leisure budget absorbs overflow from other overspent categories. It acts as a safety net to protect your essential budgets."
  },
  {
    question: "What is Budget Rollover?",
    answer: "When rollover is enabled, unspent money in a category carries over to the next month. This lets surplus accumulate across billing cycles."
  },
  {
    question: "How do I export my transactions?",
    answer: "In Vault Settings, find 'Export Transactions.' Choose a date range, then download your data as a CSV file you can open in any spreadsheet app."
  },
  {
    question: "How do I read the Spending Flow chart?",
    answer: "The chart shows your spending across categories over time. Each colored band is a category. Touch and hold to scrub through months and see breakdowns. Dashed threshold lines mark your total budget limit."
  },
  {
    question: "What do the vials on the dashboard represent?",
    answer: "Each vial is a budget category. The solid fill shows what you've actually spent. Dashed portions represent projected future expenses. When a vial overflows, you've exceeded that category's limit."
  },
  {
    question: "How do I set up bank notification parsing?",
    answer: "In Vault Settings, enable the 'Bank Notification Listener.' On Android, Covault can read your banking notifications and auto-log transactions. You can then review and approve them in the parsing view."
  },
  {
    question: "How do I create notification rules?",
    answer: "In Vault Settings, find 'Notification Rules' and tap the + button. Write rules in plain English like 'Notify me when Groceries is within 10% of its limit.' Each rule can be delivered via push, email, or in-app."
  },
  {
    question: "How do I disconnect from a partner?",
    answer: "Open Vault Settings and scroll to 'Vault Sharing.' Tap 'Disconnect' to unlink your partner. Your data stays safe — you'll just return to solo budgeting."
  },
  {
    question: "How do I report a problem?",
    answer: "In Vault Settings, scroll to the 'Support & Feedback' section and tap 'Report a Problem.' This opens an email to the development team."
  },
  {
    question: "How do I suggest a new feature?",
    answer: "Open Vault Settings via the gear icon and find the 'Support & Feedback' section. Tap 'Request a Feature' to vote on features or submit your own ideas. The most popular requests rise to the top."
  },
  {
    question: "How is my remaining balance calculated?",
    answer: "Your balance starts with your monthly income, then subtracts all actual spending and projected future expenses for the current month. It updates in real time as you add transactions."
  },
  {
    question: "Can I search for a specific transaction?",
    answer: "Yes! Tap on the balance area at the top of the dashboard to reveal a search bar. Type a vendor name to filter transactions across all months."
  },
  {
    question: "How do I run the tutorial again?",
    answer: "Open Vault Settings via the gear icon and tap the 'Run Tutorial' button at the top of the settings panel."
  },
];

const FAQModal: React.FC<FAQModalProps> = ({ onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const filteredFAQs = useMemo(() => {
    if (!searchQuery.trim()) return FAQ_ITEMS;
    const q = searchQuery.toLowerCase();
    return FAQ_ITEMS.filter(
      (item) =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] flex flex-col border border-slate-100 dark:border-slate-800/60 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-lg font-bold text-slate-700 dark:text-slate-100 tracking-tight">
            Frequently Asked
          </h2>
          <CloseButton onClick={onClose} size="sm" />
        </div>

        {/* Search bar */}
        <div className="px-6 pb-4">
          <div className="relative">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search questions..."
              className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
            />
          </div>
        </div>

        {/* FAQ list */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 no-scrollbar">
          <div className="space-y-2">
            {filteredFAQs.length === 0 && (
              <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-8">
                No matching questions found.
              </p>
            )}
            {filteredFAQs.map((item, index) => {
              const isExpanded = expandedIndex === index;
              return (
                <button
                  key={index}
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  className="w-full text-left p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-700/50 transition-all active:scale-[0.98]"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-black text-emerald-500">?</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-600 dark:text-slate-300 leading-snug">
                        {item.question}
                      </p>
                      {isExpanded && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                          {item.answer}
                        </p>
                      )}
                    </div>
                    <svg
                      className={`w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FAQModal;
