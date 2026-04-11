
import React, { useState, useEffect, useRef, useCallback } from 'react';

interface TutorialStep {
  title: string;
  content: string;
  target: string;
  animation?: string;
}

interface TutorialProps {
  onComplete: () => void;
  onStepChange?: (step: number) => void;
  isShared: boolean;
  onExpandBudget?: (budgetId: string | null) => void;
  onShowPlaceholderTransaction?: (show: boolean) => void;
  onShowTransactionModal?: (show: boolean) => void;
  onOpenTransactionForm?: (open: boolean) => void;
  firstBudgetId?: string;
}

const Tutorial: React.FC<TutorialProps> = ({
  onComplete,
  onStepChange,
  isShared,
  onExpandBudget,
  onShowPlaceholderTransaction,
  onShowTransactionModal,
  onOpenTransactionForm,
  firstBudgetId,
}) => {
  const [step, setStep] = useState(0);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const requestRef = useRef<number | null>(null);
  const isActiveRef = useRef(true);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);
  const lastScrolledStep = useRef<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationCleanupRef = useRef<(() => void) | null>(null);

  const steps: TutorialStep[] = [
    {
      title: "Your Balance at a Glance",
      content: isShared
        ? "This is your combined remaining balance. Both incomes are pooled, and all spending is deducted in real time."
        : "Your remaining balance updates in real time as you spend. It subtracts actual and projected expenses from your monthly income.",
      target: "balance-header",
    },
    {
      title: "Search Transactions",
      content: "Use this search field to quickly find transactions by vendor name. Just type a keyword and matching entries will appear instantly.",
      target: "search-field",
    },
    {
      title: "Spending Flow",
      content: "This chart visualizes your spending across categories over time. Each colored band represents a budget category. Touch and hold to explore individual months.",
      target: "spending-flow-chart",
    },
    {
      title: "Spending Vials",
      content: "Each category is a vial. The solid fill is what you've spent. Dashed sections represent projected future expenses. Watch them fill as you spend.",
      target: "first-budget-card",
    },
    {
      // Step 4: Add a Transaction - will trigger animation
      title: "Add a Transaction",
      content: isShared
        ? "Tap the + button to record a purchase. Let's walk through the transaction entry form."
        : "Tap the + button to record a new expense. Let's walk through the transaction entry form.",
      target: "add-transaction-button",
      animation: "open-transaction-form",
    },
    {
      // Step 5: $ amount field (inside open form)
      title: "Enter the Amount",
      content: "Start by typing the dollar amount of your expense. This is the total cost of the transaction.",
      target: "tutorial-amount-field",
    },
    {
      // Step 6: Vendor field
      title: "Name the Vendor",
      content: "Enter where you made the purchase. This helps you track spending by store or service.",
      target: "tutorial-vendor-field",
    },
    {
      // Step 7: Budget selection — tapping Next closes the form
      title: "Choose a Budget",
      content: "Select which budget category this expense belongs to. You can edit or delete any transaction by tapping it in the main dashboard.",
      target: "tutorial-budget-grid",
      animation: "close-transaction-form",
    },
    {
      title: "Quick Navigation",
      content: "Use the bottom bar to navigate: Home returns to the dashboard, the + button adds a new transaction, and the angle-brackets icon opens transaction parsing.",
      target: "bottom-bar",
    },
    {
      title: "Transaction Parsing",
      content: "This is the transaction parsing dashboard. On Android, Covault can read your banking notifications and automatically log transactions for you. Use this toggle to enable or disable the Bank Notification Listener.",
      target: "parsing-notification-toggle",
    },
    {
      title: "Let's Look at an Example",
      content: "Here's what the parsing dashboard looks like with some data. Parsing Rules tell Covault how to read notifications from each bank — you set them up once per bank by highlighting the vendor and amount in a sample notification.",
      target: "parsing-rules-section",
    },
    {
      title: "Vendor Category Rules",
      content: "Once Covault detects a vendor, you can assign a default budget category for future transactions from that vendor. You can also enable auto-accept so those transactions are approved automatically.",
      target: "parsing-vendor-rules-section",
    },
    {
      title: "To Be Reviewed",
      content: "Parsed transactions appear here for your review. Tap one to assign it a budget category and approve it, or reject it if it doesn't belong.",
      target: "parsing-to-review-section",
    },
    {
      title: "Approved Transactions",
      content: "All auto-detected transactions that have been approved appear here. You can tap any entry to view or edit its details.",
      target: "parsing-approved-section",
    },
    {
      title: "Your Settings",
      content: "The gear icon opens your vault configuration. Let's walk through each option.",
      target: "settings-button",
    },
    {
      title: "Re-run This Tutorial",
      content: "You can always restart this walkthrough by tapping the 'Run Tutorial' button at the top of your settings.",
      target: "run-tutorial-button",
    },
    {
      title: "Frequently Asked",
      content: "Have a quick question? Tap 'Frequently Asked' to browse and search a list of common questions and answers about Covault.",
      target: "faq-button",
    },
    {
      title: "Monthly Income",
      content: isShared
        ? "Enter your income contribution here. Your partner's income will be added to the total automatically."
        : "Set your monthly take-home pay. This is the starting point for all balance calculations.",
      target: "settings-income-container",
    },
    {
      title: "Budget Limits",
      content: "Set the spending cap for each category. These limits define how full each vial can get before it overflows.",
      target: "settings-budget-limits-container",
    },
    {
      title: "Hide Categories",
      content: "Use the eye icon next to each budget to hide categories you don't need. Hidden categories won't appear on your dashboard or chart, keeping your view focused on what matters.",
      target: "settings-budget-limits-container",
    },
    {
      title: "Dark Interface",
      content: "Switch to dark mode for a calmer look that's easier on the eyes at night.",
      target: "settings-theme-container",
    },
    {
      title: "Bank Notification Listener",
      content: "On Android, Covault can read banking notifications and auto-log transactions for you. Enable this to save time on manual entry.",
      target: "settings-notifications-container",
    },
    {
      title: "Notification Rules",
      content: "Build custom alert rules in plain English. Tap the + button to create rules like \"Notify me when Groceries is within 10% of its limit.\" Each rule can be delivered via push, email, or in-app.",
      target: "settings-notification-rules-container",
    },
    {
      title: "Budget Rollover",
      content: "Unspent money can carry over to next month. Enable this to let surplus accumulate across billing cycles.",
      target: "settings-rollover-container",
    },
    {
      title: "Discretionary Shield",
      content: "When another category overspends, your Leisure vial absorbs the overflow. It's a safety net that protects your essentials.",
      target: "settings-shield-container",
    },
    {
      title: "Vault Sharing",
      content: isShared
        ? "You're already sharing your vault. You can disconnect or change partners here."
        : "Invite a partner to share your budget. Both of you will see the same vials, transactions, and balances.",
      target: "settings-sharing-container",
    },
    {
      title: "Export Transactions",
      content: "Download your transactions as a CSV file. Pick a start and end date to generate a report you can open in any spreadsheet app.",
      target: "settings-export-container",
    },
    {
      title: "Budget Report",
      content: "Once available, you'll be able to send a monthly budget summary to your email. Stay tuned — this feature is coming soon.",
      target: "settings-reports-container",
    },
    {
      title: "Report an Issue",
      content: "Something broken? Tap here to send a report directly to the development team.",
      target: "report-problem-button",
    },
    {
      title: "Suggest a Feature",
      content: "Have an idea that would improve Covault? Share it here. User feedback shapes every update.",
      target: "request-feature-button",
    },
    {
      title: "Sign Out",
      content: "Lock your vault on this device. Your data stays safe in the cloud until you sign back in.",
      target: "sign-out-button",
    }
  ];

  const currentStep = steps[step];

  // Clean up animations on unmount
  useEffect(() => {
    return () => {
      if (animationCleanupRef.current) {
        animationCleanupRef.current();
      }
    };
  }, []);

  // Helper: advance to the next tutorial step
  const advanceToNextStep = useCallback(() => {
    const nextStep = step + 1;
    if (nextStep < steps.length) {
      setStep(nextStep);
      onStepChange?.(nextStep);
    }
  }, [step, steps.length, onStepChange]);

  // Run the open transaction form animation
  const runOpenTransactionFormAnimation = useCallback(() => {
    setIsAnimating(true);
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      setIsAnimating(false);
    };
    animationCleanupRef.current = cleanup;

    // Open the transaction form
    onOpenTransactionForm?.(true);

    // Wait for form to open, then auto-advance
    setTimeout(() => {
      if (cancelled) return;
      setIsAnimating(false);
      animationCleanupRef.current = null;
      advanceToNextStep();
    }, 600);
  }, [onOpenTransactionForm, advanceToNextStep]);

  // Run the close transaction form animation
  const runCloseTransactionFormAnimation = useCallback(() => {
    setIsAnimating(true);
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      onOpenTransactionForm?.(false);
      setIsAnimating(false);
    };
    animationCleanupRef.current = cleanup;

    // Close the transaction form
    onOpenTransactionForm?.(false);

    setTimeout(() => {
      if (cancelled) return;
      setIsAnimating(false);
      animationCleanupRef.current = null;
      advanceToNextStep();
    }, 500);
  }, [onOpenTransactionForm, advanceToNextStep]);


  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  }, [step]);

  const updateTargetRect = () => {
    if (!isActiveRef.current) return;
    const el = document.getElementById(steps[step].target);
    if (el) {
      const rect = el.getBoundingClientRect();

      if (lastScrolledStep.current !== step) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        lastScrolledStep.current = step;
      }

      setTargetRect(prev => {
        if (!prev ||
            prev.top !== rect.top ||
            prev.left !== rect.left ||
            prev.width !== rect.width ||
            prev.height !== rect.height) {
          return rect;
        }
        return prev;
      });
    } else {
      // Keep the previous targetRect when target element is not found to avoid flickering
    }
    if (isActiveRef.current) {
      requestRef.current = requestAnimationFrame(updateTargetRect);
    }
  };

  useEffect(() => {
    isActiveRef.current = true;
    requestRef.current = requestAnimationFrame(updateTargetRect);
    return () => {
      isActiveRef.current = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [step]);

  const handleNext = () => {
    if (isAnimating) return;

    const currentStepData = steps[step];

    // Check if this step triggers an animation
    if (currentStepData.animation === 'open-transaction-form') {
      runOpenTransactionFormAnimation();
      return;
    }
    if (currentStepData.animation === 'close-transaction-form') {
      runCloseTransactionFormAnimation();
      return;
    }

    const nextStep = step + 1;
    if (nextStep < steps.length) {
      setStep(nextStep);
      onStepChange?.(nextStep);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    // Clean up any running animations
    if (animationCleanupRef.current) {
      animationCleanupRef.current();
      animationCleanupRef.current = null;
    }
    onOpenTransactionForm?.(false);
    onExpandBudget?.(null);
    onShowPlaceholderTransaction?.(false);
    onShowTransactionModal?.(false);
    setShowSkipConfirm(true);
  };

  if (showSkipConfirm) {
    return (
      <div className="fixed inset-0 z-[300] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-300">
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 max-w-sm w-full space-y-8 text-center shadow-2xl border border-slate-100 dark:border-slate-800">
          <div className="space-y-4">
            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-slate-600 dark:text-slate-100 tracking-tight">Skip Walkthrough?</h3>
            <p className="text-slate-400 dark:text-slate-500 font-medium text-sm leading-relaxed">
              You can always re-run the tutorial from the Settings menu by tapping the gear icon.
            </p>
          </div>
          <div className="flex flex-col space-y-3">
            <button
              onClick={onComplete}
              className="w-full py-4 bg-slate-500 dark:bg-slate-700 text-white rounded-2xl font-semibold text-xs tracking-wide shadow-lg active:scale-[0.97] transition-all duration-200"
            >
              Skip for Now
            </button>
            <button
              onClick={() => setShowSkipConfirm(false)}
              className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-semibold text-xs tracking-wide shadow-lg shadow-emerald-600/20 active:scale-[0.97] transition-all duration-200"
            >
              Continue Walkthrough
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tooltipStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '90%',
    maxWidth: '380px',
    transition: 'all 0.5s cubic-bezier(0.23, 1, 0.32, 1)',
  };

  let tooltipOnBottom = false;
  if (targetRect) {
    const viewportHeight = window.innerHeight;
    const spaceAbove = targetRect.top;
    const spaceBelow = viewportHeight - targetRect.bottom;

    if (spaceAbove > spaceBelow && spaceAbove > 320) {
      tooltipStyle.bottom = (viewportHeight - targetRect.top) + 40;
      tooltipOnBottom = false;
    } else {
      tooltipStyle.top = targetRect.bottom + 40;
      tooltipOnBottom = true;
    }
  } else {
    tooltipStyle.top = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  const badgePos: any = { top: '-10px', right: '-10px' };
  if (targetRect && targetRect.right > window.innerWidth - 60) {
    badgePos.right = 'auto';
    badgePos.left = '-10px';
  }

  const progress = ((step + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-[250] pointer-events-none overflow-hidden">
      {/* Dimmer */}
      <div className="absolute inset-0 bg-slate-950/50 transition-opacity duration-700 ease-in-out pointer-events-auto" />

      {/* Spotlight */}
      {targetRect && (
        <div
          className="absolute rounded-[2rem] border-2 border-emerald-400/80 transition-all duration-500 ease-out pointer-events-none"
          style={{
            left: targetRect.left - 10,
            top: targetRect.top - 10,
            width: targetRect.width + 20,
            height: targetRect.height + 20,
            boxShadow: '0 0 0 9999px rgba(2, 44, 34, 0.82), 0 0 60px 10px rgba(16, 185, 129, 0.15)'
          }}
        >
           <div
            className="absolute bg-emerald-500 rounded-full flex items-center justify-center shadow-xl ring-2 ring-white/80 dark:ring-slate-900 z-50 transition-all duration-500"
            style={{ width: '26px', height: '26px', ...badgePos }}
           >
             <span className="text-white font-black text-[10px]">{step + 1}</span>
           </div>
        </div>
      )}

      {/* Animated tap indicator during animations */}
      {isAnimating && targetRect && (
        <div
          className="absolute pointer-events-none z-[260]"
          style={{
            left: targetRect.left + targetRect.width / 2 - 20,
            top: targetRect.top + targetRect.height / 2 - 20,
          }}
        >
          <div className="w-10 h-10 rounded-full bg-white/30 border-2 border-white/60 animate-ping" />
        </div>
      )}

      {/* Tooltip - hidden during animation */}
      {!isAnimating && (
        <div
          ref={tooltipRef}
          className="pointer-events-auto"
          style={tooltipStyle}
        >
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-5 shadow-2xl border border-slate-100 dark:border-slate-800/80 animate-in slide-in-from-bottom-3 duration-500">
            {/* Progress bar */}
            <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="space-y-3 text-center">
              <span className="text-[9px] font-semibold text-emerald-500 tracking-wide">Step {step + 1} of {steps.length}</span>
              <h3 className="text-lg font-bold text-slate-600 dark:text-slate-100 tracking-tight leading-tight">
                {currentStep.title}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 font-medium text-[13px] leading-relaxed">
                {currentStep.content}
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleSkip}
                className="flex-1 py-3.5 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl font-semibold text-[10px] tracking-wide active:scale-[0.97] transition-all duration-200"
              >
                Skip
              </button>
              <button
                onClick={handleNext}
                disabled={isAnimating}
                className={`flex-[2] py-3.5 bg-emerald-600 text-white rounded-2xl font-semibold text-[10px] tracking-wide shadow-lg shadow-emerald-600/20 active:scale-[0.97] transition-all duration-200 ${isAnimating ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {step === steps.length - 1 ? "Get Started" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tutorial;
