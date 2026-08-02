import React, { useState, useRef, useEffect, useMemo } from 'react';
import { fuzzyVendorMatch } from '../../lib/formatVendorName';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import type { ExistingRule } from './CategoryPickerSheet';

const NO_RULES: ExistingRule[] = [];
const MAX_SUGGESTIONS = 4;

interface InlineVendorEditProps {
  /** Current vendor display name. */
  value: string;
  /** Persist the new value. Called on Enter or Save tap. */
  onSave: (newValue: string) => void | Promise<void>;
  /**
   * Every rule the user has taught, used for typeahead and near-match
   * consolidation. Suggestions are rules (`Vendor · Category`), not bare
   * vendor names, because the pairing is the unit the user thinks in.
   */
  knownRules?: ExistingRule[];
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
  knownRules = NO_RULES,
  isSaving = false,
  editing,
  onStartEdit,
  onCancel,
}) => {
  const [draft, setDraft] = useState(value);
  // Set when the typed name is close to — but not the same as — a name already
  // on a rule. Holds the stored spelling so the user can choose between them.
  const [nearMatch, setNearMatch] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setNearMatch(null);
      // Slight delay so the click that opened the editor doesn't refocus
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, value]);

  // Distinct vendor names on existing rules, in `Vendor · Category` form.
  const suggestions = useMemo(() => {
    const typed = draft.trim().toLowerCase();
    if (!typed) return NO_RULES;
    return knownRules
      .filter((rule) => {
        const name = rule.properName.toLowerCase();
        return name !== typed && name.includes(typed);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [draft, knownRules]);

  const commit = async (name: string) => {
    if (name && name !== value) {
      await onSave(name);
    } else {
      onCancel();
    }
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onCancel();
      return;
    }

    // Case-insensitive reuse. Typing "walmart" when a rule already says
    // "Walmart" must NOT fork a second spelling — the stored name wins, so the
    // user's casing never silently overwrites what the rules already show.
    // (lib/formatVendorName.ts has a history of rewriting the user's own
    // capitalisation; this is the same trap seen from the other side.)
    const typedKey = toVendorKey(trimmed);
    const exact = knownRules.find(
      (rule) =>
        rule.properName.toLowerCase() === trimmed.toLowerCase() ||
        toVendorKey(rule.properName) === typedKey,
    );
    if (exact) {
      await commit(exact.properName);
      return;
    }

    // Close but not equal: ask rather than fork the vendor into two spellings.
    // Deliberately checked regardless of category — the fragmentation this
    // prevents ("WAL-MART #3106" alongside "Walmart") is about the vendor
    // name, and it happens just as easily across categories as within one.
    const near = knownRules.find((rule) => fuzzyVendorMatch(rule.properName, trimmed));
    if (near && !nearMatch) {
      setNearMatch(near.properName);
      return;
    }

    await commit(trimmed);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-150"
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

  // Near-match confirm. Both spellings are shown side by side and neither is
  // preselected — the point is that the user can see exactly what they are
  // choosing between before anything is stored.
  if (nearMatch) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex flex-col gap-1.5"
      >
        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          Use the existing{' '}
          <span className="font-bold text-slate-700 dark:text-slate-200">{nearMatch}</span>?
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setNearMatch(null); void commit(nearMatch); }}
            disabled={isSaving}
            className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-40"
          >
            Use {nearMatch}
          </button>
          <button
            type="button"
            onClick={() => { setNearMatch(null); void commit(draft.trim()); }}
            disabled={isSaving}
            className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-40"
          >
            Keep {draft.trim()}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex flex-col gap-1.5"
    >
    <div className="flex items-center gap-1.5">
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
        className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Save (Enter)"
      >
        {isSaving ? '…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isSaving}
        className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 active:scale-95 transition-all duration-150 disabled:opacity-40"
        title="Cancel (Esc)"
      >
        ✕
      </button>
    </div>

    {/* Typeahead over rules already taught. Picking one reuses that rule's
        stored spelling and creates nothing new. */}
    {suggestions.length > 0 && (
      <ul className="flex flex-col gap-1" role="listbox" aria-label="Existing rules">
        {suggestions.map((rule) => (
          <li key={`${rule.properName}::${rule.categoryId}`}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { setDraft(rule.properName); void commit(rule.properName); }}
              disabled={isSaving}
              className="w-full text-left px-2 py-1 rounded-lg text-[11px] font-semibold bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-slate-600 dark:text-slate-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors disabled:opacity-40"
            >
              {rule.properName}
              <span className="mx-1.5 opacity-40">·</span>
              <span className="text-violet-600 dark:text-violet-400">{rule.categoryName}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
    </div>
  );
};

export default InlineVendorEdit;
