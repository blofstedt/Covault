
import React, { useEffect } from 'react';

interface ConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ onClose, onConfirm }) => {
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-[320px] bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-8 shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800/60 text-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 bg-rose-50 dark:bg-rose-900/20 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">Remove Entry?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">This action will permanently delete this transaction from your vault.</p>
          </div>
        </div>

        <div className="flex flex-col space-y-3">
          <button 
            onClick={onConfirm}
            className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-rose-500/20 active:scale-95 transition-all uppercase tracking-widest"
          >
            Confirm Delete
          </button>
          <button 
            onClick={onClose}
            className="w-full py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-sm active:scale-95 transition-all uppercase tracking-widest"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
