import React, { useState, useMemo } from 'react';
import type { PendingTransaction } from '../types';
import {
  buildRegexFromSelection,
  applyRuleToNotification,
} from '../lib/notificationProcessor';

type SelectionMode = 'amount' | 'vendor' | null;

interface RegexSetupModalProps {
  notification: PendingTransaction;
  onSave: (amountRegex: string, vendorRegex: string) => void;
  onClose: () => void;
}

/**
 * Modal for manually setting up regex patterns by selecting vendor and amount
 * regions in a captured notification text.
 *
 * The user taps words in the notification text to select:
 *   1. The amount value (e.g. "$45.67")
 *   2. The vendor/merchant name (e.g. "WALMART")
 *
 * The system builds regex patterns from these selections.
 */
const RegexSetupModal: React.FC<RegexSetupModalProps> = ({
  notification,
  onSave,
  onClose,
}) => {
  const [mode, setMode] = useState<SelectionMode>('amount');
  const [amountIndices, setAmountIndices] = useState<Set<number>>(new Set());
  const [vendorIndices, setVendorIndices] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Split notification text into tappable tokens (words)
  const tokens = useMemo(() => {
    const text = notification.notification_text || '';
    // Split on whitespace, preserving the original text
    const parts: string[] = [];
    let current = '';
    for (const char of text) {
      if (/\s/.test(char)) {
        if (current) {
          parts.push(current);
          current = '';
        }
        // Include whitespace as a separator token if needed,
        // but for selection we skip it
      } else {
        current += char;
      }
    }
    if (current) {
      parts.push(current);
    }
    return parts;
  }, [notification.notification_text]);

  const selectedAmountText = useMemo(() => {
    return Array.from(amountIndices)
      .sort((a, b) => a - b)
      .map(i => tokens[i])
      .join(' ');
  }, [amountIndices, tokens]);

  const selectedVendorText = useMemo(() => {
    return Array.from(vendorIndices)
      .sort((a, b) => a - b)
      .map(i => tokens[i])
      .join(' ');
  }, [vendorIndices, tokens]);

  // Preview: build regex and test it against the notification
  const preview = useMemo(() => {
    if (!selectedAmountText || !selectedVendorText) return null;

    try {
      const { vendorRegex, amountRegex } = buildRegexFromSelection(
        notification.notification_text,
        selectedVendorText,
        selectedAmountText,
      );

      const result = applyRuleToNotification(
        amountRegex,
        vendorRegex,
        notification.notification_text,
      );

      return {
        vendorRegex,
        amountRegex,
        extractedVendor: result?.vendor || null,
        extractedAmount: result?.amount || null,
        works: result !== null,
      };
    } catch {
      return null;
    }
  }, [selectedAmountText, selectedVendorText, notification.notification_text]);

  const handleTokenTap = (index: number) => {
    if (!mode) return;

    if (mode === 'amount') {
      const next = new Set(amountIndices);
      if (next.has(index)) {
        next.delete(index);
      } else {
        // Remove from vendor if it was there
        const vendorNext = new Set(vendorIndices);
        vendorNext.delete(index);
        setVendorIndices(vendorNext);
        next.add(index);
      }
      setAmountIndices(next);
    } else {
      const next = new Set(vendorIndices);
      if (next.has(index)) {
        next.delete(index);
      } else {
        // Remove from amount if it was there
        const amountNext = new Set(amountIndices);
        amountNext.delete(index);
        setAmountIndices(amountNext);
        next.add(index);
      }
      setVendorIndices(next);
    }
    setError(null);
  };

  const handleSave = () => {
    if (!selectedAmountText) {
      setError('Select the dollar amount in the notification');
      return;
    }
    if (!selectedVendorText) {
      setError('Select the vendor/merchant name in the notification');
      return;
    }
    if (!preview?.works) {
      setError('Could not build a working pattern from your selection. Try selecting different words.');
      return;
    }

    onSave(preview.amountRegex, preview.vendorRegex);
  };

  const handleReset = () => {
    setAmountIndices(new Set());
    setVendorIndices(new Set());
    setMode('amount');
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-[2.5rem] shadow-2xl max-h-[90vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="px-6 pt-6 pb-3 border-b border-slate-100 dark:border-slate-800/60">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black uppercase tracking-[0.15em] text-slate-600 dark:text-slate-200">
              Set Up Transaction Rule
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 transition-colors active:scale-95"
            >
              <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Tap the words that represent the <strong>amount</strong> and <strong>vendor</strong> in this notification. This teaches Covault how to read transactions from {notification.app_name}.
          </p>
        </div>

        {/* Mode selector */}
        <div className="px-6 pt-4 flex gap-2">
          <button
            onClick={() => setMode('amount')}
            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              mode === 'amount'
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
            }`}
          >
            {selectedAmountText ? `Amount: ${selectedAmountText}` : 'Select Amount'}
          </button>
          <button
            onClick={() => setMode('vendor')}
            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              mode === 'vendor'
                ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
            }`}
          >
            {selectedVendorText ? `Vendor: ${selectedVendorText}` : 'Select Vendor'}
          </button>
        </div>

        {/* Notification text with tappable tokens */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-800/60">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              {notification.app_name} Notification
            </p>
            {notification.notification_title && (
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                {notification.notification_title}
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {tokens.map((token, i) => {
                const isAmount = amountIndices.has(i);
                const isVendor = vendorIndices.has(i);
                let classes =
                  'px-1.5 py-1 rounded-lg text-[11px] font-medium transition-all active:scale-95 cursor-pointer select-none ';

                if (isAmount) {
                  classes +=
                    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-2 ring-blue-400/50';
                } else if (isVendor) {
                  classes +=
                    'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 ring-2 ring-purple-400/50';
                } else {
                  classes +=
                    'bg-white dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600/50';
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleTokenTap(i)}
                    className={classes}
                  >
                    {token}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex gap-4 mt-3 px-1">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-400/70" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Amount</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-purple-400/70" />
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Vendor</span>
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className={`mt-4 p-3 rounded-2xl border ${
              preview.works
                ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/40'
                : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/40'
            }`}>
              <p className={`text-[9px] font-black uppercase tracking-wider mb-1 ${
                preview.works
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {preview.works ? 'Preview — Pattern Works' : 'Preview — Pattern Failed'}
              </p>
              {preview.works && (
                <div className="flex gap-4">
                  <div>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">Vendor</span>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{preview.extractedVendor}</p>
                  </div>
                  <div>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">Amount</span>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      ${preview.extractedAmount?.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="mt-3 text-[10px] font-bold text-red-500 dark:text-red-400 text-center">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex gap-3">
          <button
            onClick={handleReset}
            className="flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 transition-all active:scale-[0.98]"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedAmountText || !selectedVendorText}
            className="flex-[2] py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider text-white bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-400 shadow-lg shadow-emerald-500/25 disabled:shadow-none transition-all active:scale-[0.98]"
          >
            Save Rule
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegexSetupModal;
