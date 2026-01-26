import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import BudgetSection from './BudgetSection';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';

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

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    document.body.style.overflow = (showSettings || isAddingTx || !!editingTx || !!deletingTxId) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showSettings, isAddingTx, editingTx, deletingTxId]);

  const isSharedView = !state.user?.budgetingSolo;

  const filteredTransactions = useMemo(() => {
    let list = state.transactions;
    if (searchQuery) {
      list = list.filter(t => t.vendor.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return list;
  }, [state.transactions, searchQuery]);

  const remainingMoney = useMemo(() => {
    const totalBudget = state.budgets.reduce((acc, b) => acc + b.totalLimit, 0);
    const totalSpent = state.transactions.reduce((acc, tx) => acc + (tx.isProjected ? 0 : tx.amount), 0);
    const totalProjected = state.transactions.reduce((acc, tx) => acc + (tx.isProjected ? tx.amount : 0), 0);
    return Math.max(0, totalBudget - (totalSpent + totalProjected));
  }, [state.budgets, state.transactions]);

  const leisureAdjustments = useMemo(() => {
    if (!state.settings.useLeisureAsBuffer) return 0;
    
    let totalOverspend = 0;
    state.budgets.forEach(b => {
      if (b.name.toLowerCase().includes('leisure')) return;
      const bTxs = state.transactions.filter(t => t.budgetId === b.id || t.splits?.some(s => s.budgetId === b.id));
      const spent = bTxs.reduce((acc, tx) => {
        if (tx.splits) {
          const s = tx.splits.find(sp => sp.budgetId === b.id);
          return acc + (s?.amount || 0);
        }
        return acc + (tx.budgetId === b.id ? tx.amount : 0);
      }, 0);
      if (spent > b.totalLimit) totalOverspend += (spent - b.totalLimit);
    });
    return totalOverspend;
  }, [state.budgets, state.transactions, state.settings.useLeisureAsBuffer]);

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
          containerEl.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }
      }, 50); 
    }
  };

  const toggleTheme = () => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, theme: prev.settings.theme === 'light' ? 'dark' : 'light' }
    }));
  };

  const updateSettings = (key: keyof AppState['settings'], value: any) => {
    setState(prev => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
  };

  const handleConnectPartner = () => {
    if (!partnerLinkEmail.includes('@')) return;
    setState(prev => ({
      ...prev,
      user: prev.user ? {
        ...prev.user,
        budgetingSolo: false,
        isLinked: true,
        linkedUserEmail: partnerLinkEmail
      } : null,
      currentMode: 'Ours'
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
        isLinked: false,
        linkedUserEmail: undefined
      } : null,
      currentMode: 'Mine'
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

  return (
    <div className="flex-1 flex flex-col h-screen bg-slate-50 dark:bg-slate-950 relative overflow-hidden transition-colors duration-500">
      {/* Universal Floating Cloud Background */}
      {!isFocusMode && (
        <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
          <div className="w-80 h-80 bg-emerald-400/25 dark:bg-emerald-500/35 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16"></div>
          <div className="w-72 h-72 bg-green-300/20 dark:bg-green-400/30 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8"></div>
        </div>
      )}

      <header className="px-6 pt-6 pb-4 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10">
        <div className="relative flex items-center justify-end h-10">
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-2">
            <div className="w-7 h-7 bg-emerald-600 rounded flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <span className="font-black text-sm text-slate-500 dark:text-slate-50 tracking-tighter uppercase">Covault</span>
          </div>

          <button onClick={() => setShowSettings(true)} className="p-2.5 text-slate-400 hover:text-emerald-600 transition-colors active:scale-90 bg-slate-100/50 dark:bg-slate-800/50 backdrop-blur-md rounded-xl">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 pb-28 overflow-hidden relative z-10">
        {!isFocusMode && (
          <div className="flex flex-col items-center justify-center py-2 shrink-0 relative transition-all duration-500">
            <div className="text-center z-10 animate-nest">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-0.5 block">
                {state.user?.budgetingSolo ? 'My Remaining Balance' : 'Our Remaining Balance'}
              </span>
              <div className="flex items-baseline justify-center space-x-1 text-slate-500 dark:text-slate-50">
                <span className="text-sm font-bold opacity-30">$</span>
                <span className="text-4xl font-black tracking-tighter leading-none">{remainingMoney.toLocaleString()}</span>
              </div>
            </div>

            <div className="relative mt-2 w-full max-w-[200px] z-10 animate-nest" style={{ animationDelay: '0.1s' }}>
              <input type="text" placeholder="Find entry..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-2 border-slate-100 dark:border-slate-800 rounded-2xl py-2.5 px-10 text-[12px] font-bold focus:ring-2 focus:ring-emerald-500/20 transition-all dark:text-slate-100 placeholder-slate-400 shadow-sm text-center" />
              <svg className="w-3.5 h-3.5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        )}

        <div 
          ref={scrollContainerRef} 
          className={`flex-1 flex flex-col ${isFocusMode ? 'overflow-hidden' : (expandedBudgets.size > 0 ? 'overflow-y-auto' : 'overflow-hidden')} mt-3 no-scrollbar scroll-smooth h-full transition-all duration-500 gap-2`}
        >
          {state.budgets
            .filter(budget => !isFocusMode || budget.id === focusedBudgetId)
            .map((budget) => {
              const budgetTxs = filteredTransactions.filter(t => 
                t.budgetId === budget.id || (t.splits?.some(s => s.budgetId === budget.id))
              );
              const isLeisure = budget.name.toLowerCase().includes('leisure');
              const displayBudget = isLeisure && state.settings.useLeisureAsBuffer
                ? { ...budget, externalDeduction: leisureAdjustments }
                : budget;
              const isExpanded = expandedBudgets.has(budget.id);
              return (
                <div 
                  key={budget.id} 
                  ref={el => { if (el) budgetRefs.current.set(budget.id, el); else budgetRefs.current.delete(budget.id); }} 
                  className={`transition-all duration-[1200ms] ${isExpanded ? 'ease-in flex-[100] min-h-[70vh]' : 'ease-out flex-1 min-h-0'} flex flex-col`}
                >
                  <BudgetSection 
                    budget={displayBudget as any} transactions={budgetTxs} isExpanded={isExpanded} onToggle={() => toggleExpand(budget.id)} 
                    onUpdateBudget={onUpdateBudget} onDeleteRequest={(id) => setDeletingTxId(id)} onEdit={(tx) => setEditingTx(tx)} 
                    currentUserName={state.user?.name || ''} isSharedView={isSharedView} 
                    allBudgets={state.budgets}
                  />
                </div>
              );
            })
          }
          
          {!isFocusMode && expandedBudgets.size > 0 && <div className="h-[60vh] flex-none pointer-events-none" />}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 p-4 flex flex-col items-center pointer-events-none pb-safe">
        <div className="w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-3xl border border-slate-100 dark:border-slate-800/60 rounded-[3rem] p-3 pointer-events-auto shadow-2xl animate-nest" style={{ animationDelay: '0.4s' }}>
          <div className="flex items-center justify-between px-2">
            <div className="flex flex-1 justify-around">
              {firstHalfBudgets.map(b => (
                <button key={b.id} onClick={() => jumpToBudget(b.id)} className={`p-4 rounded-2xl transition-all duration-300 ${expandedBudgets.has(b.id) ? 'bg-emerald-600 text-white shadow-xl scale-110' : 'text-slate-400 dark:text-slate-600'}`}>
                  {getBudgetIcon(b.name)}
                </button>
              ))}
            </div>
            <button onClick={() => setIsAddingTx(true)} className="mx-4 p-4 bg-slate-500 dark:bg-emerald-600 text-white rounded-2xl shadow-xl flex items-center justify-center active:scale-95 transition-all shrink-0 scale-110">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <div className="flex flex-1 justify-around">
              {secondHalfBudgets.map(b => (
                <button key={b.id} onClick={() => jumpToBudget(b.id)} className={`p-4 rounded-2xl transition-all duration-300 ${expandedBudgets.has(b.id) ? 'bg-emerald-600 text-white shadow-xl scale-110' : 'text-slate-400 dark:text-slate-600'}`}>
                  {getBudgetIcon(b.name)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="w-full max-sm bg-white dark:bg-slate-900 rounded-[3rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto no-scrollbar border border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">Vault Settings</h2>
              <button onClick={() => { setShowSettings(false); setIsLinkingPartner(false); }} className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90"><svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col"><span className="font-black text-base text-slate-500 dark:text-slate-200">Dark Interface</span><span className="text-xs text-slate-500 font-medium">Calm appearance for low light.</span></div>
                <button onClick={toggleTheme} className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${state.settings.theme === 'dark' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}><div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${state.settings.theme === 'dark' ? 'translate-x-6' : 'translate-x-0'}`} /></button>
              </div>
              <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col"><span className="font-black text-base text-slate-500 dark:text-slate-200">Budget Rollover</span><span className="text-xs text-slate-500 font-medium">Carry surplus to next month.</span></div>
                <button onClick={() => updateSettings('rolloverEnabled', !state.settings.rolloverEnabled)} className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${state.settings.rolloverEnabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}><div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${state.settings.rolloverEnabled ? 'translate-x-6' : 'translate-x-0'}`} /></button>
              </div>
              <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col mb-4"><span className="font-black text-base text-slate-500 dark:text-slate-200">Discretionary Shield</span><p className="text-[11px] text-slate-500 font-medium mt-1">If a budget overspends, money from your Leisure vault will be automatically reallocated to cover it.</p></div>
                <button onClick={() => updateSettings('useLeisureAsBuffer', !state.settings.useLeisureAsBuffer)} className={`w-full py-4 text-xs font-black rounded-2xl transition-all border-2 ${state.settings.useLeisureAsBuffer ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>{state.settings.useLeisureAsBuffer ? 'SHIELD ACTIVE' : 'SHIELD OFF'}</button>
              </div>

              {/* Partner Sharing Section */}
              <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <div className="flex flex-col">
                  <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">Vault Sharing</span>
                  <p className="text-[11px] text-slate-500 font-medium mt-1">Connect with a partner to view and manage your combined remaining balance.</p>
                </div>

                {state.user?.isLinked ? (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="flex items-center p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mr-4">
                        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Linked With</span>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-200 truncate max-w-[160px]">{state.user.linkedUserEmail}</span>
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

              <button onClick={onSignOut} className="w-full py-6 text-rose-500 font-black bg-rose-50 dark:bg-rose-900/20 rounded-3xl active:scale-95 transition-transform uppercase tracking-widest mt-6">Sign Out</button>
              
              <div className="text-center pt-4">
                 <p className="text-[9px] font-bold text-slate-400 dark:text-slate-700 uppercase tracking-[0.1em]">Version 2.0 • Covault encrypted</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddingTx && (
        <TransactionForm 
          onClose={() => setIsAddingTx(false)} 
          onSave={onAddTransaction} 
          budgets={state.budgets} 
          userId={state.user?.id || '1'} 
          userName={state.user?.name || 'User'} 
        />
      )}

      {editingTx && (
        <TransactionForm 
          onClose={() => setEditingTx(null)} 
          onSave={handleUpdateTransaction} 
          budgets={state.budgets} 
          userId={state.user?.id || '1'} 
          userName={state.user?.name || 'User'} 
          initialTransaction={editingTx}
        />
      )}

      {deletingTxId && (
        <ConfirmDeleteModal 
          onClose={() => setDeletingTxId(null)} 
          onConfirm={() => { onDeleteTransaction(deletingTxId); setDeletingTxId(null); }} 
        />
      )}
    </div>
  );
};

export default Dashboard;