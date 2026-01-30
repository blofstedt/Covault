import React, { useState, useRef, useMemo } from 'react';
import { Transaction } from '../types';
import { FlagTransactionButton } from './FlagTransactionButton';

interface TransactionItemProps {
  transaction: Transaction;
  onDeleteRequest: (id: string) => void;
  onEdit: (tx: Transaction) => void;
  currentUserName: string;
  isSharedView: boolean;
  currentBudgetId?: string;
  budgets?: any[];
}

const SWIPE_THRESHOLD = 80;

const TransactionItem: React.FC<TransactionItemProps> = ({
  transaction,
  onDeleteRequest,
  onEdit,
  currentUserName,
  isSharedView,
  currentBudgetId,
}) => {
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef<'horizontal' | 'vertical' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayAmount = useMemo(() => {
    if (transaction.splits && transaction.splits.length > 0 && currentBudgetId) {
      const split = transaction.splits.find((s) => s.budget_id === currentBudgetId);
      return split ? split.amount : transaction.amount;
    }
    return transaction.amount;
  }, [transaction, currentBudgetId]);

  const isOtherUser = isSharedView && transaction.userName !== currentUserName;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    locked.current = null;
    setSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    if (!locked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      return;
    }

    if (locked.current === 'vertical') return;

    // Rubber-band effect: reduce distance past threshold
    const clamped = Math.max(-160, Math.min(160, dx));
    setOffsetX(clamped);
  };

  const handleTouchEnd = () => {
    setSwiping(false);
    if (offsetX < -SWIPE_THRESHOLD) {
      // Swiped left → delete
      setOffsetX(-200);
      setTimeout(() => {
        onDeleteRequest(transaction.id);
        setOffsetX(0);
      }, 200);
    } else if (offsetX > SWIPE_THRESHOLD) {
      // Swiped right → edit
      setOffsetX(200);
      setTimeout(() => {
        onEdit(transaction);
        setOffsetX(0);
      }, 200);
    } else {
      setOffsetX(0);
    }
    locked.current = null;
  };

  // Pointer fallback for non-touch (desktop testing)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return; // handled by touch events
    startX.current = e.clientX;
    startY.current = e.clientY;
    locked.current = null;
    setSwiping(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !swiping) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (!locked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      return;
    }
    if (locked.current === 'vertical') return;
    setOffsetX(Math.max(-160, Math.min(160, dx)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    handleTouchEnd();
  };

  const showDeleteHint = offsetX < -30;
  const showEditHint = offsetX > 30;
  const deleteReady = offsetX < -SWIPE_THRESHOLD;
  const editReady = offsetX > SWIPE_THRESHOLD;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[2rem] mb-3"
    >
      {/* Delete background (swipe left) */}
      <div
        className={`absolute inset-0 flex items-center justify-end pr-8 rounded-[2rem] transition-colors duration-200 ${
          deleteReady ? 'bg-rose-500' : 'bg-rose-400/30 dark:bg-rose-900/40'
        }`}
      >
        <div
          className={`flex items-center space-x-2 transition-all duration-200 ${
            showDeleteHint ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <svg
            className={`w-5 h-5 ${deleteReady ? 'text-white' : 'text-rose-500'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          <span
            className={`text-[10px] font-black uppercase tracking-widest ${
              deleteReady ? 'text-white' : 'text-rose-500'
            }`}
          >
            Delete
          </span>
        </div>
      </div>

      {/* Edit background (swipe right) */}
      <div
        className={`absolute inset-0 flex items-center justify-start pl-8 rounded-[2rem] transition-colors duration-200 ${
          editReady ? 'bg-emerald-500' : 'bg-emerald-400/30 dark:bg-emerald-900/40'
        }`}
      >
        <div
          className={`flex items-center space-x-2 transition-all duration-200 ${
            showEditHint ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <svg
            className={`w-5 h-5 ${
              editReady ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572"
            />
          </svg>
          <span
            className={`text-[10px] font-black uppercase tracking-widest ${
              editReady ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            Edit
          </span>
        </div>
      </div>

      {/* Foreground content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative z-10 p-5 rounded-[2rem] backdrop-blur-xl border shadow-sm bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping
            ? 'none'
            : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
          touchAction: 'pan-y',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col text-left">
            <div className="flex items-center space-x-2">
              <span className="font-black text-[14px] text-slate-500 dark:text-slate-100 tracking-tight leading-none uppercase">
                {transaction.vendor}
              </span>
              {isSharedView && (
                <span
                  className={`text-[9px] font-black px-2 py-0.5 rounded-full tracking-widest transition-colors duration-700 ${
                    isOtherUser
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {transaction.userName?.split(' ')[0]}
                </span>
              )}
            </div>

            {/* Date, badges, and flag button */}
            <div className="flex flex-col mt-2 space-y-1">
              {/* Date + recurrence + projected */}
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">
                  {new Date(transaction.date).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>

                {transaction.recurrence !== 'One-time' && (
                  <span className="text-[8px] font-black text-slate-500 dark:text-slate-400 flex items-center uppercase tracking-[0.15em] bg-slate-100/50 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                    {transaction.recurrence}
                  </span>
                )}

                {transaction.is_projected && (
                  <span className="text-[8px] font-black text-amber-500 dark:text-amber-400 uppercase tracking-[0.15em] bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md">
                    Projected
                  </span>
                )}
              </div>

              {/* "This looks wrong" button (only for auto‑added + parsed notifications) */}
              {transaction.label === 'Auto-Added' &&
                transaction.notification_rule_id &&
                transaction.raw_notification && (
                  <FlagTransactionButton
                    user={{
                      id: transaction.user_id,
                      name: transaction.userName ?? '',
                      email: '',
                      hasJointAccounts: false,
                      budgetingSolo: true,
                      monthlyIncome: 0,
                    }}
                    transaction={transaction}
                  />
                )}
            </div>
          </div>

          <div className="text-right">
            <div
              className={`text-lg font-black tracking-tighter ${
                transaction.is_projected
                  ? 'text-slate-300 dark:text-slate-700'
                  : 'text-slate-500 dark:text-slate-50'
              }`}
            >
              ${displayAmount.toFixed(2)}
            </div>
            {transaction.splits && transaction.splits.length > 0 && (
              <div className="text-[8px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-[0.2em] mt-0.5">
                Split Vault
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionItem;
