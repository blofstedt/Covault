import React, { useEffect } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'neutral';
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation modal used for delete confirmations, reject confirmations, etc.
 */
const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Go Back',
  variant = 'danger',
  icon,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const confirmBg =
    variant === 'danger'
      ? 'bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/20'
      : 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/20';

  const iconBg =
    variant === 'danger'
      ? 'bg-rose-50 dark:bg-rose-900/20'
      : 'bg-emerald-50 dark:bg-emerald-900/20';

  const defaultIcon =
    variant === 'danger' ? (
      <svg
        className="w-8 h-8 text-rose-500"
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
    ) : null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-[320px] bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-8 shadow-2xl animate-in zoom-in-95 duration-300 border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60 text-center">
        <div className="flex flex-col items-center space-y-4">
          <div className={`w-16 h-16 ${iconBg} rounded-2xl flex items-center justify-center`}>
            {icon || defaultIcon}
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-600 dark:text-slate-100 tracking-tight">
              {title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="flex flex-col space-y-3">
          <button
            onClick={onConfirm}
            className={`w-full py-4 ${confirmBg} text-white rounded-2xl font-semibold text-sm active:scale-[0.97] transition-all duration-200 tracking-wide`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="w-full py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-semibold text-sm active:scale-[0.97] transition-all duration-200 tracking-wide"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
