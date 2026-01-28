
import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';

interface AuthProps {
  onSignIn: () => void;
}

const Auth: React.FC<AuthProps> = ({ onSignIn }) => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setIsLoggingIn(true);
      setAuthError(null);

      // For native apps, use a different redirect approach
      const redirectUrl = Capacitor.isNativePlatform()
        ? 'com.covault.app://auth/callback'
        : window.location.href;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      });

      if (error) throw error;
    } catch (err: any) {
      console.error("Supabase Auth Error Detail:", err);
      setAuthError(err.message || "An unexpected error occurred during sign in.");
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-8 bg-slate-50 dark:bg-slate-950 transition-colors relative overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)' }}>
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
            <h1 className="text-5xl font-black text-slate-500 dark:text-slate-100 tracking-tighter">Covault</h1>
            <p className="text-slate-500 dark:text-slate-400 text-lg font-medium">Budgeting for peace of mind.</p>
          </div>
        </div>
      </div>

      <div className="relative space-y-6 mt-auto flex flex-col items-center pb-8">
        {authError && (
          <div className="w-full max-w-xs p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl mb-4 animate-in fade-in slide-in-from-bottom-2">
            <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1 text-center">Security Alert</p>
            <p className="text-xs text-rose-600 dark:text-rose-400 text-center font-medium">{authError}</p>
            {!Capacitor.isNativePlatform() && (
              <div className="mt-2 space-y-1">
                <p className="text-[7px] text-slate-400 text-center uppercase">1. Add redirect to Supabase Dashboard</p>
                <p className="text-[7px] text-slate-400 text-center uppercase">2. Add Callback to Google Console</p>
              </div>
            )}
          </div>
        )}

        {isLoggingIn ? (
          <div className="flex items-center space-x-4 py-4 animate-pulse">
            <svg className="animate-spin h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-xl font-black text-slate-500 dark:text-slate-200 tracking-tight uppercase">Opening Vault...</span>
          </div>
        ) : (
          <button
            onClick={handleGoogleLogin}
            className="w-full max-w-xs py-5 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-[2rem] shadow-xl hover:shadow-2xl hover:border-emerald-500 transition-all active:scale-95 flex items-center justify-center space-x-4 group"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span className="text-slate-600 dark:text-slate-100 font-black text-sm uppercase tracking-widest">
              Connect with Google
            </span>
          </button>
        )}

        <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest max-w-[240px] mx-auto">
          Secured by Supabase • AES-256
        </p>
      </div>
    </div>
  );
};

export default Auth;
