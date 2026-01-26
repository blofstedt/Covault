import React, { useState } from 'react';
import { User } from '../types';

interface AuthProps {
  onSignIn: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onSignIn }) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleGoogleSignIn = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    // Simulate a brief "Vault Opening" delay
    setTimeout(() => {
      const mockUser: User = {
        id: 'user_123',
        name: 'Alex Johnson',
        email: 'alex.j@example.com',
        isLinked: false,
        bankAccountMode: 'separate',
        budgetingSolo: true,
      };
      onSignIn(mockUser);
    }, 1200);
  };

  return (
    <div className="flex-1 flex flex-col p-8 bg-slate-50 dark:bg-slate-950 transition-colors relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-400/20 dark:bg-emerald-600/10 rounded-full blur-[100px] animate-blob"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-[100px] animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center space-y-12">
        <div className="flex flex-col items-center space-y-6 animate-nest">
          <div className="w-28 h-28 bg-emerald-600 rounded-[2.5rem] rotate-12 flex items-center justify-center shadow-2xl shadow-emerald-500/40 animate-breathe">
            <svg className="w-16 h-16 text-white -rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="12" cy="12" r="4" />
              <path d="M12 8v1" />
              <path d="M12 15v1" />
              <path d="M8 12h1" />
              <path d="M15 12h1" />
              <path d="M12 12l2 2" />
            </svg>
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-black text-slate-500 dark:text-slate-100 tracking-tighter stagger-1">Covault</h1>
            <p className="text-slate-500 dark:text-slate-400 text-lg font-medium stagger-2">Budgeting for peace of mind.</p>
          </div>
        </div>
      </div>
      
      <div className="relative space-y-6 stagger-3 mt-auto">
        <button 
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoggingIn}
          className="group w-full py-6 px-8 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-[2.5rem] flex items-center justify-center space-x-4 shadow-2xl shadow-slate-200/50 dark:shadow-none hover:border-emerald-500 dark:hover:border-emerald-500 transition-all active:scale-95 disabled:opacity-50"
        >
          {isLoggingIn ? (
            <div className="flex items-center space-x-3">
              <svg className="animate-spin h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-lg font-bold text-slate-500 dark:text-slate-200">Opening Vault...</span>
            </div>
          ) : (
            <>
              <img src="https://www.google.com/favicon.ico" className="w-6 h-6 grayscale group-hover:grayscale-0 transition-all" alt="Google" />
              <span className="text-xl font-bold text-slate-500 dark:text-slate-200">Continue with Google</span>
            </>
          )}
        </button>
        
        <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest max-w-[240px] mx-auto">
          Private • Secure • Encrypted
        </p>
      </div>
    </div>
  );
};

export default Auth;