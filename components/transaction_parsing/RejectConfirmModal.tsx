import React from 'react';

interface RejectConfirmModalProps {
  rejectConfirmId: string;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}

const RejectConfirmModal: React.FC<RejectConfirmModalProps> = ({
  rejectConfirmId,
  onCancel,
  onConfirm,
}) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-200">
    <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-red-500 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          Reject Transaction?
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          This transaction will be permanently dismissed and won't appear in your review list.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-all active:scale-[0.98]"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(rejectConfirmId)}
          className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white bg-red-500 dark:bg-red-600 rounded-xl border border-red-600 dark:border-red-700 transition-all active:scale-[0.98]"
        >
          Reject
        </button>
      </div>
    </div>
  </div>
);

export default RejectConfirmModal;
