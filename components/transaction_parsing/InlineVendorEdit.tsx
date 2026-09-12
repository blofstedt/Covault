import React, { useState, useRef, useEffect, useMemo } from 'react';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import { pickVendorNameSuggestion } from '../../lib/vendorNameSuggestion';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { useEscapeKey } from '../../lib/hooks/useEscapeKey';
import Portal from '../ui/Portal';
import type { ExistingRule } from './CategoryPickerSheet';

const NO_RULES: ExistingRule[] = [];
const MAX_SUGGESTIONS = 4;

/**
 * The stored spelling worth offering instead of what was just typed, or null
 * when the typed name should simply be saved.
 *
 * Kept as a named re-export because this is where the rename field's own
 * behaviour is read from; the rule itself lives in
 * `lib/vendorNameSuggestion.ts`, which explains at length why it is allowed to
 * reach further than `fuzzyVendorMatch` does.
 */
export function pickNearMatchName(
  rules: ExistingRule[],
  typed: string,
  currentValue: string,
): string | null {
  return pickVendorNameSuggestion(rules, typed, currentValue);
}

/**
 * The rule the saved name belongs to, when the name identifies exactly one.
 *
 * Suggestions are shown as `Vendor · Category` because the pairing is the unit
 * the user thinks in — so picking "Pizza Culture · Leisure" for a row the
 * pipeline guessed as Other has to bring the category with it. It did not: the
 * row kept its guessed category, and the rule the rename then taught paired the
 * bank's name with THAT category, quietly contradicting the rule whose name had
 * just been chosen. The next purchase came in renamed correctly and filed
 * wrongly.
 *
 * Only ever one rule: a merchant may legitimately hold two categories (the
 * groceries and the clothes bought at the same shop), and in that case the name
 * alone does not say which was meant — so the name is applied and the category
 * is left exactly as it was, for the user to pick.
 */
export function pickRuleToAdopt(
  rules: ExistingRule[],
  name: string,
): ExistingRule | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const named = rules.filter((rule) => rule.properName.trim().toLowerCase() === wanted);
  return named.length === 1 ? named[0] : null;
}

interface InlineVendorEditProps {
  /** Current vendor display name. */
  value: string;
  /**
   * Persist the new value. Called on Enter or Save tap. `matchedRule` is the
   * single rule the saved name belongs to, when there is one — its category
   * comes with the name.
   */
  onSave: (newValue: string, matchedRule?: ExistingRule | null) => void | Promise<void>;
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
 * Renaming a caught merchant: a small trigger on the row, and a sheet.
 *
 * The editing half used to happen IN the row — an 11px input squeezed into
 * the slot the merchant name occupies, with an 11px Save beside it and a bare
 * "✕" beside that, and the list of existing rules stacked underneath in a
 * colour nothing else on the page uses. It was the smallest text and the
 * smallest tap targets in the app, sitting inside a list of cards designed
 * around neither, and it was where the user had to type the one string the
 * whole learning mechanism is keyed on.
 *
 * It is a sheet now, built out of the same pieces as `CategoryPickerSheet`
 * next door — the same backdrop, the same `rounded-[2rem]` card, the same
 * 48px rows and the same violet treatment for "a rule you already taught".
 * The two are opened from the same row within seconds of each other, so
 * looking like one another is the whole point. The trigger on the row is
 * unchanged; only what it opens is different.
 *
 * Everything about WHEN a rename commits is deliberately untouched — see
 * `handleBlur`, which exists because of an Android keyboard behaviour that
 * used to lose renames silently.
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
  // The whole editor, so a blur can tell "focus moved to my own Save button"
  // from "focus left entirely".
  const editorRef = useRef<HTMLDivElement>(null);
  // Guards a second save while one is in flight — the blur below and a tap on
  // Save can both arrive for the same rename.
  const savingRef = useRef(false);
  // Set on the way down on Cancel, before the input blurs, so dismissing the
  // editor never commits what was typed.
  const cancelRef = useRef(false);

  // Escape closes the sheet from anywhere inside it, not only from the field.
  // Flagged as a cancel first, for the same reason the buttons do: it is a
  // dismissal, and a dismissal must never commit what was typed.
  useEscapeKey(() => {
    cancelRef.current = true;
    onCancel();
  }, editing);

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
      await onSave(name, pickRuleToAdopt(knownRules, name));
    } else {
      onCancel();
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await runSave();
    } finally {
      savingRef.current = false;
    }
  };

  /**
   * Leaving the field saves what was typed.
   *
   * The Save tap is not reliable on its own here. On Android the field losing
   * focus closes the soft keyboard, which resizes the WebView — so the button
   * moves out from under the finger between touch-down and touch-up and the
   * tap lands on nothing. The rename then vanished without a trace: no write,
   * not even a local change, which is indistinguishable from the app ignoring
   * it. Committing on the way out means the typed name survives however the
   * field is left.
   *
   * Two exits are not a save: Cancel (flagged on the way down, before this
   * runs) and focus moving to this editor's own buttons, which do their own
   * thing.
   */
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    const next = e.relatedTarget as Node | null;
    if (next && editorRef.current?.contains(next)) return;
    void handleSave();
  };

  const runSave = async () => {
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
    const near = pickNearMatchName(knownRules, trimmed, value);
    if (near && !nearMatch) {
      setNearMatch(near);
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

  // The sheet. One shell, two things inside it: the ordinary rename, and the
  // "you already have one of these" question.
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:pb-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
        // Down, not up, and for the same reason the Cancel button does it:
        // this has to be recorded before the input blurs, or dismissing the
        // sheet by tapping beside it would be read as leaving the field and
        // would save what was typed.
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) cancelRef.current = true;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onCancel();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Rename merchant"
      >
        <div
          ref={editorRef}
          onKeyDown={(e) => e.stopPropagation()}
          className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[2rem] p-5 shadow-2xl border border-slate-100 dark:border-slate-800/60 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300"
        >
          {nearMatch ? (
            /* Both spellings side by side, neither preselected — the point is
               that the user can see exactly what they are choosing between
               before anything is stored. */
            <>
              <h3 className="text-base font-bold text-slate-600 dark:text-slate-100 tracking-tight">
                You already have this one
              </h3>
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1 mb-4 leading-snug">
                Using the spelling you already have keeps one merchant instead
                of two, so everything Covault has learned about it stays
                together.
              </p>

              <button
                type="button"
                onClick={() => { setNearMatch(null); void commit(nearMatch); }}
                disabled={isSaving}
                className="w-full min-h-[52px] flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-violet-50/70 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 hover:bg-violet-100 dark:hover:bg-violet-900/40 active:scale-[0.98] transition-all text-left disabled:opacity-40"
              >
                <span className="w-5 h-5 shrink-0 flex items-center justify-center text-violet-600 dark:text-violet-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                    Use the one you have
                  </span>
                  <span className="block text-sm font-bold text-slate-600 dark:text-slate-100 truncate">
                    {nearMatch}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => { setNearMatch(null); void commit(draft.trim()); }}
                disabled={isSaving}
                className="mt-2 w-full min-h-[52px] flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-emerald-500/50 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/20 active:scale-[0.98] transition-all text-left disabled:opacity-40"
              >
                <span className="w-5 h-5 shrink-0 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Keep what I typed
                  </span>
                  <span className="block text-sm font-bold text-slate-600 dark:text-slate-100 truncate">
                    {draft.trim()}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onPointerDown={() => { cancelRef.current = true; }}
                onClick={onCancel}
                disabled={isSaving}
                className="mt-4 w-full min-h-[48px] py-3 text-xs font-bold rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-[0.98] disabled:opacity-40"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h3 className="text-base font-bold text-slate-600 dark:text-slate-100 tracking-tight">
                Rename this merchant
              </h3>
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1 mb-4 leading-snug">
                Covault will use this name for{' '}
                <span className="font-bold text-slate-500 dark:text-slate-300">{value}</span>{' '}
                from now on, here and on every purchase it catches from them.
              </p>

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
                    cancelRef.current = true;
                    onCancel();
                  }
                }}
                onBlur={handleBlur}
                disabled={isSaving}
                // 16px, not the 11px this used to be. Anything smaller is a
                // squint on a phone, and browsers zoom the page to reach a
                // text field under 16px — which on Android leaves the sheet
                // sitting off-centre for the rest of the edit.
                className="w-full min-h-[52px] px-4 py-3 text-base font-bold rounded-2xl bg-slate-50 dark:bg-slate-800/50 border-2 border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:bg-white dark:focus:bg-slate-900 transition-colors disabled:opacity-50"
                placeholder="Store, restaurant, website…"
                autoFocus
                aria-label="Merchant name"
              />

              {/* Rules already taught, offered as they are offered next door in
                  the category sheet. Picking one reuses that rule's stored
                  spelling and creates nothing new. */}
              {suggestions.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                    {suggestions.length > 1 ? 'Names you already use' : 'A name you already use'}
                  </p>
                  <div className="space-y-2">
                    {suggestions.map((rule) => (
                      <button
                        key={`${rule.properName}::${rule.categoryId}`}
                        type="button"
                        onClick={() => { setDraft(rule.properName); void commit(rule.properName); }}
                        disabled={isSaving}
                        className="w-full min-h-[48px] flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-violet-50/70 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 hover:bg-violet-100 dark:hover:bg-violet-900/40 active:scale-[0.98] transition-all text-left disabled:opacity-40"
                      >
                        <span className="w-5 h-5 shrink-0 flex items-center justify-center text-violet-600 dark:text-violet-400">
                          {getBudgetIcon(rule.categoryName)}
                        </span>
                        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-200 truncate">
                          {rule.properName}
                          <span className="mx-1.5 opacity-40">·</span>
                          {rule.categoryName}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || !draft.trim() || draft.trim() === value}
                className="mt-4 w-full min-h-[48px] py-3 text-xs font-bold rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving…' : 'Save name'}
              </button>
              <button
                type="button"
                // Down, not up: this has to be recorded before the input
                // blurs, so dismissing the sheet doesn't get read as leaving
                // the field.
                onPointerDown={() => { cancelRef.current = true; }}
                onClick={onCancel}
                disabled={isSaving}
                className="mt-2 w-full min-h-[48px] py-3 text-xs font-bold rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-[0.98] disabled:opacity-40"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
};

export default InlineVendorEdit;
