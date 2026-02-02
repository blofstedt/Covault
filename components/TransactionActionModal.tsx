import React, { useState } from 'react';
import { Transaction, BudgetCategory } from '../types';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface TransactionActionModalProps {
  transaction: Transaction;
  budgets: BudgetCategory[];
  currentUserName: string;
  isSharedAccount: boolean;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
  onDelete: () => void;
}

const TransactionActionModal: React.FC<TransactionActionModalProps> = ({
  transaction,
  budgets,
  currentUserName,
  isSharedAccount,
  onClose,
  onEdit,
  onDelete,
}) => {
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (showEditForm) {
    return (
      <TransactionForm
        onClose={() => {
          setShowEditForm(false);
          onClose();
        }}
        onSave={(updatedTx) => {
          onEdit(updatedTx);
          setShowEditForm(false);
          onClose();
        }}
        budgets={budgets}
        userId={transaction.user_id}
        userName={currentUserName}
        initialTransaction={transaction}
        isSharedAccount={isSharedAccount}
      />
    );
  }

  if (showDeleteConfirm) {
    return (
      <ConfirmDeleteModal
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          onDelete();
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-[360px] bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-6 shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800/60">
        {/* Transaction Info */}
        <div className="text-center space-y-3 border-b border-slate-100 dark:border-slate-800 pb-6">
          <h3 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            {transaction.vendor}
          </h3>
          <div className="flex items-center justify-center space-x-3">
            <span className="text-2xl font-black text-slate-500 dark:text-slate-50">
              ${transaction.amount.toFixed(2)}
            </span>
            {transaction.is_projected && (
              <span className="text-[9px] font-black text-amber-500 dark:text-amber-400 uppercase tracking-[0.15em] bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-md">
                Projected
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">
            {new Date(transaction.date).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col space-y-3">
          <button
            onClick={() => setShowEditForm(true)}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-emerald-500/20 active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center space-x-2"
          >
            <svg
              className="w-5 h-5"
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
            <span>Edit Transaction</span>
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-rose-500/20 active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center space-x-2"
          >
            <svg
              className="w-5 h-5"
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
            <span>Delete Transaction</span>
          </button>

          <button
            onClick={onClose}
            className="w-full py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-sm active:scale-95 transition-all uppercase tracking-widest"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionActionModal;
