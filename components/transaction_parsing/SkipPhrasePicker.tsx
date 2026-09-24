import React, { useMemo, useState, useCallback } from 'react';
import {
  phraseWords,
  phraseBetween,
  checkSkipPhrase,
  MIN_PHRASE_WORDS,
} from '../../lib/skipPhrase';
import type { Transaction } from '../../types';

interface SkipPhrasePickerProps {
  /** The whole alert the rule was made from — the words on offer. */
  sourceText: string;
  /** What the rule matches on today. */
  pattern: string;
  /** Checked against, so a phrase that would hide a real purchase cannot be
   *  saved. Every captured purchase stores the alert it arrived on. */
  transactions: Transaction[];
  saving?: boolean;
  onSave: (phrase: string) => void;
}

/**
 * Choosing which words of an alert a `contains` rule matches on.
 *
 * Tap the first word, then the last. The span between them is the pattern,
 * taken as the alert's own text rather than a rewriting of it — a pattern has
 * to be a substring of what the bank actually sends.
 *
 * Two taps rather than a checkbox per word, because the rule is a PHRASE: the
 * words have to be next to each other, in the order the bank sends them, and
 * a set of checkboxes would offer combinations that cannot be expressed and
 * would have to be refused one at a time.
 */
const SkipPhrasePicker: React.FC<SkipPhrasePickerProps> = ({
  sourceText,
  pattern,
  transactions,
  saving = false,
  onSave,
}) => {
  const words = useMemo(() => phraseWords(sourceText), [sourceText]);

  // Where the current pattern sits in the alert, so opening the picker shows
  // what the rule already matches rather than a blank slate.
  const current = useMemo(() => {
    const at = sourceText.toLowerCase().indexOf(pattern.trim().toLowerCase());
    if (at === -1) return null;
    const end = at + pattern.trim().length;
    const first = words.findIndex((w) => w.end > at);
    let last = -1;
    for (let i = 0; i < words.length; i++) if (words[i].start < end) last = i;
    return first !== -1 && last >= first ? { first, last } : null;
  }, [sourceText, pattern, words]);

  const [anchor, setAnchor] = useState<number | null>(null);
  const [range, setRange] = useState<{ first: number; last: number } | null>(current);

  const handleTap = useCallback((i: number) => {
    // First tap starts a selection; the second closes it; a third starts over.
    // Predictable enough to explain in one line, which a drag never is on a
    // phone where the same gesture scrolls the page.
    if (anchor === null) {
      setAnchor(i);
      setRange({ first: i, last: i });
      return;
    }
    setRange({ first: Math.min(anchor, i), last: Math.max(anchor, i) });
    setAnchor(null);
  }, [anchor]);

  const phrase = range ? phraseBetween(sourceText, words, range.first, range.last) : '';
  const check = useMemo(
    () => (phrase ? checkSkipPhrase(phrase, transactions) : null),
    [phrase, transactions],
  );
  const changed = phrase && phrase.trim() !== pattern.trim();

  const tone =
    check?.verdict === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
      : check?.allowed ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400';

  return (
    <div>
      <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-1">
        Words to match
      </p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug mb-1.5">
        {anchor === null
          ? 'Tap the first word, then the last.'
          : 'Now tap the last word of the phrase.'}
      </p>

      <div className="flex flex-wrap gap-x-1 gap-y-1 mb-2">
        {words.map((word, i) => {
          const picked = !!range && i >= range.first && i <= range.last;
          return (
            <button
              key={`${word.start}-${i}`}
              onClick={() => handleTap(i)}
              disabled={saving}
              aria-pressed={picked}
              className={`text-[11px] leading-none px-1.5 py-1 rounded-md border transition-all duration-200 active:scale-[0.97] disabled:opacity-50 ${
                picked
                  ? 'bg-violet-100 dark:bg-violet-900/40 border-violet-300 dark:border-violet-600/50 text-violet-800 dark:text-violet-200 font-bold'
                  : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {word.text}
            </button>
          );
        })}
      </div>

      {phrase ? (
        <>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug break-words bg-violet-50/50 dark:bg-violet-900/20 rounded-lg px-2 py-1.5">
            {phrase}
          </p>
          {check && (
            <p className={`text-[10px] leading-snug mt-1.5 font-semibold ${tone}`}>
              {check.message}
            </p>
          )}
          {changed && (
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={() => onSave(phrase)}
                disabled={saving || !check?.allowed}
                className="flex-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-violet-500 text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
              >
                {saving ? 'Saving…' : 'Use these words'}
              </button>
              <button
                onClick={() => { setRange(current); setAnchor(null); }}
                disabled={saving}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
              >
                Reset
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
          {`A rule needs at least ${MIN_PHRASE_WORDS} words.`}
        </p>
      )}
    </div>
  );
};

export default SkipPhrasePicker;
