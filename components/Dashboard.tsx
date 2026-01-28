
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import BudgetSection from './BudgetSection';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import Tutorial from './Tutorial';

interface DashboardProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onSignOut: () => void;
  onUpdateBudget: (b: BudgetCategory) => void;
  onAddTransaction: (t: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
}

export const getBudgetIcon = (name: string) => {
  const lower = name.toLowerCase();
  const iconProps = { className: "w-5 h-5", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round" } as const;

  if (lower.includes('housing')) return <svg {...iconProps} viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>;
  if (lower.includes('groceries')) return <svg {...iconProps} viewBox="0 0 24 24"><path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37L2.27 21.7z"/><path d="M18.4 5.6 19.1 3.5"/><path d="M17 10.4 18.4 11.8"/><path d="M13.6 17 15 18.4"/><path d="M18.4 5.6 20.5 4.9"/><path d="M18.4 5.6 19.8 7"/></svg>;
  if (lower.includes('transport')) return <svg {...iconProps} viewBox="0 0 24 24"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 13.1V16c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>;
  if (lower.includes('dining') || lower.includes('leisure')) return <svg {...iconProps} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>;
  if (lower.includes('utilities')) return <svg {...iconProps} viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>;
  return <svg {...iconProps} viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"/></svg>;
};

const Dashboard: React.FC<DashboardProps> = ({ state, setState, onSignOut, onUpdateBudget, onAddTransaction, onDeleteTransaction }) => {
  const [isAddingTx, setIsAddingTx] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const [showTutorial, setShowTutorial] = useState(!state.settings.hasSeenTutorial);
  const [tutorialStep, setTutorialStep] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    document.body.style.overflow = (showSettings || isAddingTx || !!editingTx || !!deletingTxId || showTutorial) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showSettings, isAddingTx, editingTx, deletingTxId, showTutorial]);

  const isSharedAccount = !state.user?.budgetingSolo;

  const filteredTransactions = useMemo(() => {
    let list = state.transactions;
    if (searchQuery) {
      list = list.filter(t => t.vendor.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return list;
  }, [state.transactions, searchQuery]);

  // Calculate total income (user's income + partner's income for couples)
  const totalIncome = useMemo(() => {
    const userIncome = state.user?.monthlyIncome || 0;
    // TODO: When partner data is fetched, add partner's income here
    return userIncome;
  }, [state.user?.monthlyIncome]);

  const remainingMoney = useMemo(() => {
    const totalSpent = filteredTransactions.reduce((acc, tx) => acc + (tx.is_projected ? 0 : tx.amount), 0);
    const totalProjected = filteredTransactions.reduce((acc, tx) => acc + (tx.is_projected ? tx.amount : 0), 0);
    return totalIncome - (totalSpent + totalProjected);
  }, [totalIncome, filteredTransactions]);

  const leisureAdjustments = useMemo(() => {
    if (!state.settings.useLeisureAsBuffer) return 0;

    let totalOverspend = 0;
    state.budgets.forEach(b => {
      if (b.name.toLowerCase().includes('leisure')) return;
      const bTxs = filteredTransactions.filter(t => t.budget_id === b.id || t.splits?.some(s => s.budget_id === b.id));
      const spent = bTxs.reduce((acc, tx) => {
        if (tx.splits) {
          const s = tx.splits.find(sp => sp.budget_id === b.id);
          return acc + (s?.amount || 0);
        }
        return acc + (tx.budget_id === b.id ? tx.amount : 0);
      }, 0);
      if (spent > b.totalLimit) totalOverspend += (spent - b.totalLimit);
    });
    return totalOverspend;
  }, [state.budgets, filteredTransactions, state.settings.useLeisureAsBuffer]);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedBudgets);
    if (next.has(id)) next.delete(id); else { next.clear(); next.add(id); }
    setExpandedBudgets(next);
  };

  const jumpToBudget = (id: string) => {
    const isCurrentlyFocused = expandedBudgets.has(id) && expandedBudgets.size === 1;
    if (isCurrentlyFocused) {
      setExpandedBudgets(new Set());
    } else {
      setExpandedBudgets(new Set([id]));
      setTimeout(() => {
        const containerEl = scrollContainerRef.current;
        if (containerEl) {
          containerEl.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 50);
    }
  };

  const updateSettings = (key: keyof AppState['settings'], value: any) => {
    setState(prev => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
  };

  const updateUserIncome = (income: number) => {
    setState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, monthlyIncome: income } : null
    }));
  };

  const handleConnectPartner = () => {
    if (!partnerLinkEmail.includes('@')) return;
    setState(prev => ({
      ...prev,
      user: prev.user ? {
        ...prev.user,
        budgetingSolo: false,
        partnerEmail: partnerLinkEmail
      } : null
    }));
    setIsLinkingPartner(false);
    setPartnerLinkEmail('');
  };

  const handleDisconnectPartner = () => {
    setState(prev => ({
      ...prev,
      user: prev.user ? {
        ...prev.user,
        budgetingSolo: true,
        partnerId: undefined,
        partnerEmail: undefined,
        partnerName: undefined
      } : null
    }));
  };

  const handleUpdateTransaction = (updatedTx: Transaction) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => t.id === updatedTx.id ? updatedTx : t)
    }));
    setEditingTx(null);
  };

  const firstHalfBudgets = state.budgets.slice(0, Math.ceil(state.budgets.length / 2));
  const secondHalfBudgets = state.budgets.slice(Math.ceil(state.budgets.length / 2));

  const isFocusMode = expandedBudgets.size === 1;
  const focusedBudgetId = isFocusMode ? Array.from(expandedBudgets)[0] : null;

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    setShowSettings(false);
    updateSettings('hasSeenTutorial', true);
  };

  const handleTutorialStepChange = (step: number) => {
    setTutorialStep(step);
    // Steps 0-4 are Dashboard highlights, 5-12 are Settings highlights
    if (step >= 5 && step <= 12) {
      setShowSettings(true);
    } else {
      setShowSettings(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {!isFocusMode && (
        <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
          <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
          <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
        </div>
      )}

      <header className="px-6 pt-safe-top pb-4 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}>
        <div className="relative flex items-center justify-end h-10">
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-2">
            <div className="w-7 h-7 rounded flex items-center justify-center shadow-lg transition-colors duration-700 bg-emerald-600 shadow-emerald-500/20">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <span className="font-black text-sm tracking-tighter uppercase transition-colors duration-700 text-slate-500 dark:text-slate-50">Covault</span>
          </div>

          <button id="settings-button" onClick={() => setShowSettings(true)} className="p-2.5 transition-colors active:scale-90 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-xl text-slate-400 hover:text-emerald-600">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 pb-28 overflow-hidden relative z-10">
        {!isFocusMode && (
          <div id="balance-header" className="flex flex-col items-center justify-center py-2 shrink-0 relative">
            <div className="text-center z-10 animate-nest">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] mb-0.5 block transition-colors duration-700 text-slate-400 dark:text-slate-500">
                {isSharedAccount ? 'Our Remaining Balance' : 'My Remaining Balance'}
              </span>
              <div className="flex items-baseline justify-center space-x-1 transition-colors duration-700">
                <span className="text-sm font-bold opacity-30 text-slate-500 dark:text-slate-50">$</span>
                <span className={`text-4xl font-black tracking-tighter leading-none transition-colors duration-700 ${remainingMoney < 0 ? 'text-rose-500' : 'text-slate-500 dark:text-slate-50'}`}>
                  {remainingMoney.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="relative mt-2 w-full max-w-[200px] z-10 animate-nest" style={{ animationDelay: '0.1s' }}>
              <input type="text" placeholder="Find entry..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-2 rounded-2xl py-2.5 px-10 text-[12px] font-bold focus:ring-2 transition-all placeholder-slate-400 shadow-sm text-center border-slate-100 dark:border-slate-800 focus:ring-emerald-500/20 dark:text-slate-100" />
              <svg className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          className={`flex-1 flex flex-col ${isFocusMode ? 'overflow-hidden' : (expandedBudgets.size > 0 ? 'overflow-y-auto' : 'overflow-hidden')} mt-3 no-scrollbar scroll-smooth h-full transition-all duration-500 gap-2`}
        >
          {state.budgets
            .filter(budget => !isFocusMode || budget.id === focusedBudgetId)
            .map((budget, index) => {
              const budgetTxs = filteredTransactions.filter(t =>
                t.budget_id === budget.id || (t.splits?.some(s => s.budget_id === budget.id))
              );
              const isExpanded = expandedBudgets.has(budget.id);
              const isLeisure = budget.name.toLowerCase().includes('leisure');
              const displayBudget = isLeisure && state.settings.useLeisureAsBuffer
                ? { ...budget, externalDeduction: leisureAdjustments }
                : budget;
              return (
                <div
                  key={budget.id}
                  id={index === 0 ? "first-budget-card" : undefined}
                  ref={el => { if (el) budgetRefs.current.set(budget.id, el); else budgetRefs.current.delete(budget.id); }}
                  className={`transition-all duration-500 ${isExpanded ? 'flex-[100] min-h-[70vh]' : 'flex-1 min-h-0'} flex flex-col`}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <BudgetSection
                    budget={displayBudget as any}
                    transactions={budgetTxs}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(budget.id)}
                    onUpdateBudget={onUpdateBudget}
                    onDeleteRequest={(id) => setDeletingTxId(id)}
                    onEdit={(tx) => setEditingTx(tx)}
                    currentUserName={state.user?.name || ''}
                    isSharedView={isSharedAccount}
                    allBudgets={state.budgets}
                  />
                </div>
              );
            })
          }

          {!isFocusMode && expandedBudgets.size > 0 && <div className="h-[60vh] flex-none pointer-events-none" />}
        </div>
      </main>

      <div id="bottom-bar" className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2 flex flex-col items-center pointer-events-none pb-safe">
        <div className="w-full backdrop-blur-3xl border rounded-full px-3 py-2 pointer-events-auto shadow-2xl animate-nest transition-all duration-700 bg-white/95 dark:bg-slate-900/95 border-slate-100 dark:border-slate-800/60" style={{ animationDelay: '0.4s' }}>
          <div className="flex items-center justify-evenly">
            {firstHalfBudgets.map(b => (
              <button key={b.id} onClick={() => jumpToBudget(b.id)} className={`p-2 rounded-full transition-all duration-300 ${expandedBudgets.has(b.id) ? 'bg-emerald-600 text-white shadow-lg scale-110' : 'text-slate-400 dark:text-slate-600'}`}>
                {getBudgetIcon(b.name)}
              </button>
            ))}
            <button id="add-transaction-button" onClick={() => setIsAddingTx(true)} className="p-3 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all bg-slate-500 dark:bg-emerald-600">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            {secondHalfBudgets.map(b => (
              <button key={b.id} onClick={() => jumpToBudget(b.id)} className={`p-2 rounded-full transition-all duration-300 ${expandedBudgets.has(b.id) ? 'bg-emerald-600 text-white shadow-lg scale-110' : 'text-slate-400 dark:text-slate-600'}`}>
                {getBudgetIcon(b.name)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div ref={settingsScrollRef} className="w-full max-sm bg-white dark:bg-slate-900 rounded-[3rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto no-scrollbar border border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">Vault Settings</h2>
              <button
                disabled={showTutorial}
                onClick={() => { setShowSettings(false); setIsLinkingPartner(false); }}
                className={`p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90 ${showTutorial ? 'opacity-20 cursor-not-allowed' : ''}`}
              >
                <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => { setShowSettings(false); setShowTutorial(true); }}
                className="w-full py-5 bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-black rounded-2xl hover:bg-emerald-100 transition-colors uppercase tracking-[0.2em] shadow-sm active:scale-95"
              >
                Run Tutorial
              </button>

              <div id="settings-income-container" className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col mb-4">
                  <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
                    {isSharedAccount ? 'My Monthly Income' : 'Monthly Income'}
                  </span>
                  <p className="text-[11px] text-slate-500 font-medium mt-1">
                    {isSharedAccount
                      ? "Your income contribution. Your partner's income will be added automatically."
                      : "This defines your total cash flow for the month."
                    }
                  </p>
                </div>
                <div className="flex items-center space-x-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3">
                  <span className="text-slate-400 font-black">$</span>
                  <input
                    type="number"
                    value={state.user?.monthlyIncome || 0}
                    onChange={(e) => updateUserIncome(parseFloat(e.target.value) || 0)}
                    className="bg-transparent w-full outline-none font-black text-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>

              <div id="settings-theme-container" className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col">
                  <span className="font-black text-base text-slate-500 dark:text-slate-200">Dark Interface</span>
                  <span className="text-xs text-slate-500 font-medium">Calm appearance for low light.</span>
                </div>
                <button
                  onClick={() => updateSettings('theme', state.settings.theme === 'light' ? 'dark' : 'light')}
                  className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${state.settings.theme === 'dark' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${state.settings.theme === 'dark' ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div id="settings-rollover-container" className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col">
                  <span className="font-black text-base text-slate-500 dark:text-slate-200">Budget Rollover</span>
                  <span className="text-xs text-slate-500 font-medium">Carry surplus to next month.</span>
                </div>
                <button
                  onClick={() => updateSettings('rolloverEnabled', !state.settings.rolloverEnabled)}
                  className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${state.settings.rolloverEnabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${state.settings.rolloverEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div id="settings-shield-container" className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col mb-4">
                  <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">Discretionary Shield</span>
                  <p className="text-[11px] text-slate-500 font-medium mt-1">If a budget overspends, money from your Leisure vault will be automatically reallocated to cover it.</p>
                </div>
                <button
                  onClick={() => updateSettings('useLeisureAsBuffer', !state.settings.useLeisureAsBuffer)}
                  className={`w-full py-4 text-xs font-black rounded-2xl transition-all border-2 ${state.settings.useLeisureAsBuffer ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >
                  {state.settings.useLeisureAsBuffer ? 'SHIELD ACTIVE' : 'SHIELD OFF'}
                </button>
              </div>

              <div id="settings-sharing-container" className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <div className="flex flex-col">
                  <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">Vault Sharing</span>
                  <p className="text-[11px] text-slate-500 font-medium mt-1">Connect with a partner to view and manage your combined budget.</p>
                </div>

                {state.user?.partnerEmail ? (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="flex items-center p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mr-4">
                        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Linked With</span>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-200 truncate max-w-[160px]">{state.user.partnerEmail}</span>
                      </div>
                    </div>
                    <button
                      onClick={handleDisconnectPartner}
                      className="w-full py-4 bg-rose-50 dark:bg-rose-900/20 text-rose-500 text-[11px] font-black rounded-2xl hover:bg-rose-100 transition-colors uppercase tracking-widest"
                    >
                      Disconnect Partner
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {isLinkingPartner ? (
                      <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                        <input
                          autoFocus
                          type="email"
                          placeholder="Partner's email..."
                          value={partnerLinkEmail}
                          onChange={e => setPartnerLinkEmail(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 px-5 text-sm font-bold text-slate-600 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <div className="flex space-x-2">
                          <button
                            disabled={!partnerLinkEmail.includes('@')}
                            onClick={handleConnectPartner}
                            className="flex-1 py-4 bg-emerald-600 text-white text-[11px] font-black rounded-2xl shadow-lg shadow-emerald-500/10 active:scale-95 transition-all uppercase tracking-widest disabled:opacity-30"
                          >
                            Send Request
                          </button>
                          <button
                            onClick={() => { setIsLinkingPartner(false); setPartnerLinkEmail(''); }}
                            className="px-6 py-4 bg-slate-100 dark:bg-slate-700 text-slate-400 text-[11px] font-black rounded-2xl active:scale-95 transition-all uppercase tracking-widest"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsLinkingPartner(true)}
                        className="w-full py-5 bg-white dark:bg-slate-900 border-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-black rounded-2xl hover:bg-emerald-50 transition-colors uppercase tracking-[0.15em] shadow-sm active:scale-95"
                      >
                        + Link a Partner
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-8 space-y-6">
                <div className="flex items-center justify-between px-2">
                  <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                  <span className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-[0.2em] px-4">Support & Feedback</span>
                  <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                </div>
                <div className="space-y-3">
                  <a
                    id="report-problem-button"
                    href="mailto:itsjustmyemail@gmail.com?subject=Covault: Problem Report"
                    className="flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group"
                  >
                    <div className="w-10 h-10 bg-rose-50 dark:bg-rose-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                      <svg className="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">Report a Problem</span>
                    <svg className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                  </a>

                  <a
                    id="request-feature-button"
                    href="mailto:itsjustmyemail@gmail.com?subject=Covault: Feature Request"
                    className="flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group"
                  >
                    <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                      <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" /></svg>
                    </div>
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">Request a Feature</span>
                    <svg className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                  </a>
                </div>
              </div>

              <button
                id="sign-out-button"
                onClick={onSignOut}
                className="w-full py-6 text-rose-500 font-black bg-rose-50 dark:bg-rose-900/20 rounded-3xl active:scale-95 transition-transform uppercase tracking-widest mt-6"
              >
                Sign Out
              </button>

              <div className="text-center pt-4">
                 <p className="text-[9px] font-bold text-slate-400 dark:text-slate-700 uppercase tracking-[0.1em]">Version 3.0 • Covault simplified</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddingTx && (
        <TransactionForm onClose={() => setIsAddingTx(false)} onSave={onAddTransaction} budgets={state.budgets} userId={state.user?.id || '1'} userName={state.user?.name || 'User'} isSharedAccount={isSharedAccount} />
      )}

      {editingTx && (
        <TransactionForm onClose={() => setEditingTx(null)} onSave={handleUpdateTransaction} budgets={state.budgets} userId={state.user?.id || '1'} userName={state.user?.name || 'User'} initialTransaction={editingTx} isSharedAccount={isSharedAccount} />
      )}

      {deletingTxId && (
        <ConfirmDeleteModal onClose={() => setDeletingTxId(null)} onConfirm={() => { onDeleteTransaction(deletingTxId); setDeletingTxId(null); }} />
      )}

      {showTutorial && (
        <Tutorial
          isShared={isSharedAccount}
          onComplete={handleTutorialComplete}
          onStepChange={handleTutorialStepChange}
        />
      )}
    </div>
  );
};

export default Dashboard;
