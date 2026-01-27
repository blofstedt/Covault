
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

  const steps = [
    {
      title: "The Heart of Your Vault",
      content: "This header displays your real-time remaining balance. Covault calculates this by subtracting your spent and projected costs from your Total Monthly Income.",
      target: "balance-header",
    },
    {
      title: "Switch Perspectives",
      content: isShared 
        ? "You're in a Shared Vault. Swipe left or right to instantly switch views between your personal ('Mine') and shared ('Ours') perspective."
        : "If you link a partner later, you can swipe left or right like this to toggle between your personal view and your shared budget.",
      target: "balance-header",
      showSwipe: true
    },
    {
      title: "Simplified Budgeting",
      content: "These are your 'Spending Vials'. Solid liquid shows what's already been spent, while dashed outlines represent upcoming projected expenses.",
      target: "first-budget-card",
    },
    {
      title: "Record Spending",
      content: "Tap this button to manually record a transaction. You can even split a single expense across two different budget categories.",
      target: "add-transaction-button",
    },
    {
      title: "Smart Navigation",
      content: "Use these shortcuts to jump instantly into any specific budget vault to review its history or capacity.",
      target: "bottom-bar",
    },
    {
      title: "Configure Your Vault",
      content: "Tap the Cog icon here to access your deep configuration. Let's explore what you can customize inside your vault.",
      target: "settings-button",
    },
    {
      title: "Your Cash Flow",
      content: "First, set your Total Monthly Income. This is the baseline from which all your remaining balances are calculated.",
      target: "settings-income-container",
    },
    {
      title: "Personalize the View",
      content: "Toggle Dark Mode for a calmer, high-contrast appearance that's easier on the eyes in low-light environments.",
      target: "settings-theme-container",
    },
    {
      title: "Budget Rollover",
      content: "If you have money left at the end of the month, enable Rollover to carry that surplus into your next month's vaults.",
      target: "settings-rollover-container",
    },
    {
      title: "The Discretionary Shield",
      content: "This is a safety net. If a specific budget vault overspends, money is automatically moved from your 'Leisure' vault to cover the gap.",
      target: "settings-shield-container",
    },
    {
      title: "Vault Sharing",
      content: "Build a future together. Invite a partner to see and manage your shared vaults while still keeping your personal balance private.",
      target: "settings-sharing-container",
    },
    {
      title: "Feedback & Support",
      content: "Something not right? You can report bugs or issues directly to our engineering team from here.",
      target: "report-problem-button",
    },
    {
      title: "Shape the Future",
      content: "Have a brilliant idea? Use this button to suggest new features. We build Covault based on your feedback.",
      target: "request-feature-button",
    },
    {
      title: "Secure Logout",
      content: "When you're done, you can sign out here to securely lock your vault on this device.",
      target: "sign-out-button",
    }
  ];

  // Monitor tooltip height to position swipe animation relative to its bottom
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  }, [step]);

  // Track the target element's position dynamically and handle scrolling
  const updateTargetRect = () => {
    const el = document.getElementById(steps[step].target);
    if (el) {
      const rect = el.getBoundingClientRect();
      
      // Auto-scroll logic: if this is a new step, bring the target into view
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

  if (showSkipConfirm) {
    return (
      <div className="fixed inset-0 z-[300] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-300">
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 max-w-sm w-full space-y-8 text-center shadow-2xl border border-slate-100 dark:border-slate-800">
          <div className="space-y-4">
            <h3 className="text-2xl font-black text-slate-600 dark:text-slate-100 uppercase tracking-tight">Are you sure?</h3>
            <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-[11px] leading-relaxed">
              This tutorial can always be re-accessed in the settings menu (the Cog icon) if you need a refresher later.
            </p>
          </div>
          <div className="flex flex-col space-y-3">
            <button 
              onClick={onComplete}
              className="w-full py-5 bg-rose-500 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-rose-500/20 active:scale-95 transition-all"
            >
              Skip Tutorial
            </button>
            <button 
              onClick={() => setShowSkipConfirm(false)}
              className="w-full py-5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl font-black text-xs uppercase tracking-[0.2em] active:scale-95 transition-all"
            >
              Continue Learning
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

  // Edge-aware badge positioning with safety margins
  const badgePos = { top: '-10px', right: '-10px' };
  if (targetRect && targetRect.right > window.innerWidth - 60) {
    badgePos.right = 'auto';
    // @ts-ignore
    badgePos.left = '-10px';
  }

  // Swipe animation positioning relative to tooltip
  const swipeContainerStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'all 0.5s ease-out',
    zIndex: 260 // Ensure it's above the spotlight shadow
  };

  if (targetRect) {
    if (tooltipOnBottom) {
       swipeContainerStyle.top = targetRect.bottom + 40 + tooltipHeight + 24;
    } else {
       swipeContainerStyle.top = targetRect.bottom + 60;
    }
  } else {
     swipeContainerStyle.bottom = '15%';
  }

  return (
    <div className="fixed inset-0 z-[250] pointer-events-none overflow-hidden">
      {/* Dimmer Overlay - Simple fade-in background */}
      <div className="absolute inset-0 bg-slate-950/40 transition-opacity duration-700 ease-in-out pointer-events-auto" />

      {/* Spotlight Element - Uses massive shadow to create rounded cutout effect */}
      {targetRect && (
        <div 
          className="absolute rounded-[2.5rem] border-2 border-emerald-500 transition-all duration-300 ease-out pointer-events-none bg-emerald-500/10"
          style={{
            left: targetRect.left - 12,
            top: targetRect.top - 12,
            width: targetRect.width + 24,
            height: targetRect.height + 24,
            boxShadow: '0 0 0 9999px rgba(2, 44, 34, 0.8), 0 0 40px rgba(16, 185, 129, 0.4)'
          }}
        >
           {/* Step Badge */}
           <div 
            className="absolute bg-emerald-500 rounded-full flex items-center justify-center shadow-2xl ring-2 ring-white dark:ring-slate-900 z-50 transition-all duration-500"
            style={{
              width: '28px',
              height: '28px',
              ...badgePos
            }}
           >
             <span className="text-white font-black text-[11px]">{step + 1}</span>
           </div>
        </div>
      )}

      {/* Swipe Indicator Animation - Rendered AFTER spotlight for top-layer visibility */}
      {steps[step].showSwipe && (
        <div style={swipeContainerStyle}>
          <div className="relative w-72 h-14 bg-white/90 backdrop-blur-md rounded-full border-2 border-white overflow-hidden flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.4)]">
             <div className="absolute top-1/2 left-0 w-10 h-10 -translate-y-1/2 flex items-center justify-center animate-swipe-demo-icon z-20">
                <div className="w-5 h-5 bg-white rounded-full shadow-[0_0_20px_rgba(52,211,153,1)] border-2 border-emerald-400" />
             </div>
             <div className="flex space-x-3 opacity-20">
                {[...Array(14)].map((_, i) => (
                  <div key={i} className="w-1.5 h-1.5 bg-emerald-300 rounded-full" />
                ))}
             </div>
          </div>
          <div className="mt-4 px-6 py-2 bg-white rounded-full shadow-lg border-2 border-emerald-500">
            <span className="text-[11px] font-black text-emerald-600 uppercase tracking-[0.4em]">Switch Perspective</span>
          </div>
        </div>
      )}
      
      {/* Tooltip Card */}
      <div 
        ref={tooltipRef}
        className="pointer-events-auto"
        style={tooltipStyle}
      >
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-6 shadow-2xl border border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-5 duration-500">
          <div className="space-y-3 text-center">
            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.3em]">Covault Walkthrough</span>
            <h3 className="text-xl font-black text-slate-600 dark:text-slate-100 uppercase tracking-tighter leading-none">
              {steps[step].title}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 font-bold text-[13px] leading-relaxed">
              {steps[step].content}
            </p>
          </div>

          <div className="flex space-x-3">
            <button 
              onClick={handleSkip}
              className="flex-1 py-4 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"
            >
              Skip
            </button>
            <button 
              onClick={handleNext}
              className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-emerald-600/20 active:scale-95 transition-all"
            >
              {step === steps.length - 1 ? "Finish" : "Next Step"}
            </button>
          </div>

          <div className="flex justify-center space-x-2">
            {steps.map((_, i) => (
              <div 
                key={i} 
                className={`h-1.5 rounded-full transition-all duration-500 ${i === step ? 'w-6 bg-emerald-600' : 'w-1.5 bg-slate-200 dark:bg-slate-800'}`} 
              />
            ))}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes swipe-demo-icon {
          0% { left: 10%; opacity: 0; transform: translateY(-50%); }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { left: 80%; opacity: 0; transform: translateY(-50%); }
        }
        .animate-swipe-demo-icon {
          animation: swipe-demo-icon 2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
      `}</style>
    </div>
  );
};

export default Tutorial;
