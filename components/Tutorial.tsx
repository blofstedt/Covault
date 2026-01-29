
import React, { useState, useEffect, useRef } from 'react';

interface TutorialProps {
  onComplete: () => void;
  onStepChange?: (step: number) => void;
  isShared: boolean;
}

const Tutorial: React.FC<TutorialProps> = ({ onComplete, onStepChange, isShared }) => {
  const [step, setStep] = useState(0);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const requestRef = useRef<number>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);
  const lastScrolledStep = useRef<number | null>(null);

  // Swipe demo state
  const [demoOffsetX, setDemoOffsetX] = useState(0);
  const [demoSwiping, setDemoSwiping] = useState(false);
  const demoStartX = useRef(0);
  const demoLocked = useRef<'horizontal' | 'vertical' | null>(null);
  const [demoCompleted, setDemoCompleted] = useState(false);

  const steps = [
    {
      title: "Your Balance at a Glance",
      content: isShared
        ? "This is your combined remaining balance. Both incomes are pooled, and all spending is deducted in real time."
        : "Your remaining balance updates in real time as you spend. It subtracts actual and projected expenses from your monthly income.",
      target: "balance-header",
    },
    {
      title: "Spending Vials",
      content: "Each category is a vial. The solid fill is what you've spent. Dashed sections represent projected future expenses. Watch them fill as you spend.",
      target: "first-budget-card",
    },
    {
      title: "Add a Transaction",
      content: isShared
        ? "Tap here to record a purchase. Your name is attached automatically. You can split a single expense across two categories by selecting both."
        : "Tap here to record a new expense. Select one or two categories, and if you pick two, you can drag to split the amount between them.",
      target: "add-transaction-button",
    },
    {
      title: "Swipe to Edit or Delete",
      content: "Swipe any transaction left to delete, or right to edit. Try it on the example below!",
      target: "first-budget-card",
      isDemo: true,
    },
    {
      title: "Quick Navigation",
      content: "Jump directly into any budget category. Tap an icon to expand that vial and see its full transaction history.",
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
      title: "Dark Interface",
      content: "Switch to dark mode for a calmer look that's easier on the eyes at night.",
      target: "settings-theme-container",
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

  const currentStep = steps[step] as typeof steps[0] & { isDemo?: boolean };

  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  }, [step]);

  const updateTargetRect = () => {
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
    requestRef.current = requestAnimationFrame(updateTargetRect);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(updateTargetRect);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [step]);

  // Reset demo state on step change
  useEffect(() => {
    setDemoOffsetX(0);
    setDemoSwiping(false);
    setDemoCompleted(false);
  }, [step]);

  const handleNext = () => {
    const nextStep = step + 1;
    if (nextStep < steps.length) {
      setStep(nextStep);
      onStepChange?.(nextStep);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    setShowSkipConfirm(true);
  };

  // Swipe demo handlers
  const handleDemoTouchStart = (e: React.TouchEvent) => {
    demoStartX.current = e.touches[0].clientX;
    demoLocked.current = null;
    setDemoSwiping(true);
  };

  const handleDemoTouchMove = (e: React.TouchEvent) => {
    if (!demoSwiping) return;
    const dx = e.touches[0].clientX - demoStartX.current;
    const dy = e.touches[0].clientY - (e.touches[0] as any).startY || 0;

    if (!demoLocked.current) {
      if (Math.abs(dx) > 8) {
        demoLocked.current = 'horizontal';
      }
      return;
    }

    if (demoLocked.current === 'vertical') return;
    setDemoOffsetX(Math.max(-140, Math.min(140, dx)));
  };

  const handleDemoTouchEnd = () => {
    setDemoSwiping(false);
    if (Math.abs(demoOffsetX) > 60) {
      setDemoCompleted(true);
      setDemoOffsetX(demoOffsetX > 0 ? 160 : -160);
      setTimeout(() => {
        setDemoOffsetX(0);
        setTimeout(() => setDemoCompleted(false), 300);
      }, 600);
    } else {
      setDemoOffsetX(0);
    }
    demoLocked.current = null;
  };

  // Pointer fallback for demo
  const handleDemoPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    demoStartX.current = e.clientX;
    demoLocked.current = null;
    setDemoSwiping(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDemoPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !demoSwiping) return;
    const dx = e.clientX - demoStartX.current;
    if (!demoLocked.current && Math.abs(dx) > 8) {
      demoLocked.current = 'horizontal';
    }
    if (demoLocked.current === 'horizontal') {
      setDemoOffsetX(Math.max(-140, Math.min(140, dx)));
    }
  };

  const handleDemoPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    handleDemoTouchEnd();
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

  const demoDeleteHint = demoOffsetX < -25;
  const demoEditHint = demoOffsetX > 25;
  const demoDeleteReady = demoOffsetX < -60;
  const demoEditReady = demoOffsetX > 60;

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

      {/* Tooltip */}
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

          {/* Swipe demo */}
          {currentStep.isDemo && (
            <div className="relative overflow-hidden rounded-2xl">
              {/* Delete background */}
              <div className={`absolute inset-0 flex items-center justify-end pr-6 rounded-2xl transition-colors duration-200 ${demoDeleteReady ? 'bg-rose-500' : 'bg-rose-400/20'}`}>
                <div className={`flex items-center space-x-1.5 transition-all duration-200 ${demoDeleteHint ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
                  <svg className={`w-4 h-4 ${demoDeleteReady ? 'text-white' : 'text-rose-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className={`text-[9px] font-black uppercase tracking-widest ${demoDeleteReady ? 'text-white' : 'text-rose-500'}`}>Delete</span>
                </div>
              </div>

              {/* Edit background */}
              <div className={`absolute inset-0 flex items-center justify-start pl-6 rounded-2xl transition-colors duration-200 ${demoEditReady ? 'bg-emerald-500' : 'bg-emerald-400/20'}`}>
                <div className={`flex items-center space-x-1.5 transition-all duration-200 ${demoEditHint ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
                  <svg className={`w-4 h-4 ${demoEditReady ? 'text-white' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572" />
                  </svg>
                  <span className={`text-[9px] font-black uppercase tracking-widest ${demoEditReady ? 'text-white' : 'text-emerald-600'}`}>Edit</span>
                </div>
              </div>

              {/* Mock transaction */}
              <div
                onTouchStart={handleDemoTouchStart}
                onTouchMove={handleDemoTouchMove}
                onTouchEnd={handleDemoTouchEnd}
                onPointerDown={handleDemoPointerDown}
                onPointerMove={handleDemoPointerMove}
                onPointerUp={handleDemoPointerUp}
                className="relative z-10 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 cursor-grab active:cursor-grabbing"
                style={{
                  transform: `translateX(${demoOffsetX}px)`,
                  transition: demoSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
                  touchAction: 'pan-y',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-black text-[12px] text-slate-500 dark:text-slate-200 tracking-tight uppercase">Coffee Shop</span>
                    <span className="text-[9px] font-bold text-slate-400 mt-1">Jan 29 &bull; Dining</span>
                  </div>
                  <span className="text-sm font-black text-slate-500 dark:text-slate-200">$5.75</span>
                </div>
              </div>

              {demoCompleted && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest animate-in fade-in zoom-in-95 duration-300">Nice!</span>
                </div>
              )}
            </div>
          )}

          <div className="flex space-x-3">
            <button
              onClick={handleSkip}
              className="flex-1 py-3.5 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-600/20 active:scale-95 transition-all"
            >
              {step === steps.length - 1 ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
