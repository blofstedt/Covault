import React, { useState, useRef, useEffect } from 'react';

interface InlineVendorEditProps {
  /** Current vendor display name. */
  value: string;
  /** Persist the new value. Called on Enter or Save tap. */
  onSave: (newValue: string) => void | Promise<void>;
  /** True while the parent is persisting the change. Disables input. */
  isSaving?: boolean;
  /** When true, the input is visible (edit mode). Otherwise a small
   *  "rename" trigger is rendered instead. */
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
}

/**
 * Compact inline vendor editor for a single transaction row. Renders
 * a small "rename" trigger when not editing; switches to a text
 * input on click. Save with Enter, cancel with Escape.
 *
 * Intentionally minimal — the user said "alter the vendor if need be
 * and that alteration would show an override for the AI/vendor parsing
 * going forward". The existing TransactionForm modal already does
 * the full edit; this is the lightweight in-line path for the common
 * case of "just rename it".
 */
const InlineVendorEdit: React.FC<InlineVendorEditProps> = ({
  value,
  onSave,
  isSaving = false,
  editing,
  onStartEdit,
  onCancel,
}) => {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      // Slight delay so the click that opened the editor doesn't refocus
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, value]);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      await onSave(trimmed);
    } else {
      onCancel();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-150"
        title="Rename vendor"
        aria-label="Rename vendor"
      >
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <span>rename</span>
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center gap-1.5"
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        disabled={isSaving}
        className="flex-1 min-w-0 px-2 py-1 text-[11px] font-semibold rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-50"
        autoFocus
        aria-label="Vendor name"
      />
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving || !draft.trim() || draft.trim() === value}
        className="px-2 py-1 text-[10px] font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Save (Enter)"
      >
        {isSaving ? '…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isSaving}
        className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 active:scale-95 transition-all duration-150 disabled:opacity-40"
        title="Cancel (Esc)"
      >
        ✕
      </button>
    </div>
  );
};

export default InlineVendorEdit;
