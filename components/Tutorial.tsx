
import React, { useState, useEffect, useRef, useCallback } from 'react';

interface TutorialProps {
  onComplete: () => void;
  onStepChange?: (step: number) => void;
  isShared: boolean;
  onExpandBudget?: (budgetId: string | null) => void;
  onShowPlaceholderTransaction?: (show: boolean) => void;
  onShowTransactionModal?: (show: boolean) => void;
  onOpenTransactionForm?: (open: boolean) => void;
  onDemoSplit?: () => void;
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
  onDemoSplit,
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

  const steps = [
    {
      title: "Your Balance at a Glance",
      content: isShared
        ? "This is your combined remaining balance. Both incomes are pooled, and all spending is deducted in real time."
        : "Your remaining balance updates in real time as you spend. It subtracts actual and projected expenses from your monthly income.",
      target: "balance-header",
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
      // Step 3: Add a Transaction - will trigger animation
      title: "Add a Transaction",
      content: isShared
        ? "Tap the + button to record a purchase. Let's walk through the transaction entry form."
        : "Tap the + button to record a new expense. Let's walk through the transaction entry form.",
      target: "add-transaction-button",
      animation: "open-transaction-form",
    },
    {
      // Step 4: $ amount field (inside open form)
      title: "Enter the Amount",
      content: "Start by typing the dollar amount of your expense. This is the total cost of the transaction.",
      target: "tutorial-amount-field",
    },
    {
      // Step 5: Vendor field
      title: "Name the Vendor",
      content: "Enter where you made the purchase. This helps you track spending by store or service.",
      target: "tutorial-vendor-field",
    },
    {
      // Step 6: Budget selection
      title: "Choose a Budget",
      content: "Select which budget category this expense belongs to. You can pick up to two categories to split the transaction between them.",
      target: "tutorial-budget-grid",
    },
    {
      // Step 7: Split demo - visually demonstrate split transactions
      title: "Splitting in Action",
      content: "Watch how selecting two budgets lets you split a transaction. The colored fill on each card shows how the amount is divided — drag left or right to adjust the split in real time.",
      target: "tutorial-budget-grid",
      animation: "demo-split",
    },
    {
      // Step 8: Close form, then move on
      title: "Splitting Budgets",
      content: "When two categories are selected, drag to adjust how the amount is split between them. This is great for shared expenses like groceries and dining.",
      target: "tutorial-budget-grid",
      animation: "close-transaction-form",
    },
    {
      // Step 9: Transaction demo - will trigger animation
      title: "View Your Transactions",
      content: "Tap any budget vial to expand it and see your transactions. Let's see how it works.",
      target: "first-budget-card",
      animation: "demo-transaction-tap",
    },
    {
      title: "Quick Navigation",
      content: "Use the bottom bar to navigate: Home returns to the dashboard, the + button adds a new transaction, and <> opens transaction parsing.",
      target: "bottom-bar",
    },
    {
      title: "Your Settings",
      content: "The gear icon opens your vault configuration. Let's walk through each option.",
      target: "settings-button",
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
      title: "App Notifications",
      content: "Get notified when you're approaching or exceeding your budget limits. Stay on top of your spending without opening the app.",
      target: "settings-app-notifications-container",
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

  // Run the transaction tap demo animation sequence
  const runTransactionDemoAnimation = useCallback(() => {
    if (!firstBudgetId) {
      return;
    }

    setIsAnimating(true);
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      onExpandBudget?.(null);
      onShowPlaceholderTransaction?.(false);
      onShowTransactionModal?.(false);
      setIsAnimating(false);
    };
    animationCleanupRef.current = cleanup;

    // Step 1: Expand the first budget
    onExpandBudget?.(firstBudgetId);

    // Step 2: After expand animation, show placeholder transaction
    setTimeout(() => {
      if (cancelled) return;
      onShowPlaceholderTransaction?.(true);

      // Step 3: After a pause, emulate tap on placeholder transaction
      setTimeout(() => {
        if (cancelled) return;
        onShowTransactionModal?.(true);

        // Step 4: After showing the modal, close it
        setTimeout(() => {
          if (cancelled) return;
          onShowTransactionModal?.(false);

          // Step 5: Collapse the budget and clean up
          setTimeout(() => {
            if (cancelled) return;
            onShowPlaceholderTransaction?.(false);
            onExpandBudget?.(null);
            setIsAnimating(false);
            animationCleanupRef.current = null;
            advanceToNextStep();
          }, 600);
        }, 2000);
      }, 1000);
    }, 800);
  }, [firstBudgetId, onExpandBudget, onShowPlaceholderTransaction, onShowTransactionModal, advanceToNextStep]);

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

  // Run the split demo animation
  const runSplitDemoAnimation = useCallback(() => {
    setIsAnimating(true);
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      setIsAnimating(false);
    };
    animationCleanupRef.current = cleanup;

    // Trigger the split demo in the transaction form
    onDemoSplit?.();

    // Wait for the demo to play, then advance
    setTimeout(() => {
      if (cancelled) return;
      setIsAnimating(false);
      animationCleanupRef.current = null;
      advanceToNextStep();
    }, 2500);
  }, [onDemoSplit, advanceToNextStep]);

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
      setTargetRect(null);
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

    const currentStepData = steps[step] as any;

    // Check if this step triggers an animation
    if (currentStepData.animation === 'open-transaction-form') {
      runOpenTransactionFormAnimation();
      return;
    }
    if (currentStepData.animation === 'close-transaction-form') {
      runCloseTransactionFormAnimation();
      return;
    }
    if (currentStepData.animation === 'demo-transaction-tap') {
      runTransactionDemoAnimation();
      return;
    }
    if (currentStepData.animation === 'demo-split') {
      runSplitDemoAnimation();
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
            <h3 className="text-xl font-black text-slate-600 dark:text-slate-100 uppercase tracking-tight">Skip Walkthrough?</h3>
            <p className="text-slate-400 dark:text-slate-500 font-medium text-sm leading-relaxed">
              You can always re-run the tutorial from the Settings menu by tapping the gear icon.
            </p>
          </div>
          <div className="flex flex-col space-y-3">
            <button
              onClick={onComplete}
              className="w-full py-4 bg-slate-500 dark:bg-slate-700 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all"
            >
              Skip for Now
            </button>
            <button
              onClick={() => setShowSkipConfirm(false)}
              className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-emerald-600/20 active:scale-95 transition-all"
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
              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.3em]">Step {step + 1} of {steps.length}</span>
              <h3 className="text-lg font-black text-slate-600 dark:text-slate-100 uppercase tracking-tight leading-tight">
                {currentStep.title}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 font-medium text-[13px] leading-relaxed">
                {currentStep.content}
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleSkip}
                className="flex-1 py-3.5 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"
              >
                Skip
              </button>
              <button
                onClick={handleNext}
                disabled={isAnimating}
                className={`flex-[2] py-3.5 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-600/20 active:scale-95 transition-all ${isAnimating ? 'opacity-50 cursor-not-allowed' : ''}`}
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
