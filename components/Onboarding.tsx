import React, { useState } from 'react';
import { BudgetCategory } from '../types';
import { SYSTEM_CATEGORIES } from '../constants';

interface OnboardingProps {
  onComplete: (isSolo: boolean, bankMode: 'shared' | 'separate', budgets: BudgetCategory[], partnerEmail?: string) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [isSolo, setIsSolo] = useState<boolean | null>(null);
  const [partnerExists, setPartnerExists] = useState<boolean | null>(null);
  const [partnerEmail, setPartnerEmail] = useState('');

  const steps = [
    {
      title: "Spent vs. Projected",
      content: "Solid bars show current spending. Dashed bars project your future based on recurring bills.",
      icon: (
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/10 blur-3xl rounded-full animate-pulse"></div>
          <svg className="w-32 h-32 text-emerald-600 dark:text-emerald-400 relative" viewBox="0 0 24 24" fill="currentColor">
            <rect x="2" y="20" width="20" height="1.5" rx="0.75" className="opacity-20" />
            <rect x="4" y="10" width="4" height="10" rx="1" className="animate-bar" style={{ animationDelay: '0.1s' }} />
            <rect x="10" y="6" width="4" height="14" rx="1" className="animate-bar opacity-60" style={{ animationDelay: '0.3s' }} />
            <rect x="16" y="14" width="4" height="6" rx="1" className="animate-bar opacity-30" style={{ animationDelay: '0.5s' }} />
          </svg>
        </div>
      )
    },
    {
      title: "Sync & Forget",
      content: "Covault listens for banking notifications to auto-file transactions. You just review and confirm.",
      icon: (
        <div className="relative">
          <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full animate-pulse"></div>
          <div className="animate-swing">
            <svg className="w-32 h-32 text-emerald-600 dark:text-emerald-400 relative" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17v1a3 3 0 11-6 0v-1h6z" />
            </svg>
          </div>
          <div className="absolute top-6 right-6 w-5 h-5 bg-emerald-500 rounded-full border-4 border-white dark:border-slate-950 animate-ping opacity-75"></div>
          <div className="absolute top-6 right-6 w-5 h-5 bg-emerald-500 rounded-full border-4 border-white dark:border-slate-950 shadow-sm"></div>
        </div>
      )
    }
  ];

  const handleNextIntro = (e: React.MouseEvent) => {
    e.preventDefault();
    setStep(step + 1);
  };

  const handleFinish = () => {
    onComplete(isSolo === true, 'separate', SYSTEM_CATEGORIES, partnerEmail || undefined);
  };

  const StepWrapper = ({ children, className = "" }: { children?: React.ReactNode, className?: string }) => (
    <div className={`flex-1 flex flex-col p-8 bg-slate-50 dark:bg-slate-950 transition-colors relative overflow-hidden ${className}`}>
      {children}
    </div>
  );

  // STEP: WHO IS THIS FOR (Step 2)
  if (step === steps.length) {
    return (
      <StepWrapper className="justify-center text-center space-y-12">
        <div className="space-y-4 animate-nest">
          <h2 className="text-4xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">Who is this for?</h2>
          <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">Clarity for yourself or confidence together.</p>
        </div>
        
        <div className="space-y-6">
          <button 
            type="button"
            onClick={() => { setIsSolo(true); onComplete(true, 'separate', SYSTEM_CATEGORIES); }}
            className="w-full p-8 rounded-[3rem] bg-white dark:bg-slate-900 border-2 border-transparent hover:border-emerald-500 transition-all active:scale-95 flex items-center space-x-6 text-left shadow-2xl shadow-slate-200/20 dark:shadow-none"
          >
            <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-black text-xl text-slate-500 dark:text-slate-100 mb-1 uppercase tracking-tight">Just Mine</div>
              <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Focused personal clarity.</div>
            </div>
          </button>
          
          <button 
            type="button"
            onClick={() => { setIsSolo(false); setStep(step + 1); }}
            className="w-full p-8 rounded-[3rem] bg-white dark:bg-slate-900 border-2 border-transparent hover:border-emerald-500 transition-all active:scale-95 flex items-center space-x-6 text-left shadow-2xl shadow-slate-200/20 dark:shadow-none"
          >
            <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-black text-xl text-slate-500 dark:text-slate-100 mb-1 uppercase tracking-tight">Ours Together</div>
              <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Build a future together.</div>
            </div>
          </button>
        </div>
      </StepWrapper>
    );
  }

  // STEP: PARTNER STATUS (Step 3)
  if (step === steps.length + 1 && isSolo === false) {
    return (
      <StepWrapper className="justify-center text-center space-y-12">
        <div className="space-y-4 animate-nest">
          <h2 className="text-4xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">Partner Status</h2>
          <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">Is your partner already on Covault?</p>
        </div>
        
        <div className="space-y-6">
          <button 
            type="button"
            onClick={() => { setPartnerExists(true); setStep(step + 1); }}
            className={`w-full p-8 rounded-[3rem] bg-white dark:bg-slate-900 border-2 border-transparent hover:border-emerald-500 transition-all active:scale-95 shadow-2xl shadow-slate-200/20 dark:shadow-none flex items-center space-x-6 text-left`}
          >
             <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center shadow-sm">
                <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
             </div>
             <div className="flex-1">
                <div className="font-black text-xl text-slate-500 dark:text-slate-100 mb-1 uppercase tracking-tight">Yes, we're ready</div>
                <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Connect our existing vaults.</div>
             </div>
          </button>
          
          <button 
            type="button"
            onClick={() => { setPartnerExists(false); setStep(step + 1); }}
            className={`w-full p-8 rounded-[3rem] bg-white dark:bg-slate-900 border-2 border-transparent hover:border-emerald-500 transition-all active:scale-95 shadow-2xl shadow-slate-200/20 dark:shadow-none flex items-center space-x-6 text-left`}
          >
             <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center shadow-sm">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
             </div>
             <div className="flex-1">
                <div className="font-black text-xl text-slate-500 dark:text-slate-100 mb-1 uppercase tracking-tight">Not yet</div>
                <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Send them an invite code.</div>
             </div>
          </button>
        </div>

        <button 
          type="button"
          onClick={handleFinish}
          className="text-slate-400 dark:text-slate-600 font-black text-[10px] uppercase tracking-[0.3em] hover:text-emerald-500 transition-colors"
        >
          Skip for now
        </button>
      </StepWrapper>
    );
  }

  // STEP: PARTNER EMAIL (Step 4)
  if (step === steps.length + 2 && isSolo === false) {
    return (
      <StepWrapper className="justify-center text-center space-y-12">
        <div className="space-y-4 animate-nest">
          <h2 className="text-4xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            {partnerExists ? 'Link Vault' : 'Invite Partner'}
          </h2>
          <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs">
            {partnerExists ? "What is your partner's email?" : "Where should we send the invite?"}
          </p>
        </div>

        <div className="space-y-8">
           <div className="relative flex flex-col items-center">
             <input 
              autoFocus
              type="email" 
              placeholder="partner@example.com"
              value={partnerEmail}
              onChange={e => setPartnerEmail(e.target.value)}
              className="w-full bg-transparent border-b-2 border-slate-200 dark:border-slate-800 py-6 text-2xl font-black text-slate-500 dark:text-slate-100 placeholder-slate-200 dark:placeholder-slate-800 outline-none text-center focus:border-emerald-500 transition-all"
            />
           </div>

           <button 
              disabled={!partnerEmail.includes('@')}
              onClick={handleFinish}
              className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black text-lg shadow-2xl shadow-emerald-500/20 active:scale-95 disabled:opacity-30 transition-all uppercase tracking-widest"
            >
              {partnerExists ? 'Send Link Request' : 'Send App Invite'}
            </button>
        </div>

        <button 
          onClick={() => setStep(step - 1)}
          className="text-slate-400 dark:text-slate-600 font-black text-[10px] uppercase tracking-[0.3em]"
        >
          Go Back
        </button>
      </StepWrapper>
    );
  }

  // INTRO STEPS (0, 1)
  return (
    <StepWrapper>
      <div className="flex-1 flex flex-col items-center justify-center space-y-12">
        <div className="w-72 h-72 bg-white dark:bg-slate-900 rounded-[4rem] flex items-center justify-center shadow-2xl border border-slate-100 dark:border-slate-800/60 animate-nest overflow-hidden relative">
           <div className="absolute inset-0 bg-slate-50/50 dark:bg-slate-800/20" />
           {steps[step].icon}
        </div>
        <div className="text-center space-y-6 max-w-xs animate-nest" style={{ animationDelay: '0.2s' }}>
          <h2 className="text-3xl font-black text-slate-500 dark:text-slate-100 tracking-tighter leading-tight uppercase">{steps[step].title}</h2>
          <p className="text-slate-400 dark:text-slate-500 font-bold text-sm uppercase tracking-widest leading-relaxed">{steps[step].content}</p>
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-auto pt-8">
        <div className="flex space-x-4">
          {steps.map((_, i) => (
            <div key={i} className={`h-2 rounded-full transition-all duration-700 ${i === step ? 'w-10 bg-emerald-600' : 'w-2 bg-slate-200 dark:bg-slate-800'}`} />
          ))}
        </div>
        <button 
          type="button"
          onClick={handleNextIntro}
          className="w-20 h-20 bg-emerald-600 rounded-[2.5rem] flex items-center justify-center text-white shadow-2xl active:scale-90 transition-all"
        >
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </StepWrapper>
  );
};

export default Onboarding;